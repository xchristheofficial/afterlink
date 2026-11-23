import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The failure this guards against: a free-plan host wipes the container
// filesystem on every deploy, so a member had to sign up again each visit.
// Here the SQLite file is deleted between processes and only the snapshot in
// the (faked) Postgres store carries the account across.
test("an account created before a redeploy still signs in afterwards", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "afterlink-restart-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const database = join(dir, "afterlink.sqlite");
  const stored = join(dir, "snapshot-store.json");
  let server, base;

  async function start() {
    server = spawn(
      process.execPath,
      ["--import", "./tests/helpers/use-fake-pg.mjs", "server.mjs"],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          DB_FILE: database,
          DATABASE_URL: "postgres://afterlink.test/postgres",
          FAKE_PG_FILE: stored,
          PORT: "0",
        },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    let output = "";
    for await (const chunk of server.stdout) {
      output += chunk;
      const port = output.match(/listening on (\d+)/);
      if (port) {
        base = "http://127.0.0.1:" + port[1];
        return output;
      }
    }
    throw Error("Server exited during startup");
  }
  async function stopGracefully() {
    const exited = once(server, "exit");
    // The signal a redeploy or spin-down sends.
    server.kill("SIGTERM");
    await exited;
    server = null;
  }
  t.after(async () => {
    if (server && server.exitCode === null) {
      server.kill("SIGKILL");
      await once(server, "exit");
    }
  });

  const call = (path, cookie = "", data) =>
    fetch(base + "/api/" + path, {
      headers: {
        cookie,
        "Content-Type": "application/json",
        "X-AfterLink-Request": "1",
      },
      ...(data === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(data) }),
    });

  const password = "test-only-password-123";
  await start();
  const signup = await call("signup", "", {
    email: "dana@example.test",
    password,
    fullName: "dana",
    username: "dana",
  });
  assert.equal(signup.status, 201);
  const cookie = signup.headers.get("set-cookie").split(";")[0];
  const posted = await call("feed/posts", cookie, {
    body: "Written before the redeploy",
  });
  assert.ok(posted.ok);
  await stopGracefully();

  // A redeploy brings a new container: nothing on disk survives.
  for (const suffix of ["", "-wal", "-shm", ".pre-restore"])
    rmSync(database + suffix, { force: true });
  assert.equal(existsSync(database), false);
  assert.ok(existsSync(stored), "the snapshot must live outside the container");

  const log = await start();
  assert.match(log, /Restored database from Postgres snapshot #\d+/);
  const signin = await call("signin", "", {
    email: "dana@example.test",
    password,
  });
  assert.equal(
    signin.status,
    200,
    "the account must still exist after the redeploy",
  );
  const session = signin.headers.get("set-cookie").split(";")[0];
  const feed = await (await call("feed", session)).json();
  assert.equal(feed.posts[0].body, "Written before the redeploy");

  // A wrong password must still be refused by the restored database.
  const refused = await call("signin", "", {
    email: "dana@example.test",
    password: "not-the-password",
  });
  assert.equal(refused.status, 401);
});
