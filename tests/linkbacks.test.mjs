import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

test("Linkback invitations, post visibility, membership and decisions are private", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "afterlink-linkbacks-")),
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
    { cookie: c, id: carol } = await signup("carol");

  const group = (
      await ok("groups", a, { name: "Movie night", people: [bob, carol] })
    ).id,
    gpath = "linkbacks/" + group;
  assert.equal(
    (await ok("linkbacks?kind=groups", b)).groups[0].groupName,
    "Movie night",
  );
  assert.deepEqual((await ok("linkbacks", b)).groups, []);
  await ok(gpath, a, { action: "message", message: "Private introduction" });
  assert.ok(!("messages" in (await ok(gpath, b))));
  await ok(gpath, b, { action: "accept" });
  await ok(gpath, c, { action: "accept" });
  assert.equal((await ok(gpath, b)).members.length, 3);
  assert.equal(
    (await req("/api/feed/" + gpath, c, { action: "remove", member: bob }))
      .status,
    403,
  );
  await ok(gpath, c, { action: "leave" });
  assert.equal((await req("/api/feed/" + gpath, c)).status, 404);
  await ok("nickname/" + bob, a, { nickname: "Film fan" });
  await ok("thread/" + bob, a, { body: "Hello" });
  assert.equal(
    (await ok("inbox?q=Film%20fan", a)).threads[0].nickname,
    "Film fan",
  );
  assert.equal((await ok("thread/" + bob, c)).member.nickname, "");
  assert.equal((await ok("thread/" + bob, a)).member.name, "bob");
  await ok("nickname/" + bob, a, { nickname: "" });
  assert.equal((await ok("thread/" + bob, a)).member.nickname, "");
  const call = await ok("calls", a, {
    action: "start",
    kind: "video",
    peer: bob,
  });
  const watch = (step) => ({ action: "watch", id: call.id, step });
  assert.equal((await req("/api/feed/calls", a, watch("start"))).status, 409);
  await ok("calls", b, { action: "accept", id: call.id });
  await ok("calls", b, watch("start"));
  assert.equal((await req("/api/feed/calls", a, watch("start"))).status, 409);
  assert.equal((await req("/api/feed/calls", c, watch("stop"))).status, 404);
  assert.equal((await req("/api/feed/calls", a, watch("stop"))).status, 409);
  await ok("calls", b, watch("stop"));
  await ok("calls", a, { action: "end", id: call.id });
  const post = (await ok("posts", c, { body: "The original caption" })).id;
  const { id: gid } = await ok("linkbacks", a, {
    post,
    people: [bob],
    message: "Private plan",
  });
  const path = "linkbacks/" + gid;
  const denied = async (cookie, data, status) =>
    assert.equal((await req("/api/feed/" + path, cookie, data)).status, status);
  // Even the post author cannot enumerate other groups or read their decisions.
  assert.deepEqual((await ok("linkbacks?post=" + post, c)).groups, []);
  await denied(c, undefined, 404);
  const invitation = await ok(path, b);
  assert.equal(invitation.pending, true);
  assert.equal(invitation.post.body, "The original caption");
  assert.equal(invitation.from.id, alice);
  assert.ok(
    !("messages" in invitation) &&
      !("members" in invitation) &&
      !("decision" in invitation) &&
      !("latest" in invitation),
  );
  await denied(b, { action: "message", message: "before acceptance" }, 403);
  await ok(path, b, { action: "accept" });
  await ok(path, b, { action: "message", message: "Saturday at 7" });
  const detail = await ok(path, b);
  assert.equal(detail.admin, alice);
  assert.equal(detail.messages.length, 2);
  await ok(path, b, { action: "pin", message: detail.latest.id });
  await denied(b, { action: "remove", member: alice }, 403);
  const other = (
    await ok("linkbacks", a, {
      post,
      people: [carol],
      message: "Separate team",
    })
  ).id;
  assert.equal((await ok("linkbacks?post=" + post, b)).groups.length, 1);
  assert.equal((await req("/api/feed/linkbacks/" + other, b)).status, 404);
  await denied(
    a,
    { action: "pin", message: (await ok("linkbacks/" + other, a)).latest.id },
    400,
  );
  await ok("linkbacks/" + other, c, { action: "leave" });
  assert.deepEqual((await ok("linkbacks", c)).groups, []);
  await ok("settings", c, { private: true });
  const hidden = await ok(path, b);
  assert.equal(hidden.post, null);
  assert.equal(hidden.decision.body, "Saturday at 7");
  assert.equal(
    (await ok("linkbacks", a)).groups.every((g) => g.post === null),
    true,
  );
  await ok(path, a, { action: "invite", people: [carol] });
  await ok(path, a, { action: "resend", member: carol });
  await ok(path, a, { action: "remove", member: carol });
  await denied(c, undefined, 404);
  await ok("delete-account", c, { confirmation: "DELETE" });
  assert.equal((await ok(path, a)).post, null);
  assert.equal((await ok(path, b)).decision.id, detail.latest.id);
  await ok("restrict", a, { id: bob, kind: "block", on: true });
  await denied(a, undefined, 404);
  assert.equal((await ok(path, b)).admin, bob);
  assert.equal((await ok(path, b)).messages.length, 1);
  await denied(b, { action: "invite", people: [alice] }, 403);
  await ok(path, b, { action: "leave" });
  await denied(b, undefined, 404);
});
