// Actual Messages page with an in-memory conversation; no DB or user data.
import assert from "node:assert/strict";
import express from "express";
import { chromium } from "playwright";
import { once } from "node:events";
import { resolve } from "node:path";
const app = express(),
  member = { id: 2, name: "Nia" },
  msg = (id, sender = 2) => ({
    id,
    sender,
    body: `Message ${id}`,
    created: Date.now(),
    seen: 1,
  }),
  messages = [msg(2), msg(3, 1)];
app.use(express.json());
app.get("/messages/2", (_, r) => r.sendFile(resolve("public/social.html")));
app.get("/api/feed/thread/2", (q, r) =>
  r.json({
    viewer: 1,
    member,
    messages: q.query.before ? [msg(1)] : messages,
    more: !q.query.before,
    ...(q.query.opening ? { firstUnread: null } : {}),
  }),
);
app.get("/api/feed/inbox", (_, r) => r.json({ threads: [] }));
app.get("/api/feed/notes", (_, r) => r.json({ mine: 1, notes: [] }));
app.get("/api/feed/calls", (_, r) => r.json({ call: null }));
app.get("/api/feed/settings", (_, r) => r.json({ prefs: {} }));
app.get("/api/feed/unread", (_, r) => r.json({}));
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
let browser;
try {
  await once(server, "listening");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.EventSource = class extends EventTarget {
      constructor() {
        super();
        window.stream = this;
      }
      close() {}
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/messages/2`);
  const region = page.locator(".thread-arrivals"),
    bubble = (id) =>
      page
        .locator(".bubble")
        .filter({ has: page.getByText(`Message ${id}`, { exact: true }) }),
    trigger = (id) =>
      bubble(id).getByRole("button", { name: "Message actions" });
  await trigger(2).waitFor();
  assert.equal(await region.textContent(), "");
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  await trigger(1).waitFor();
  assert.equal(await region.textContent(), "");
  await page.evaluate(() => {
    window.updates = 0;
    new MutationObserver(() => updates++).observe(
      document.querySelector(".thread-arrivals"),
      { childList: true },
    );
  });
  async function wake() {
    const read = page.waitForResponse((r) => r.url().endsWith("/thread/2"));
    await page.evaluate(() => stream.dispatchEvent(new Event("chat")));
    await (await read).finished();
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  messages.push(msg(4), msg(5), msg(6, 1), { ...msg(7), removed: true });
  await wake();
  await region
    .getByText("2 new messages from Nia.", { exact: true })
    .waitFor({ state: "attached" });
  assert.equal(await page.evaluate(() => updates), 1);
  await wake();
  assert.equal(await page.evaluate(() => updates), 1);
  await trigger(2).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Message actions" }).waitFor();
  messages[0].pinned = true;
  await wake();
  await bubble(2).getByText("Pinned").waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document.activeElement.closest(".bubble")?.querySelector("p")
        .textContent === "Message 2",
  );
  assert.ok(await trigger(2).evaluate((el) => el === document.activeElement));
  await trigger(2).click();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement.id === "conversation-composer",
  );
  await trigger(3).click();
  messages[1].removed = true;
  await wake();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document.activeElement.matches(".bubble.mine") &&
      document.activeElement.querySelector("p").textContent ===
        "Message unsent",
  );
  assert.equal(await page.evaluate(() => updates), 1);
  messages.push(msg(8));
  await wake();
  assert.equal(await region.textContent(), "New message from Nia.");
  console.log(
    "DM accessibility passed: silent history, batched partner-only announcements, focus after live replacement/unsend, and Reply focus.",
  );
} finally {
  await browser?.close();
  server.close();
}
