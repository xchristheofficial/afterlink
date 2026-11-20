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
  const data = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    legacy = "/9j/2Q==";
  await ok("feed/thread/" + bob, a, { photo: legacy });
  for (const once of [false, true])
    await ok("feed/thread/" + bob, a, {
      media: { type: "image/gif", once, data },
    });
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
  const [, photo, kept, single] = (await ok("feed/thread/" + alice, b))
    .messages;
  assert.equal(photo.hasPhoto, 1);
  const load = async (path, user) =>
    Buffer.from(await (await request(path, user)).arrayBuffer()).toString(
      "base64",
    );
  assert.equal(await load("feed/message-photo/" + photo.id, b), legacy);
  const path = "feed/message-media/" + single.id,
    open = path + "/open",
    third = await sign("carol", true);
  assert.equal(await load("feed/message-media/" + kept.id, b), data);
  assert.equal(await load("feed/message-media/" + kept.id, b), data);
  assert.equal((await request(path, b)).status, 404);
  assert.equal((await request(open, a, {})).status, 404);
  assert.equal((await request(open, third, {})).status, 404);
  // A block after sending prevents an open. Reading the conversation never consumes it.
  await ok("feed/restrict", b, { kind: "block", id: alice, on: true });
  assert.equal((await request(open, b, {})).status, 404);
  await ok("feed/restrict", b, { kind: "block", id: alice, on: false });
  const opens = await Promise.all([request(open, b, {}), request(open, b, {})]);
  assert.deepEqual(opens.map((x) => x.status).sort(), [200, 404]);
  assert.equal((await opens.find((x) => x.ok).json()).data, data);
  await stop();
  await start();
  assert.equal((await request(open, b, {})).status, 404);
  assert.ok((await ok("feed/thread/" + bob, a)).messages.at(-1).opened);
  const calls = "feed/calls",
    startCall = { action: "start", peer: bob, kind: "audio" };
  await ok("feed/settings", b, { messages: "none" });
  assert.equal((await request(calls, a, startCall)).status, 403);
  await ok("feed/settings", b, { messages: "everyone" });
  const { id } = await ok(calls, a, startCall);
  assert.equal((await ok(calls, third)).call, null);
  assert.equal(
    (await request(calls, third, { id, action: "end" })).status,
    404,
  );
  assert.equal((await request(calls, a, { id, action: "accept" })).status, 409);
  assert.equal((await request(calls, a, startCall)).status, 409);
  await ok(calls, b, { id, action: "accept" });
  const recording = (step) => ({ id, action: "recording", step });
  await ok(calls, a, recording("request"));
  assert.equal((await request(calls, a, recording("allow"))).status, 409);
  assert.equal((await request(calls, a, recording("begin"))).status, 409);
  await ok(calls, b, recording("allow"));
  await ok(calls, a, recording("begin"));
  assert.equal((await ok(calls, b)).call.recording.state, "active");
  await ok(calls, b, recording("stop"));
  await ok(calls, b, { id, action: "end" });
  assert.equal((await ok(calls, a)).call, null);
  const thread = "feed/thread/" + bob,
    carol = (await ok("feed/settings", third)).id;
  const action = (id) => "feed/message/" + id + "/action";
  const sent = {
    body: "An original",
    clientId: "01234567-0123-4123-8123-012345678901",
  };
  const original = (await ok(thread, a, sent)).message.id;
  assert.equal((await ok(thread, a, sent)).message.id, original);
  await ok("feed/thread/" + alice, b, { body: "Replying", replyTo: original });
  assert.equal(
    (
      await request("feed/thread/" + carol, a, {
        body: "wrong chat",
        replyTo: original,
      })
    ).status,
    400,
  );
  assert.equal(
    (await request(action(original), third, { action: "react", emoji: "🙂" }))
      .status,
    404,
  );
  await ok(action(original), b, { action: "react", emoji: "🙂" });
  await ok(action(original), b, { action: "pin" });
  let result = await ok(thread, a);
  assert.equal(result.pin.id, original);
  assert.equal(result.messages.at(-1).replyBody, sent.body);
  assert.equal(result.messages.at(-2).reactions, '["🙂"]');
  assert.equal(
    (await request(action(single.id), b, { action: "forward", peer: carol }))
      .status,
    403,
  );
  await ok(action(kept.id), b, { action: "forward", peer: carol });
  const copy = (await ok(thread, third)).messages.at(-1);
  assert.equal(copy.forwarded, 1);
  assert.equal(await load("feed/message-media/" + copy.id, third), data);
  assert.equal(
    (await request(action(original), b, { action: "unsend" })).status,
    403,
  );
  await ok(action(original), a, { action: "unsend" });
  result = await ok(thread, a);
  assert.equal(result.pin, null);
  assert.equal(result.messages.at(-1).replyRemoved, 1);
  assert.equal(result.messages.at(-1).replyBody, "");
  assert.equal(result.messages.at(-2).reactions, "[]");
  await ok(action(kept.id), a, { action: "unsend" });
  assert.equal((await request("feed/message-media/" + kept.id, b)).status, 404);
  await ok("feed/notes", a, { body: "In Nairobi" });
  await ok("feed/follow", b, { id: alice, on: true });
  await stop();
  await start();
  assert.ok(
    (await ok("feed/notes", b)).notes.some((n) => n.body === "In Nairobi"),
  );
  assert.ok(!(await ok("feed/notes", third)).notes.some((n) => n.id === alice));
  await ok("feed/notes", a, { body: "" });
  assert.ok(!(await ok("feed/notes", b)).notes.some((n) => n.id === alice));
});
