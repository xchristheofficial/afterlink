import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("local storage check reports volume capacity and refuses missing or invalid databases without leaking paths", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "afterlink-health-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "private-name.sqlite");
  function check(path, code) {
    const { status, stdout, stderr } = spawnSync(
      process.execPath,
      ["scripts/storage-health.mjs"],
      { env: { ...process.env, DB_FILE: path }, encoding: "utf8" },
    );
    assert.equal(status, code, stderr);
    assert.ok(!(stdout + stderr).includes(dir));
    return JSON.parse(stdout);
  }
  assert.equal(check("", 1).reason, "absolute-db-file-required");
  assert.equal(check(file, 1).ok, false);
  await assert.rejects(stat(file), { code: "ENOENT" });
  await writeFile(file, "invalid SQLite database");
  assert.equal(check(file, 1).ok, false);
  await rm(file);
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE users(id INTEGER);");
    assert.equal(check(file, 1).reason, "expected-tables-missing");
    for (const name of ["sessions", "posts", "messages", "lb_members"])
      db.exec(`CREATE TABLE ${name}(id INTEGER)`);
    const { ok, quickCheck, availableMiB } = check(file, 0);
    assert.equal(ok, true);
    assert.equal(quickCheck, "ok");
    assert.ok(availableMiB >= 64);
  } finally {
    db.close();
  }
});
