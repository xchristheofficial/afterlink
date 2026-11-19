import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TOTP } from "otpauth";

test("member settings enforce privacy, private collections, story audiences and authenticator login", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "afterlink-settings-")),
    server = spawn(process.execPath, ["server.mjs"], {
      env: {
        ...process.env,
        PORT: 0,
        NODE_ENV: "test",
        DB_FILE: join(dir, "test.sqlite"),
        AFTERLINK_2FA_KEY: randomBytes(32).toString("base64"),
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
  t.after(async () => {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
    await rm(dir, { recursive: true, force: true });
  });
  const [line] = await once(server.stdout, "data"),
    base = "http://127.0.0.1:" + String(line).match(/on (\d+)/)[1];
  const req = (path, cookie = "", data) =>
    fetch(base + path, {
      headers: {
        cookie,
        "X-AfterLink-Request": "1",
        "Content-Type": "application/json",
      },
      ...(data === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(data) }),
    });
  async function ok(path, cookie, data) {
    const r = await req("/api/feed/" + path, cookie, data);
    assert.ok(r.ok, [path, r.status].join(":"));
    return r.json();
  }
  const pass = "correct-horse-test-password";
  async function signup(name) {
    const r = await req("/api/signup", "", {
      fullName: name,
      username: name,
      email: name + "@example.test",
      password: pass,
    });
    assert.equal(r.status, 201);
    const cookie = r.headers.get("set-cookie").split(";")[0];
    return { cookie, id: (await ok("settings", cookie)).id };
  }
  const { cookie: a, id: alice } = await signup("alice"),
    { cookie: b, id: bob } = await signup("bob"),
    { cookie: c } = await signup("carol");
  await ok("follow", b, { id: alice, on: true });
  assert.deepEqual(
    (await ok("connections?id=" + alice, b)).Followers.map((x) => x.id),
    [bob],
  );
  await ok("settings", a, {
    messages: "followers",
    mentions: "followers",
    like: false,
    downloads: true,
  });
  assert.equal(
    (await req("/api/feed/thread/" + alice, c, { body: "hello" })).status,
    403,
  );
  await ok("thread/" + alice, b, { body: "hello" });
  const file = (await readFile("public/assets/editor-avatar.webp")).toString(
    "base64",
  );
  const story = await ok("stories", a, {
    caption: "Only you",
    file,
    template: null,
    audience: "friends",
    friends: [bob],
    replies: true,
  });
  assert.equal((await ok("stories", b)).stories[0].id, story.id);
  assert.equal((await ok("stories", c)).stories.length, 0);
  assert.equal((await req("/api/feed/story-media/" + story.id, c)).status, 404);
  await ok("story-reply", b, { id: story.id, body: "Hello" });
  const post = await ok("posts", a, {
    body: "first",
    media: [{ type: "image/webp", data: file }],
  });
  await ok("save", b, { id: post.id, on: true });
  await ok("collection", b, { name: "Ideas" });
  const col = (await ok("library", b)).collections[0].id;
  await ok("collection", b, { id: col, post: post.id, on: true });
  assert.deepEqual((await ok("library", c)).collections, []);
  assert.equal((await ok("library", b)).links.length, 1);
  await ok("heart", b, { post: post.id, on: true });
  assert.ok(!(await ok("notices", a)).notices.some((n) => n.kind === "like"));
  await ok("restrict", b, { id: alice, on: true, kind: "mute" });
  assert.equal((await ok("discover", b)).posts.length, 0);
  await ok("restrict", b, { id: alice, on: false, kind: "mute" });
  await ok("report", b, { id: alice, post: post.id, reason: "Spam" });
  await ok("restrict", a, { id: bob, on: true, kind: "block" });
  assert.equal((await req("/api/feed/post/" + post.id, b)).status, 404);
  assert.equal((await ok("library", b)).posts.length, 0);
  assert.equal(
    (await req("/api/feed/thread/" + alice, b, { body: "hello" })).status,
    403,
  );
  assert.equal((await req("/api/feed/story-media/" + story.id, b)).status, 404);
  await ok("restrict", a, { id: bob, on: false, kind: "block" });
  const { key } = await ok("security/factor/setup", c, { password: pass }),
    code = new TOTP({ secret: key }).generate(),
    { codes } = await ok("security/factor/enable", c, { code });
  assert.equal(codes.length, 8);
  const signin = { email: "carol@example.test", password: pass };
  const pending = await req("/api/signin", "", signin);
  assert.equal((await pending.json()).requiresCode, true);
  assert.equal(pending.headers.get("set-cookie"), null);
  assert.equal((await req("/api/signin", "", { ...signin, code })).status, 403);
  const login = await req("/api/signin", "", { ...signin, code: codes[0] });
  assert.equal(login.status, 200);
  assert.equal(
    (await req("/api/signin", "", { ...signin, code: codes[0] })).status,
    403,
  );
  await ok("security/logout-others", c, {});
  assert.equal(
    (
      await req(
        "/api/feed/security",
        login.headers.get("set-cookie").split(";")[0],
      )
    ).status,
    401,
  );
  await ok("security/factor/disable", c, { password: pass, code: codes[1] });
  assert.equal((await ok("security", c)).factor, false);
});
