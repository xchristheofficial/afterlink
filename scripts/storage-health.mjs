// Local operator command, deliberately not imported into the HTTP service.
import { statfsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";

function check(file) {
  if (!isAbsolute(file || ""))
    return { ok: false, reason: "absolute-db-file-required" };
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    // An empty or unrelated SQLite database can also pass quick_check.
    const { n } = db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name IN ('users','sessions','posts','messages','lb_members')",
      )
      .get();
    if (n !== 5) return { ok: false, reason: "expected-tables-missing" };
    if (db.prepare("PRAGMA quick_check(1)").get().quick_check !== "ok") {
      return { ok: false, reason: "quick-check-failed" };
    }
    const { bavail, bsize } = statfsSync(file, { bigint: true });
    const availableMiB = Number((bavail * bsize) / 1048576n);
    const ok = availableMiB >= 64;
    return {
      ok,
      quickCheck: "ok",
      availableMiB,
      ...(ok ? {} : { reason: "low-free-space" }),
    };
  } catch {
    // Never print SQLite errors (they can include paths and schema content).
    return { ok: false, reason: "database-or-volume-unavailable" };
  } finally {
    db?.close();
  }
}

const result = check(process.env.DB_FILE);
console.log(JSON.stringify(result));
process.exitCode = result.ok ? 0 : 1;
