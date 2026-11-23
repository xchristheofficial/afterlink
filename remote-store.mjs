// Durable storage for hosts without a persistent disk (Render's free plan).
// The live database stays SQLite; a consistent snapshot of it is replicated
// into Postgres (Supabase) so a restart, redeploy or spin-down restores the
// same accounts instead of starting from an empty file.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const HEADER = Buffer.from("SQLite format 3\0", "latin1");
const TABLE = "afterlink_snapshots";
const DEFAULT_INTERVAL_MS = 15000;
const DEFAULT_MAX_MB = 64;

export function remoteStoreConfigured(env = process.env) {
  return Boolean((env.DATABASE_URL || "").trim());
}

// Supabase presents a certificate chain Node does not ship a root for, so
// verification is opt-in through DATABASE_CA_CERT rather than silently strict.
export function sslOption(env = process.env) {
  const mode = (env.DATABASE_SSL || "").trim().toLowerCase();
  if (["disable", "off", "false", "0"].includes(mode)) return false;
  const ca = (env.DATABASE_CA_CERT || "").trim();
  if (ca) return { ca, rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

async function defaultConnect(env) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    ssl: sslOption(env),
    application_name: "afterlink",
    max: 2,
    connectionTimeoutMillis: 20000,
    idleTimeoutMillis: 30000,
  });
  // A dropped pooled connection must not take the web process down with it.
  pool.on("error", () => {});
  await pool.query("SELECT 1");
  return pool;
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function looksLikeSqlite(bytes) {
  return (
    Buffer.isBuffer(bytes) &&
    bytes.length > 100 &&
    bytes.subarray(0, 16).equals(HEADER)
  );
}

export function snapshotDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// A SQLite file restored next to a stale -wal/-shm pair is read as the old
// database, so the sidecars are removed with it.
function writeDatabaseFile(dbFile, bytes) {
  mkdirSync(dirname(dbFile), { recursive: true, mode: 0o700 });
  const temp = `${dbFile}.restore-${process.pid}`;
  writeFileSync(temp, bytes, { mode: 0o600 });
  renameSync(temp, dbFile);
  for (const sidecar of ["-wal", "-shm"])
    rmSync(dbFile + sidecar, { force: true });
}

