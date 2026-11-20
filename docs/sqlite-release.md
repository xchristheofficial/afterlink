# Releasing a SQLite schema change

**Decision rule:** roll back the code on the current database if the old code is compatible. Restoring yesterday’s database is not a code rollback: it also rolls back messages, deletions, blocks, session revocations and view-once opens. Keep writes paused until you know which path is safe.

### Before changing the release

1. Record the current release SHA, the absolute `DB_FILE`, the persistent mount, and how to recover the authenticator encryption key. Keep these in the private deployment record, not in a ticket visible to members. A healthy file on an ephemeral mount still disappears on redeploy.
2. From the service shell run `npm run --silent storage:health` with the service’s `DB_FILE`. Expect `ok: true`. It opens the existing file read-only, checks for five core tables, runs `PRAGMA quick_check(1)` and reports available MiB. Missing tables, a failed read/check or less than 64 MiB free gives a nonzero exit. This is an on-demand scan, **not** an HTTP readiness probe or proof of persistence. Budget extra room for the migration, WAL and backup even if it passes.
3. Pause writes, take a consistent SQLite backup (see [storage setup](../README.md#keeping-data-across-deployments)), and save it off-volume in private storage. Keep the key separately. Record backup time, checksum and counts for affected tables. Don’t copy a live main file without its WAL. Don’t trust a backup until you’ve restored it.
4. Restore a copy into an empty private directory and compare counts. Run `PRAGMA integrity_check;` (expect only `ok`) and `PRAGMA foreign_key_check;` (expect no rows). Test **both** the candidate and the previous release against disposable copies of the upgraded schema, isolated from traffic, mail and other external services. Check existing rows, defaults, and inserts from the old code. A new required column or changed trigger can break old writes even if old reads work.

### Before reopening traffic

Start a single writer with the same persistent mount and filename. Recheck storage health and counts, inspect `PRAGMA table_info(<affected_table>);` with the actual table name, and confirm the intended columns/defaults. On an isolated restored copy, sign in as a test member and verify reads and writes across a restart. Don’t enable traffic on an unexpectedly empty database.

### If the release fails

- Stop writes and preserve a **second** consistent copy of the current database. Do not delete WAL files, drop columns by hand or overwrite the only volume. Note whether any writes happened after the pre-release backup.
- **Old code passed compatibility checks:** restart that release against the current file. Verify the mount, data and normal writes before reopening traffic. Leave the added columns in place.
- **Old code is incompatible:** prefer a forward fix. If a restore is necessary, restore the verified backup to a **fresh** location with no old sidecars. Keep the failed database untouched. Reconcile later writes and privacy changes, especially revoked sessions and consumed media, before serving it. If that isn’t possible, keep traffic paused and escalate the data-loss decision rather than silently rewinding accounts.

### Rehearse without production data

Run `npm run test:restore`. It starts a disposable AfterLink instance, snapshots committed data while WAL is active, writes one later post, then starts a new instance from the snapshot alone. It checks that the earlier post, settings, session and kept attachment survive, the later post is absent, and an opened view-once attachment stays consumed. This exercises the procedure, not your production backup or key.
