// Use the actual page shell, controls, and catalog without starting a database.
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { chromium } from "playwright";
const app = express();
app.get("/api/feed/settings", (_, res) => res.json({ prefs: {} }));
app.get("/api/feed/unread", (_, res) => res.json({ messages: 4 }));
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
let browser;
try {
  await once(server, "listening");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const page = await browser.newPage({ forcedColors: "active" });
  const base = `http://127.0.0.1:${server.address().port}/social.html`;
  async function mount(viewer) {
    await page.goto(base);
    const skip = page.getByRole("link", { name: "Skip to message field" });
    assert.equal(await skip.count(), 0);
    await page.evaluate(async (viewer) => {
      const { multiline } = await import("/chat-compose.js"),
        { emojiPicker } = await import("/dm-tools.js"),
        { n, box, tabs } = await import("/social-ui.js");
      const form = n("form"),
        msg = n("textarea"),
        send = n("button", "", "Send"),
        pick = n("button", "", "Pick emoji");
      pick.onclick = () =>
        emojiPicker((char) => {
          msg.value += char;
        }, viewer);
      form.append(multiline(msg, form, send, "Message…"), send);
      document.querySelector("#surface").append(
        pick,
        form,
        box("thread-row", n("b", "count", 4)),
        tabs(["All", "Unread"], "All", () => {}),
      );
    }, viewer);
  }
  const pick = () => page.getByRole("button", { name: "Pick emoji" }).click();
  const category = page.getByLabel("Emoji category"),
    q = page.getByLabel("Search emojis"),
    grid = page.locator(".emoji-grid");
  async function selectEmoji(label) {
    await pick();
    await q.fill(label);
    await grid.getByRole("button", { name: label, exact: true }).click();
  }
  async function recent() {
    await pick();
    await category.selectOption("recent");
  }
  await mount(1);
  await page.keyboard.press("Tab");
  assert.equal(
    await page.locator(":focus").innerText(),
    "Skip to message field",
  );
  await page.keyboard.press("Enter");
  assert.equal(
    await page.locator(":focus").getAttribute("id"),
    "conversation-composer",
  );
  const style = await page.evaluate(() => {
    const badge = getComputedStyle(
        document.querySelector(".thread-row .count"),
      ),
      ref = document.createElement("b");
    ref.style.cssText =
      "background:Highlight;color:HighlightText;forced-color-adjust:none";
    document.body.append(ref);
    return [
      badge.backgroundColor === getComputedStyle(ref).backgroundColor,
      badge.color === getComputedStyle(ref).color,
      badge.borderTopStyle,
      getComputedStyle(document.querySelector("[aria-pressed=true]"))
        .textDecorationStyle,
    ];
  });
  assert.deepEqual(style, [true, true, "solid", "double"]);
  await selectEmoji("red heart");
  await selectEmoji("grinning face");
  await selectEmoji("red heart");
  await mount(1);
  await recent();
  assert.deepEqual(
    await grid
      .locator("button")
      .evaluateAll((items) => items.map((b) => b.title)),
    ["red heart", "grinning face"],
  );
  await q.fill("grinning");
  assert.equal(await grid.locator("button").count(), 1);
  await mount(2);
  await recent();
  await page.getByText("No recent emojis on this device.").waitFor();
  await category.selectOption("-1");
  await q.fill("red heart");
  await grid.getByRole("button", { name: "red heart", exact: true }).click();
  await mount(1);
  await recent();
  await page.getByRole("button", { name: "Clear recent emojis" }).click();
  await page.getByText("No recent emojis on this device.").waitFor();
  await mount(1);
  await recent();
  await page.getByText("No recent emojis on this device.").waitFor();
  await mount(2);
  await recent();
  assert.equal(await grid.locator("button").count(), 1);
  console.log(
    "Passed: composer skip link, forced-color contrast cues, searchable recent emojis, ordering, persistence, per-account isolation and clear.",
  );
} finally {
  await browser?.close();
  server.close();
}