export async function openRemoteStore({
  dbFile,
  env = process.env,
  connect = defaultConnect,
  log = console,
  intervalMs,
  autoStart = true,
} = {}) {
  if (!dbFile) throw Error("openRemoteStore requires a dbFile.");
  const client = await connect(env);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${TABLE}(
       id smallint PRIMARY KEY CHECK (id = 1),
       generation bigint NOT NULL,
       digest text NOT NULL,
       byte_size integer NOT NULL,
       snapshot bytea NOT NULL,
       updated_at timestamptz NOT NULL DEFAULT now())`,
  );

  const interval = positiveNumber(
    env.DB_SYNC_INTERVAL_MS,
    intervalMs ?? DEFAULT_INTERVAL_MS,
  );
  const maxBytes =
    positiveNumber(env.DB_SNAPSHOT_MAX_MB, DEFAULT_MAX_MB) * 1024 * 1024;

  let generation = 0;
  let digest = "";
  let restored = false;
  let restoredBytes = 0;
  let stopped = false;
  let db = null;
  let lastChanges = -1;
  let timer = null;
  let chain = Promise.resolve();

  const { rows } = await client.query(
    `SELECT generation, digest, byte_size, snapshot FROM ${TABLE} WHERE id = 1`,
  );
  if (rows.length) {
    const row = rows[0];
    const bytes = Buffer.isBuffer(row.snapshot)
      ? row.snapshot
      : Buffer.from(row.snapshot ?? []);
    if (!looksLikeSqlite(bytes) || snapshotDigest(bytes) !== row.digest) {
      // Refuse to install a snapshot that is truncated or not a database.
      throw Error(
        "Stored snapshot failed verification; refusing to restore it.",
      );
    }
    generation = Number(row.generation);
    digest = row.digest;
    // Keep whatever was on the local disk before overwriting it.
    if (existsSync(dbFile)) copyFileSync(dbFile, `${dbFile}.pre-restore`);
    writeDatabaseFile(dbFile, bytes);
    restored = true;
    restoredBytes = bytes.length;
  } else {
    mkdirSync(dirname(dbFile), { recursive: true, mode: 0o700 });
  }

  function captureBytes() {
    const temp = join(
      dirname(dbFile),
      `.afterlink-snapshot-${process.pid}.tmp`,
    );
    rmSync(temp, { force: true });
    try {
      // VACUUM INTO writes a consistent copy even while WAL writes continue.
      db.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
      return readFileSync(temp);
    } finally {
      rmSync(temp, { force: true });
    }
  }

  async function capture({ force = false } = {}) {
    if (stopped || !db) return { skipped: "inactive" };
    // A half-finished transaction cannot be vacuumed; the next tick retries.
    if (db.isTransaction) return { skipped: "transaction-open" };
    const changes = Number(db.prepare("SELECT total_changes() AS n").get().n);
    if (!force && changes === lastChanges) return { skipped: "unchanged" };
    const bytes = captureBytes();
    const next = snapshotDigest(bytes);
    if (next === digest) {
      lastChanges = changes;
      return { skipped: "identical", generation };
    }
    if (bytes.length > maxBytes) {
      log.warn?.(
        `Snapshot of ${Math.round(bytes.length / 1048576)}MB exceeds DB_SNAPSHOT_MAX_MB; not replicated.`,
      );
      return { skipped: "too-large" };
    }
    const updated = await client.query(
      `UPDATE ${TABLE}
          SET generation = generation + 1, digest = $1, byte_size = $2,
              snapshot = $3, updated_at = now()
        WHERE id = 1 AND generation = $4
        RETURNING generation`,
      [next, bytes.length, bytes, generation],
    );
    let row = updated.rows[0];
    if (!row) {
      const inserted = await client.query(
        `INSERT INTO ${TABLE}(id, generation, digest, byte_size, snapshot)
         VALUES (1, 1, $1, $2, $3)
         ON CONFLICT (id) DO NOTHING
         RETURNING generation`,
        [next, bytes.length, bytes],
      );
      row = inserted.rows[0];
    }
    if (!row) {
      // Another instance advanced the snapshot: stop rather than overwrite it.
      stopped = true;
      clearInterval(timer);
      timer = null;
      log.warn?.(
        "Another AfterLink instance owns the stored snapshot; replication stopped.",
      );
      return { skipped: "superseded" };
    }
    generation = Number(row.generation);
    digest = next;
    lastChanges = changes;
    return { generation, bytes: bytes.length };
  }

  function queue(options) {
    chain = chain.then(
      () => capture(options),
      () => capture(options),
    );
    return chain.catch((error) => {
      // Losing the database connection must not crash the web service.
      log.warn?.(`Snapshot replication failed: ${error.message}`);
      return { skipped: "error" };
    });
  }

  let pending = null;
  // A Supabase project with no traffic for days is paused by the platform;
  // an occasional ping while the service is awake counts as activity.
  const keepalive = autoStart
    ? setInterval(
        () => void client.query("SELECT 1").catch(() => {}),
        positiveNumber(env.DB_KEEPALIVE_MS, 6 * 60 * 60 * 1000),
      )
    : null;
  keepalive?.unref?.();

  return {
    restored,
    restoredBytes,
    get generation() {
      return generation;
    },
    get active() {
      return !stopped;
    },
    // Called once the schema exists so the first snapshot is complete.
    attach(database) {
      db = database;
      if (autoStart && !timer) {
        timer = setInterval(() => void queue(), interval);
        timer.unref?.();
      }
      return queue({ force: true });
    },
    flush: () => queue({ force: true }),
    // A signup should not wait a whole interval to become durable, and a burst
    // of writes should still produce one upload.
    requestFlush(delay = 2000) {
      if (stopped || pending) return;
      pending = setTimeout(() => {
        pending = null;
        void queue();
      }, delay);
      pending.unref?.();
    },
    async close() {
      stopped = true;
      if (pending) clearTimeout(pending);
      pending = null;
      if (timer) clearInterval(timer);
      timer = null;
      if (keepalive) clearInterval(keepalive);
      await chain.catch(() => {});
      await client.end?.();
    },
  };
}
