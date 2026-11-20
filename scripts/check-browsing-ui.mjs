// Exercise the real browsing UI with a read-only fixture; never start SQLite.
import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import express from "express";
import { chromium } from "playwright";
const app = express(),
  author = { id: 7, name: "Sam" },
  body = "Looking out across the valley. ".repeat(8) + "🌄",
  post = {
    id: 12,
    author: 7,
    name: "Sam",
    created: Date.now(),
    body,
    likes: 0,
    comments: 0,
    media: [1, 2, 3].map((id) => ({ id, type: "image/webp" })),
  };
app.get(
  ["/search", "/post/12", "/saved", "/notifications", "/settings/privacy"],
  (_, res) => res.sendFile(resolve("public/social.html")),
);
app.get("/api/feed/people", (_, res) => res.json({ people: [author] }));
app.get("/api/feed/discover", (req, res) =>
  res.json({ posts: req.query.kind ? [] : [post] }),
);
app.get("/api/feed/post/12", (_, res) =>
  res.json({ post, author, own: true, comments: [] }),
);
app.get(["/api/feed/avatar/:id", "/api/feed/media/:id"], (_, res) =>
  res.sendFile(resolve("public/assets/avatar-default.webp")),
);
app.get("/api/feed/settings", (_, res) =>
  res.json({
    prefs: {},
    restricted: [
      { id: 1, name: "Mila Lake", kind: "block" },
      { id: 2, name: "Mila Lane", kind: "mute" },
    ],
  }),
);
app.get("/api/feed/notices", (_, res) =>
  res.json({
    notices: [
      { id: 1, actor: 1, name: "Mila", kind: "mention", following: 1 },
      { id: 2, actor: 2, name: "Ari", kind: "mention", following: 0 },
      { id: 3, actor: 1, name: "Mila", kind: "comment", following: 1 },
    ].map((i) => ({ ...i, created: Date.now(), seen: 0 })),
  }),
);
app.get("/api/feed/library", (_, res) =>
  res.json({
    collections: [{ id: 1, name: "Field notes" }],
    links: [
      { collection: 1, post: 12 },
      { collection: 1, post: 13 },
    ],
    posts: [
      { ...post, body: "Morning ride", name: "Mila", media: [] },
      { ...post, id: 13, body: "Evening ride", name: "Ari", media: [] },
      {
        ...post,
        id: 14,
        body: "Another morning ride",
        name: "Mila",
        media: [],
      },
    ],
  }),
);
app.get("/api/feed/unread", (_, res) => res.json({}));
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
let browser;
try {
  await once(server, "listening");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base + "/search?q=valley");
  const posts = page.getByRole("button", { name: "Posts", exact: true });
  await posts.click();
  assert.equal(new URL(page.url()).searchParams.get("filter"), "posts");
  await page.locator(".result-card").click();
  const toggle = page.getByRole("button", { name: "Read more", exact: true });
  await toggle.click();
  const less = page.getByRole("button", { name: "Show less", exact: true });
  assert.equal(await less.getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator(".caption > span").innerText(), body);
  await less.press("Enter");
  assert.ok((await page.locator(".caption > span").innerText()).endsWith("…"));
  const stage = page.getByRole("group", { name: /Post gallery/ }),
    next = page.getByRole("button", { name: "Next attachment" });
  await stage.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await stage.getByRole("status").innerText(), "3 / 3");
  await next.click();
  assert.equal(await stage.getByRole("status").innerText(), "1 / 3");
  assert.ok(await next.evaluate((el) => el === document.activeElement));
  await next.press("End");
  assert.ok((await stage.locator("img").getAttribute("src")).endsWith("/3"));
  await next.press("Home");
  await next.press("ArrowRight");
  assert.equal(await stage.getByRole("status").innerText(), "2 / 3");
  await page.getByPlaceholder("Add a comment…").press("ArrowRight");
  assert.equal(await stage.getByRole("status").innerText(), "2 / 3");
  await page.goBack();
  await posts.waitFor();
  assert.equal(await posts.getAttribute("aria-pressed"), "true");
  await page.reload();
  await posts.waitFor();
  assert.equal(await posts.getAttribute("aria-pressed"), "true");
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill("second");
  await search.press("Enter");
  await posts.waitFor();
  assert.equal(new URL(page.url()).searchParams.get("q"), "second");
  assert.equal(await posts.getAttribute("aria-pressed"), "true");
  await page.goto(base + "/search?filter=unknown");
  const all = page.getByRole("button", { name: "All", exact: true });
  await all.waitFor();
  assert.equal(await all.getAttribute("aria-pressed"), "true");
  assert.equal(new URL(page.url()).searchParams.has("filter"), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/notifications");
  const following = page.getByRole("checkbox", {
    name: "Only people I follow",
  });
  await following.check();
  assert.equal(await page.locator(".notice").count(), 2);
  await page.getByRole("button", { name: "Mentions", exact: true }).click();
  assert.equal(await page.locator(".notice").count(), 1);
  assert.ok((await page.locator(".notice").innerText()).includes("Mila"));
  await following.uncheck();
  assert.equal(await page.locator(".notice").count(), 2);
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(base + "/saved");
  await page.getByRole("button", { name: /Field notes/ }).click();
  const keywords = page.getByRole("searchbox", {
    name: "Search in Field notes",
  });
  await keywords.fill("mILA   RIDE");
  assert.deepEqual(
    await page.locator(".library-item strong").allTextContents(),
    ["Morning ride"],
  );
  await keywords.fill("no-such-keyword");
  await page.getByText("No saved items match those keywords.").waitFor();
  await page.getByRole("button", { name: "Clear search" }).click();
  assert.equal(await page.locator(".library-item").count(), 2);
  assert.equal(
    requests.filter((url) => url.includes("/api/feed/library")).length,
    1,
  );
  await page.goto(base + "/settings/privacy#blocked");
  const accounts = page.getByRole("searchbox", {
    name: "Search blocked or muted accounts",
  });
  await accounts.fill("BLOCKED mila");
  assert.equal(await page.locator(".restricted .pref-row").count(), 1);
  await page.getByRole("button", { name: "Unblock", exact: true }).waitFor();
  await accounts.fill("no-such-keyword");
  await page.getByText("No matching accounts.").waitFor();
  await page.getByRole("button", { name: "Clear search" }).click();
  assert.equal(await page.locator(".restricted .pref-row").count(), 2);
  assert.ok(await accounts.evaluate((el) => el === document.activeElement));
  assert.ok(!requests.some((url) => url.includes("no-such-keyword")));
  assert.deepEqual(errors, []);
  console.log(
    "Browsing checks passed: caption disclosure, keyboard gallery, focus retention, Explore state, following-only notices, private collection search, and restricted-account filters.",
  );
} finally {
  await browser?.close();
  server.close();
}
