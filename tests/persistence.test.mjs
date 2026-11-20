import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Two distinct production server processes share only the volume, not memory.
test("accounts and member activity survive a process replacement", async (t) => {
  const volume = await mkdtemp(join(tmpdir(), "afterlink-volume-"));
  let server, base;
  async function start() {
    server = spawn(process.execPath, ["server.mjs"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DB_FILE: join(volume, "afterlink.sqlite"),
        PORT: "0",
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const [line] = await Promise.race([
      once(server.stdout, "data"),
      once(server, "exit").then(() => {
        throw Error("Server exited during startup");
      }),
    ]);
    base = "http://127.0.0.1:" + String(line).match(/on (\d+)/)[1];
  }
  async function stop() {
    if (!server || server.exitCode !== null || server.signalCode) return;
    const stopped = once(server, "exit");
    server.kill("SIGKILL");
    await stopped;
    server = null;
  }
  t.after(async () => {
    await stop();
    await rm(volume, { recursive: true, force: true });
  });
  const request = (path, cookie = "", data) =>
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
  async function ok(path, cookie, data) {
    const r = await request(path, cookie, data);
    assert.ok(r.ok, `${path}: ${r.status}`);
    return r.json();
  }
  const password = "test-only-password-123";
  async function sign(name, create) {
    const r = await request(create ? "signup" : "signin", "", {
      email: name + "@example.test",
      password,
      ...(create ? { fullName: name, username: name } : {}),
    });
    assert.equal(r.status, create ? 201 : 200);
    return r.headers.get("set-cookie").split(";")[0];
  }
  await start();
  const a = await sign("alice", true),
    b = await sign("bob", true),
    alice = (await ok("feed/settings", a)).id,
    bob = (await ok("feed/settings", b)).id;
  await ok("feed/follow", b, { id: alice, on: true });
  const post = await ok("feed/posts", a, { body: "A saved update" });
  await ok("feed/save", b, { id: post.id, on: true });
  await ok("feed/settings", b, { theme: "dark" });
  await ok("feed/thread/" + bob, a, { body: "A private message" });
  await stop();
  await start();
  assert.equal((await ok("session", b)).user.email, "bob@example.test");
  const fresh = await sign("bob", false);
  assert.equal((await ok("feed/settings", fresh)).prefs.theme, "dark");
  assert.equal((await ok("feed?view=saved", fresh)).posts[0].id, post.id);
  assert.equal((await ok("feed", fresh)).posts[0].body, "A saved update");
  assert.equal(
    (await ok("feed/thread/" + alice, fresh)).messages[0].body,
    "A private message",
  );
});
