// Exercise cold Back navigation with fresh in-memory feed snapshots only.
import assert from "node:assert/strict";
import express from "express";
import { chromium } from "playwright";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { memberAssets } from "../web-assets.mjs";
const app = express(),
  shell = memberAssets(
    await readFile("public/index.html", "utf8"),
    "/home",
  ).replace(
    "<!-- member-session -->",
    '<meta name="member-session" content="fixture">',
  );
let member = 2,
  reads = 0,
  posts = Array.from({ length: 35 }, (_, i) => ({
    id: 45 - i,
    author: 4,
    name: "Leon",
    body: "A long caption about visiting the coast. ".repeat(15),
    created: 123456789,
  }));
app.use((_, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.get("/home", (_, r) => r.type("html").send(shell));
app.get("/post/:id", (_, r) =>
  r.send("<title>Post fixture</title><p>Post detail</p>"),
);
app.get("/api/feed", (_, r) => {
  reads++;
  r.json({ profile: { id: member, name: "Test member" }, posts });
});
app.get("/api/feed/notes", (_, r) => r.json({ mine: member, notes: [] }));
app.get("/api/feed/settings", (_, r) => r.json({ prefs: {} }));
app.get("/api/feed/unread", (_, r) => r.json({}));
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
let browser;
try {
  await once(server, "listening");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--disable-features=BackForwardCache"],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } }),
    base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base + "/home");
  const card = (id) => page.locator(`article[data-post="${id}"]`),
    link = (id) => card(id).locator(".post-detail-link");
  await card(28).getByRole("button", { name: "Read more" }).click();
  await link(28).evaluate((el) => {
    el.scrollIntoView({ block: "center" });
    history.replaceState({ extra: "keep" }, "");
  });
  const initial = (await link(28).boundingBox()).y;
  await link(28).press("Enter");
  await page.waitForURL("**/post/28");
  posts.unshift(...[47, 46].map((id) => ({ ...posts[0], id })));
  await page.goBack();
  await card(28).getByRole("button", { name: "Show less" }).waitFor();
  assert.equal(reads, 2);
  assert.ok(Math.abs((await link(28).boundingBox()).y - initial) <= 2);
  assert.ok(await link(28).evaluate((el) => document.activeElement === el));
  assert.deepEqual(await page.evaluate(() => history.state), { extra: "keep" });
  await link(28).press("Enter");
  await page.waitForURL("**/post/28");
  posts = posts.filter((p) => p.id !== 28);
  await page.goBack();
  await link(27).waitFor();
  assert.equal(await card(28).count(), 0);
  assert.ok(await link(27).evaluate((el) => el === document.activeElement));
  assert.ok(
    await card(27).getByRole("button", { name: "Read more" }).isVisible(),
  );
  await link(27).press("Enter");
  await page.waitForURL("**/post/27");
  member++;
  await page.goBack();
  await link(27).waitFor();
  assert.ok(!(await link(27).evaluate((el) => el === document.activeElement)));
  assert.equal(await page.evaluate(() => history.state.feedReturn), undefined);
  console.log(
    "Cold Back passed: reading position after inserts, caption and focus restored, unavailable post fallback, and account scoping.",
  );
} finally {
  await browser?.close();
  server.close();
}
