// End-to-end on the real page shells. APIs are in-memory fixtures, never SQLite.
import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import express from "express";
import { chromium } from "playwright";
import { memberAssets } from "../web-assets.mjs";
const app = express(),
  now = Date.now(),
  posts = [
    ["Zuri", "Sky", "image/webp"],
    ["Ari", "River", "video/webm"],
    ["Bo", "Walk", null],
    ["Mia", "Road", "video/webm"],
  ].map(([name, body, type], i) => ({
    name,
    body,
    id: i + 1,
    author: i + 10,
    created: now + i,
    media: type ? [{ id: i + 1, type }] : [],
    audience: i === 1 ? "followers" : "everyone",
    views: 12,
    likes: 0,
    saves: 0,
    comments: 0,
    shares: 0,
  })),
  notices = [
    ["mention", 0, 0],
    ["mention", 0, 10],
    ["like", 0, 0],
    ["mention", 1, 0],
  ].map(([kind, seen, days], i) => ({
    id: i + 1,
    actor: i + 3,
    name: "Person " + i,
    kind,
    seen,
    created: now - days * 86400000,
  })),
  read = [],
  requests = [];
let priv = false,
  denyContext = false,
  pendingGroup = false,
  expireNotices = false;
const dm = Array.from({ length: 80 }, (_, i) => ({
  id: i + 1,
  created: Date.UTC(2026, 0, 1 + i, 12),
  sender: 2,
  body: `Message ${i + 1}`,
  seen: true,
  ...(i === 0 || i === 79
    ? { mediaType: "image/gif" }
    : i === 78
      ? { mediaType: "image/webp", onceOnly: true }
      : {}),
}));
const group = {
  id: 5,
  groupName: "Hike",
  uid: 1,
  admin: 1,
  members: [{ id: 1, name: "Ari", joined: 1 }],
  count: 1,
  decision: { id: 2, body: "Meet here" },
  messages: [{ id: 3, body: "Late note", name: "Nia", created: now }],
  more: true,
};
app.use(express.json());
app.use((req, res, next) => {
  requests.push(req.originalUrl);
  next();
});
app.get(
  ["/notifications", "/saved", "/reels", "/messages/2", "/groups/5"],
  (_, r) => r.sendFile(resolve("public/social.html")),
);
const html = await readFile("public/index.html", "utf8");
app.get("/profile", (_, r) =>
  r
    .type("html")
    .send(
      memberAssets(html, "/profile").replace(
        "<!-- member-session -->",
        '<meta name="member-session" content="fixture">',
      ),
    ),
);
app.get("/api/feed/profile", (_, r) =>
  r.json({
    profile: { id: 1, name: "Member", private: priv },
    own: true,
    posts,
  }),
);
app.get("/api/feed/settings", (_, r) => r.json({ id: 1, prefs: {} }));
app.get("/api/feed/unread", (_, r) => r.json({}));
app.get("/api/feed/library", (_, r) =>
  r.json({
    posts,
    collections: [
      { id: 1, name: "Ideas" },
      { id: 2, name: "Trips" },
    ],
    links: [{ post: 2, collection: 2 }],
  }),
);
app.get("/api/feed/notices", (_, r) =>
  expireNotices ? r.sendStatus(401) : r.json({ notices }),
);
app.post("/api/feed/notices/read", (q, r) => {
  read.push(q.body);
  notices.find((n) => n.id === q.body.id).seen = 1;
  r.json({ ok: true });
});
app.get("/api/feed/discover", (_, r) =>
  r.json({ posts: posts.filter((p) => p.media[0]?.type === "video/webm") }),
);
app.get("/api/feed/post/:id", (q, r) => {
  const post = posts.find((p) => p.id == q.params.id);
  r.json({ post, author: { id: post.author, name: post.name }, own: true });
});
app.get("/api/feed/notes", (_, r) => r.json({ notes: [], mine: 1 }));
app.get("/api/feed/inbox", (_, r) => r.json({ threads: [] }));
app.get("/api/feed/calls", (_, r) => r.json({ call: null }));
app.get("/api/feed/thread/2", (q, r) => {
  const all = dm.filter(
    (m) => !q.query.before || m.id < Number(q.query.before),
  );
  r.json({
    viewer: 1,
    member: { id: 2, name: "Nia" },
    messages: all.slice(-3),
    more: all.length > 3,
    ...(q.query.opening ? { firstUnread: null } : {}),
  });
});
app.get("/api/feed/thread/2/context/:id", (q, r) =>
  denyContext
    ? r.status(403).json({ error: "Message unavailable." })
    : r.json({ messages: dm.filter((m) => m.id == q.params.id) }),
);
app.get("/api/feed/linkbacks", (_, r) => r.json({ groups: [group] }));
app.get("/api/feed/linkbacks/5", (q, r) =>
  r.json(
    pendingGroup
      ? { pending: true, groupName: "Hike", id: 5 }
      : q.query.before
        ? {
            ...group,
            messages: [
              { id: 1, name: "Nia", body: "Earlier note", created: now },
              { ...group.decision, name: "Ari", created: now },
            ],
            more: false,
          }
        : group,
  ),
);
app.get(["/api/feed/avatar/:id", "/api/feed/message-media/:id"], (_, r) =>
  r.sendFile(resolve("public/assets/avatar-default.webp")),
);
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
let browser;
try {
  await once(server, "listening");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const page = await browser.newPage({
      viewport: { width: 412, height: 850 },
      timezoneId: "Africa/Nairobi",
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.setDefaultTimeout(4000);
  await page.addInitScript(() => {
    window.EventSource = class extends EventTarget {
      close() {}
    };
  });
  const go = (route) =>
      page.goto(`http://127.0.0.1:${server.address().port}` + route),
    btn = (name) => page.getByRole("button", { name, exact: true }),
    field = (name) => page.getByLabel(name, { exact: true }),
    txt = (text) => page.getByText(text, { exact: true }),
    dialog = page.getByRole("dialog"),
    close = () => page.keyboard.press("Escape");
  await go("/notifications");
  await txt("Notification tools").click();
  await btn("Mentions").click();
  await field("Unread only").check();
  await field("Time period").selectOption("1");
  await txt("1 shown · 1 unread").waitFor();
  await btn("Mark shown as read").click();
  await txt("0 shown · 0 unread").waitFor();
  assert.deepEqual(read, [{ id: 1 }]);
  notices.push({ ...notices[0], name: "New member", seen: 0, id: 9 });
  await btn("Refresh notifications").click();
  await txt("New member mentioned you").waitFor();
  await btn("Mark read").click();
  await txt("0 shown · 0 unread").waitFor();
  assert.deepEqual(read, [{ id: 1 }, { id: 9 }]);
  await go("/saved");
  await txt("Saved library tools").click();
  await field("Sort saved posts").selectOption("author");
  assert.deepEqual(await page.locator(".saved-author").allTextContents(), [
    "Ari",
    "Bo",
    "Mia",
    "Zuri",
  ]);
  assert.equal(
    await page.locator(".saved-author").first().getAttribute("href"),
    "/profile/11",
  );
  await field("Find collections by name").fill("tr");
  assert.equal(await page.locator(".collection-tile").count(), 1);
  await field("Not in a collection").check();
  await field("Attachment type").selectOption("video/");
  assert.deepEqual(
    await page.locator(".library-item strong").allTextContents(),
    ["Road"],
  );
  await field("Hide media previews").check();
  assert.equal(await page.locator(".library-item video").count(), 0);
  await go("/reels");
  await txt("Playback settings").click();
  await field("Reel speed").selectOption("1.5");
  await field("Loop this reel").check();
  await field("Mute reel sound").check();
  await field("Focus on player").check();
  assert.ok(!(await page.locator(".reel-list").isVisible()));
  await btn("Next reel").click();
  await page.waitForURL("**/reels?id=4");
  await page.waitForFunction(
    () =>
      document.querySelector(".player video")?.getAttribute("aria-label") ===
      "Road",
  );
  assert.deepEqual(
    await page
      .locator(".player video")
      .evaluate((v) => [v.playbackRate, v.loop, v.muted]),
    [1.5, true, true],
  );
  assert.ok(await btn("Next reel").isDisabled());
  await btn("Previous reel").click();
  await page.waitForURL("**/reels?id=2");
  const paused = await page.evaluate(() => {
    let count = 0;
    document.querySelector(".player video").pause = () => count++;
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.hidden;
    return count;
  });
  assert.equal(paused, 1);
  await go("/profile");
  await field("Filter these posts").fill("riv");
  assert.deepEqual(
    await page.locator(".member-post .caption").allTextContents(),
    ["River"],
  );
  await btn("Preview as non-follower").click();
  assert.equal(await dialog.getByText("River", { exact: true }).count(), 0);
  await dialog.getByText("Sky", { exact: true }).waitFor();
  await btn("Close preview").click();
  priv = true;
  await btn("Preview as non-follower").click();
  await txt("This account’s posts are private.").waitFor();
  assert.equal(await dialog.getByText("Sky", { exact: true }).count(), 0);
  await go("/messages/2");
  const library = async () => {
    await btn("Conversation details").click();
    await btn("Conversation library").click();
  };
  await page
    .locator(".bubble")
    .last()
    .getByRole("button", { name: "Message actions" })
    .click();
  await btn("Bookmark on this device").click();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("afterlink.dmMarks.1.2")),
    "[80]",
  );
  await library();
  await btn("Private bookmarks").click();
  denyContext = true;
  await btn("Open message 80").click();
  await txt("Message unavailable.").waitFor();
  await close();
  denyContext = false;
  await library();
  await btn("Kept photos and GIFs").click();
  await txt("1 kept images").waitFor();
  assert.equal(await dialog.locator(".dm-image").count(), 1);
  assert.ok(!requests.some((p) => /message-media\/79/.test(p)));
  await btn("Check earlier attachments").click();
  await field("Conversation date").fill("2026-01-01");
  await btn("Jump to date").click();
  await page
    .locator(".finder-selected")
    .getByText("Message 1", { exact: true })
    .waitFor();
  await close();
  await btn("Conversation details").click();
  await dialog.getByRole("button", { name: "Local call options" }).click();
  await field("Use less call data").check();
  assert.ok(
    await page.evaluate(async () =>
      (await import("/call-local-options.js")).lowDataCalls(),
    ),
  );
  await page.evaluate(() => {
    window.tones = 0;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (...args) {
      window.tones++;
      return create.apply(this, args);
    };
  });
  await page.evaluate(async () =>
    (await import("/call-local-options.js")).ringOnce(),
  );
  assert.equal(await page.evaluate(() => tones), 0);
  await btn("Enable incoming call sound").click();
  await page.evaluate(async () =>
    (await import("/call-local-options.js")).ringOnce(),
  );
  assert.equal(await page.evaluate(() => tones), 2);
  await btn("Silence incoming calls").click();
  await btn("Enable incoming call sound").waitFor();
  await page.evaluate(async () =>
    (await import("/call-local-options.js")).ringOnce(),
  );
  assert.equal(await page.evaluate(() => tones), 2);
  await close();
  await page.locator("#conversation-composer").focus();
  const fitted = await page.evaluate(async () => {
    const field = document.activeElement;
    field.getBoundingClientRect = () => ({
      bottom: visualViewport.height + 100,
    });
    let delta = 0;
    const scroll = window.scrollBy;
    window.scrollBy = (x) => (delta = x.top);
    visualViewport.dispatchEvent(new Event("resize"));
    await new Promise(requestAnimationFrame);
    window.scrollBy = scroll;
    return delta;
  });
  assert.ok(fitted >= 100);
  await go("/groups/5");
  await btn("Search group history").click();
  await field("Search group messages").fill("note");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await txt("1 match in checked messages.").waitFor();
  await btn("Search earlier messages").click();
  await txt("Earlier note").waitFor();
  await close();
  await btn("View decision in context").click();
  await dialog.getByText("Meet here", { exact: true }).waitFor();
  await txt("Earlier note").waitFor();
  await close();
  await btn("Search group history").click();
  pendingGroup = true;
  await field("Search group messages").fill("note");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await txt("Conversation unavailable.").waitFor();
  assert.equal(await dialog.locator(".finder-line").count(), 0);
  await go("/notifications");
  await txt("Notification tools").click();
  expireNotices = true;
  await page.evaluate(() => {
    const clean = window.clearExpiredSession;
    window.clearExpiredSession = () => {
      clean();
      sessionStorage.setItem("fixture-clean", document.body.textContent);
    };
  });
  await page.route("**/?auth=session*", (r) =>
    r.fulfill({ contentType: "text/html", body: "Sign in again" }),
  );
  await btn("Refresh notifications").click();
  await txt("Sign in again").waitFor();
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("fixture-clean")),
    "Your session ended. Returning to sign in…",
  );
  assert.deepEqual(errors, []);
  console.log(
    "30-upgrade fixture passed: notification scope, library filters, player settings, private profile preview, DM tools, group authorization, local call options, viewport and session cleanup.",
  );
} finally {
  await browser?.close();
  server.close();
}
