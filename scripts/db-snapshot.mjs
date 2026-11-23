// Operator command for the Postgres-backed snapshot: inspect it, download a
// backup before risky changes, or push a known-good database back.
// Usage: node scripts/db-snapshot.mjs status | pull <file> | push <file>
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { snapshotDigest, sslOption } from "../remote-store.mjs";

const TABLE = "afterlink_snapshots";
const [command, file] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!process.env.DATABASE_URL) fail("Set DATABASE_URL first.");
if (!["status", "pull", "push"].includes(command || ""))
  fail(
    "Usage: node scripts/db-snapshot.mjs status | pull <file> | push <file>",
  );
if (command !== "status" && !file) fail(`${command} needs a file path.`);

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: sslOption(process.env),
  application_name: "afterlink-cli",
  connectionTimeoutMillis: 20000,
});
try {
  await client.connect();
} catch (error) {
  fail(`Could not connect with DATABASE_URL: ${error.message}`);
}

// Never replace a good snapshot with a corrupt or unrelated SQLite file.
function verify(path) {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    if (db.prepare("PRAGMA quick_check(1)").get().quick_check !== "ok")
      fail("Refusing to push: quick_check failed.");
    const { n } = db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name IN ('users','sessions')",
      )
      .get();
    if (n !== 2)
      fail("Refusing to push: expected AfterLink tables are missing.");
  } finally {
    db?.close();
  }
}

try {
  if (command === "status") {
    const { rows } = await client.query(
      `SELECT generation, digest, byte_size, updated_at FROM ${TABLE} WHERE id = 1`,
    );
    console.log(JSON.stringify(rows[0] ?? { empty: true }, null, 2));
  } else if (command === "pull") {
    const { rows } = await client.query(
      `SELECT digest, snapshot FROM ${TABLE} WHERE id = 1`,
    );
    if (!rows.length) fail("No snapshot stored yet.");
    const bytes = Buffer.from(rows[0].snapshot);
    if (snapshotDigest(bytes) !== rows[0].digest)
      fail("Snapshot digest mismatch.");
    writeFileSync(file, bytes, { mode: 0o600 });
    console.log(`Wrote ${bytes.length} bytes to ${file}`);
  } else {
    verify(file);
    const bytes = readFileSync(file);
    const { rows } = await client.query(
      `INSERT INTO ${TABLE}(id, generation, digest, byte_size, snapshot)
       VALUES (1, 1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET generation = ${TABLE}.generation + 1, digest = EXCLUDED.digest,
             byte_size = EXCLUDED.byte_size, snapshot = EXCLUDED.snapshot,
             updated_at = now()
       RETURNING generation`,
      [snapshotDigest(bytes), bytes.length, bytes],
    );
    console.log(
      `Stored snapshot #${rows[0].generation} (${bytes.length} bytes)`,
    );
  }
} finally {
  await client.end();
}
