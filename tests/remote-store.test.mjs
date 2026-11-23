import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openRemoteStore, remoteStoreConfigured } from "../remote-store.mjs";

// Stands in for Supabase: holds the one snapshot row and the same generation
// guard, so takeover and no-op cases behave as they do against Postgres.
function fakePostgres() {
  const store = { row: null, uploads: 0, ended: false };
  store.query = async (text, params = []) => {
    if (/^CREATE TABLE/i.test(text)) return { rows: [], rowCount: 0 };
    if (/^SELECT 1/i.test(text))
      return { rows: [{ "?column?": 1 }], rowCount: 1 };
    if (/^SELECT/i.test(text))
      return store.row
        ? { rows: [{ ...store.row }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    if (/^UPDATE/i.test(text)) {
      const [digest, size, snapshot, generation] = params;
      if (!store.row || Number(store.row.generation) !== Number(generation))
        return { rows: [], rowCount: 0 };
      store.row = {
        generation: Number(store.row.generation) + 1,
        digest,
        byte_size: size,
        snapshot,
      };
      store.uploads++;
      return { rows: [{ generation: store.row.generation }], rowCount: 1 };
    }
    if (/^INSERT/i.test(text)) {
      if (store.row) return { rows: [], rowCount: 0 };
      const [digest, size, snapshot] = params;
      store.row = { generation: 1, digest, byte_size: size, snapshot };
      store.uploads++;
      return { rows: [{ generation: 1 }], rowCount: 1 };
    }
    throw Error("unexpected statement: " + text);
  };
  store.end = async () => {
    store.ended = true;
  };
  return store;
}

const env = { DATABASE_URL: "postgres://afterlink" };

async function openInstance(remote, dbFile) {
  const store = await openRemoteStore({
    dbFile,
    env,
    connect: async () => remote,
    autoStart: false,
    log: { warn() {} },
  });
  const db = new DatabaseSync(dbFile);
  db.exec(
    "CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL)",
  );
  await store.attach(db);
  return { store, db };
}

test("an account survives a replaced process whose disk was wiped", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "afterlink-remote-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbFile = join(dir, "afterlink.sqlite");
  const remote = fakePostgres();

  const first = await openInstance(remote, dbFile);
  assert.equal(first.store.restored, false);
  first.db
    .prepare("INSERT INTO users(email) VALUES(?)")
    .run("member@example.com");
  await first.store.flush();
  first.db.close();
  await first.store.close();
  assert.equal(remote.row.generation, 2);

  // A redeploy starts from an empty container filesystem.
  for (const suffix of ["", "-wal", "-shm", ".pre-restore"])
    rmSync(dbFile + suffix, { force: true });
  assert.equal(existsSync(dbFile), false);

  const second = await openInstance(remote, dbFile);
  t.after(async () => {
    second.db.close();
    await second.store.close();
  });
  assert.equal(second.store.restored, true);
  assert.deepEqual(
    second.db
      .prepare("SELECT email FROM users")
      .all()
      .map((row) => row.email),
    ["member@example.com"],
  );
});

test("an idle instance does not upload and a superseded one stops writing", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "afterlink-remote-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbFile = join(dir, "afterlink.sqlite");
  const remote = fakePostgres();

  const { store, db } = await openInstance(remote, dbFile);
  t.after(async () => {
    db.close();
    await store.close();
  });
  const uploads = remote.uploads;
  await store.flush();
  assert.equal(
    remote.uploads,
    uploads,
    "unchanged database re-uploads nothing",
  );

  // Another instance takes ownership by advancing the generation.
  remote.row.generation = Number(remote.row.generation) + 5;
  db.prepare("INSERT INTO users(email) VALUES(?)").run("later@example.com");
  await store.flush();
  assert.equal(
    remote.uploads,
    uploads,
    "a superseded instance must not overwrite",
  );
  assert.equal(store.active, false);
});

test("DATABASE_URL decides whether replication is on", () => {
  assert.equal(remoteStoreConfigured({}), false);
  assert.equal(remoteStoreConfigured({ DATABASE_URL: "  " }), false);
  assert.equal(remoteStoreConfigured(env), true);
});
