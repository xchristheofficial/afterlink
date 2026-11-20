import { DatabaseSync } from "node:sqlite";
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
      await ok("groups", a, {
        name: "Movie night",
        topic: "Private screening",
        people: [bob, carol],
      })
    ).id,
    gpath = "linkbacks/" + group;
  assert.equal(
    (await ok("linkbacks?kind=groups", b)).groups[0].groupName,
    "Movie night",
  );
  const filtered = (who, view) => ok("linkbacks?kind=groups&view=" + view, who);
  assert.deepEqual(
    (await filtered(b, "invites")).groups.map((g) => g.id),
    [group],
  );
  assert.equal("topic" in (await filtered(b, "invites")).groups[0], false);
  assert.equal("topic" in (await ok(gpath, b)), false);
  assert.equal((await ok(gpath, a)).topic, "Private screening");
  const edit = { action: "edit", name: "Friday films", topic: "Meet at seven" };
  assert.equal((await req("/api/feed/" + gpath, b, edit)).status, 403);
  await ok(gpath, a, edit);
  assert.equal((await ok(gpath, b)).groupName, edit.name);
  assert.deepEqual((await filtered(b, "unread")).groups, []);
  assert.deepEqual((await ok("linkbacks", b)).groups, []);
  const submission = {
    action: "message",
    message: "Private introduction",
    clientId: "retry-test-token-12345",
  };
  await ok(gpath, a, submission);
  await ok(gpath, a, submission);
  assert.equal((await ok(gpath, a)).messages.length, 1);
  assert.equal((await req("/api/feed/" + gpath, b, submission)).status, 403);
  assert.equal((await ok("unread", b)).groups, 1);
  assert.ok(!("messages" in (await ok(gpath, b))));
  const leavePath = gpath + "/leave-preview",
    alone = await ok(leavePath, a);
  assert.ok(alone.closes);
  assert.deepEqual(
    alone.cancelled.map((x) => x.id),
    [bob, carol],
  );
  assert.equal((await req("/api/feed/" + leavePath, b)).status, 404);
  assert.equal(
    (await req("/api/feed/" + gpath, a, { action: "transfer", member: bob }))
      .status,
    400,
  );
  await ok(gpath, b, { action: "accept" });
  assert.equal(
    (
      await req("/api/feed/" + gpath, a, {
        action: "leave",
        previewToken: alone.token,
      })
    ).status,
    409,
  );
  const impact = await ok(leavePath, a);
  assert.equal(impact.nextAdmin.id, bob);
  assert.deepEqual(
    impact.cancelled.map((x) => x.id),
    [carol],
  );
  await ok(gpath, a, { action: "transfer", member: bob });
  assert.equal((await ok(gpath, b)).admin, bob);
  assert.equal(
    (await req("/api/feed/" + gpath, a, { action: "transfer", member: alice }))
      .status,
    403,
  );
  await ok(gpath, b, { action: "transfer", member: alice });
  await ok(gpath, c, { action: "accept" });
  assert.deepEqual((await filtered(b, "invites")).groups, []);
  assert.deepEqual(
    (await filtered(b, "unread")).groups.map((g) => g.id),
    [group],
  );
  assert.equal((await ok(gpath, b)).topic, edit.topic);
  assert.equal((await req("/api/feed/" + gpath, b, edit)).status, 403);
  assert.equal(
    (await req("/api/feed/" + gpath, a, { ...edit, topic: "x".repeat(201) }))
      .status,
    400,
  );
  assert.equal((await ok(gpath, b)).members.length, 3);
  assert.equal(
    (await req("/api/feed/" + gpath, c, { action: "remove", member: bob }))
      .status,
    403,
  );
  await ok(gpath, b, {
    action: "read",
    through: (await ok(gpath, b)).latest.id,
  });
  assert.equal((await ok("unread", b)).groups, 0);
  assert.deepEqual((await filtered(b, "unread")).groups, []);
  // Exact page-size boundary and a genuine second page; seed only the disposable fixture.
  const fixture = new DatabaseSync(join(dir, "test.sqlite"));
  try {
    const add = fixture.prepare(
      "INSERT INTO lb_messages(gid,author,body,created) VALUES(?,?,?,?)",
    );
    for (let i = 0; i < 59; i++)
      add.run(group, bob, "History " + i, Date.now());
    assert.equal((await ok(gpath, b)).more, false);
    add.run(group, bob, "Last", Date.now());
    const page = await ok(gpath, b);
    assert.equal(page.more, true);
    assert.equal(page.messages.length, 60);
    const older = await ok(gpath + "?before=" + page.messages[0].id, b);
    assert.equal(older.messages.length, 1);
    assert.equal(older.more, false);
  } finally {
    fixture.close();
  }
  await ok(gpath, a, { action: "transfer", member: carol });
  const leavingAdmin = await ok(leavePath, c);
  assert.equal(leavingAdmin.nextAdmin.id, alice);
  await ok(gpath, c, { action: "leave", previewToken: leavingAdmin.token });
  assert.equal((await ok(gpath, b)).admin, alice);
  assert.equal((await ok("unread", c)).groups, 0);
  assert.equal((await req("/api/feed/" + gpath, c)).status, 404);
  await ok("nickname/" + bob, a, { nickname: "Film fan" });
  await ok("typing/" + bob, a, { active: true });
  assert.ok((await ok("typing/" + alice, b)).remaining > 0);
  assert.equal((await ok("typing/" + alice, c)).remaining, 0);
  await ok("settings", b, { typing: false });
  assert.equal((await ok("typing/" + alice, b)).remaining, 0);
  await ok("settings", b, { typing: true });
  const first = (await ok("thread/" + bob, a, { body: "Hello" })).message;
  assert.equal(
    (await ok(`thread/${alice}?opening=1`, b)).firstUnread,
    first.id,
  );
  assert.deepEqual(
    (await ok("inbox?view=unread", b)).threads.map((t) => t.id),
    [alice],
  );
  assert.equal(
    (
      await req(`/api/feed/thread/${alice}`, b, {
        expectedSender: alice,
        body: "Wrong account",
      })
    ).status,
    409,
  );
  await ok("inbox-pin/" + bob, a, { pinned: true });
  await ok("thread/" + carol, a, { body: "Newer conversation" });
  assert.equal((await ok("inbox", a)).threads[0].id, bob);
  assert.equal((await ok("inbox", b)).threads[0].pinnedChat, 0);
  await ok("inbox-pin/" + bob, a, { pinned: false });
  assert.equal((await ok("inbox", a)).threads[0].id, carol);
  const find = (who, peer, term, extra = {}) =>
    ok(`thread/${peer}/search`, who, { term, ...extra });
  assert.deepEqual(
    (await find(b, alice, "hELLo")).messages.map((m) => m.id),
    [first.id],
  );
  assert.deepEqual(
    (await find(b, alice, "hello", { before: first.id })).messages,
    [],
  );
  assert.deepEqual((await find(c, alice, "hello")).messages, []);
  assert.deepEqual(
    (await ok(`thread/${alice}/context/${first.id}`, b)).messages.map(
      (m) => m.body,
    ),
    ["Hello"],
  );
  assert.equal(
    (await req(`/api/feed/thread/${alice}/context/${first.id}`, c)).status,
    404,
  );
  // The upper bound is exclusive, the lower bound inclusive. Sender values
  // are roles resolved in the authenticated thread, never caller-supplied IDs.
  assert.deepEqual(
    (
      await find(b, alice, "", {
        from: "partner",
        startMs: first.created,
        endMs: first.created + 1,
      })
    ).messages.map((m) => m.id),
    [first.id],
  );
  for (const filters of [
    { from: "me" },
    { endMs: first.created },
    { startMs: first.created + 1 },
  ])
    assert.deepEqual((await find(b, alice, "hello", filters)).messages, []);
  assert.deepEqual(
    (await find(c, alice, "", { from: "partner", endMs: first.created + 1 }))
      .messages,
    [],
  );
  for (const invalid of [
    { from: alice },
    { from: "any", term: "" },
    { startMs: "2025-01-01" },
    { startMs: 20, endMs: 10 },
  ])
    assert.equal(
      (
        await req(`/api/feed/thread/${alice}/search`, b, {
          term: "hello",
          ...invalid,
        })
      ).status,
      400,
    );
  assert.equal((await ok("unread", b)).chats, 1);
  const gone = (await ok("thread/" + bob, a, { body: "Vanishing phrase" }))
    .message;
  await ok(`message/${gone.id}/action`, a, { action: "unsend" });
  assert.equal((await find(b, alice, "Vanishing")).messages.length, 0);
  assert.equal(
    (await req(`/api/feed/thread/${alice}/context/${gone.id}`, b)).status,
    404,
  );
  assert.equal((await ok("typing/" + alice, b)).remaining, 0);
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
  assert.equal(
    (await req(`/api/feed/thread/${alice}/search`, b, { term: "Hello" }))
      .status,
    403,
  );
  assert.equal(
    (await req(`/api/feed/thread/${alice}/context/${first.id}`, b)).status,
    403,
  );
  await denied(a, undefined, 404);
  assert.equal((await ok(path, b)).admin, bob);
  assert.equal((await ok(path, b)).messages.length, 1);
  await denied(b, { action: "invite", people: [alice] }, 403);
  await ok(path, b, { action: "leave" });
  await denied(b, undefined, 404);
});
