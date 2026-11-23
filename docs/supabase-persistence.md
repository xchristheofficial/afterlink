# Postgres-backed persistence (Render free plan + Supabase)

Render's free plan has no persistent disk: every deploy, restart and spin-down
starts from a fresh filesystem, so a SQLite file written there disappears and
visitors have to create accounts again. Setting `DATABASE_URL` moves the
durable copy into Postgres.

## How it works

- SQLite stays the live database, on the container's own filesystem.
- At startup the service downloads the stored snapshot, verifies it (SQLite
  header plus SHA-256 digest) and writes it to `DB_FILE` **before** opening the
  database. A snapshot that fails verification stops startup.
- A consistent copy is taken with `VACUUM INTO` (safe while WAL writes
  continue) and uploaded a few seconds after a write, every
  `DB_SYNC_INTERVAL_MS` (default 15s) while the database has changed, and once
  more on `SIGTERM`/`SIGINT` — the signal Render sends on redeploy and
  spin-down.
- Uploads are skipped when the bytes are unchanged, so an idle service is quiet.
- Each upload advances a generation counter. An instance whose generation no
  longer matches stops replicating instead of overwriting newer data. Run **one
  instance** with this setup.
- If `DATABASE_URL` is set but unreachable, the service refuses to start rather
  than silently serving an empty database.

## Supabase setup

1. Open the project → **Project Settings → Database**.
2. If the password is unknown or was ever exposed, use **Reset database
   password** and store the new one in a password manager.
3. Copy the **Session pooler** connection string (host
   `...pooler.supabase.com`, port `5432`). The pooler works over IPv4; the
   direct `db.<ref>.supabase.co` host is IPv6-only and often unreachable from
   Render.
4. Put the password into the string in place of `[YOUR-PASSWORD]`, and
   percent-encode any `@ : / ? # [ ] %` characters it contains.

No schema or migration work is needed in Supabase: the service creates its own
`afterlink_snapshots` table on first connection.

## Render setup

1. Service **afterlink** → **Environment**.
2. Add `DATABASE_URL` = the connection string (Render stores it encrypted; it is
   not in Git).
3. Confirm `NODE_ENV=production`. `DB_FILE` is optional here; `/tmp/afterlink.sqlite`
   is a good explicit value on a diskless plan.
4. **Save, rebuild and deploy.**
5. In the deploy logs expect `AfterLink listening on …`, and from the second
   deploy onward `Restored database from Postgres snapshot #N`.

## Verify (the test that matters)

1. Create an account on the live site.
2. Wait about ten seconds, then **Manual Deploy → Restart service**.
3. Sign in with the same account. It must work, and the data must still be
   there.

## Operator commands

Run locally with `DATABASE_URL` exported in the shell (never commit it):

```sh
npm run db:status                       # generation, size, last update
npm run db:backup -- afterlink-backup.sqlite   # download a verified backup
npm run db:restore -- afterlink-backup.sqlite  # push a known-good database back
```

Take a backup with `db:backup` **before** changing storage settings, migrating
hosts, or deploying schema changes. `db:restore` refuses files that fail
`quick_check` or lack the expected tables. Keep backups and
`AFTERLINK_2FA_KEY` outside the database and out of Git.

## Limits to know

- Recovery point is the last successful upload: an abrupt kill (not a signal)
  can lose up to `DB_SYNC_INTERVAL_MS` of writes.
- The whole database travels in each upload, so this suits a small service.
  Above `DB_SNAPSHOT_MAX_MB` (default 64) the upload is skipped with a warning —
  move to a disk-backed plan or a native Postgres schema before then.
- Uploaded media stored in the database counts toward that size, and each
  upload rewrites the whole row, so a large database under constant writes
  churns Postgres storage. Raise `DB_SYNC_INTERVAL_MS` if that becomes an issue.
- A paused Supabase project (free projects pause after prolonged inactivity)
  blocks startup until it is resumed. While the service is awake it pings
  Postgres every `DB_KEEPALIVE_MS` (default 6h) to count as activity.
