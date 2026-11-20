// Two isolated browsers use the real watch UI with a shared, in-memory DM fixture.
// No production server, database, capture permissions, or network media required.
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { chromium } from "playwright";
const app = express(),
  messages = [{ id: 1, sender: 1, body: "Already here" }];
app.use(express.json());
app.get("/fixture", (_req, res) =>
  res.type("html")
    .send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/chat-media.css"><dialog id="call" class="call-panel"><div id="mount"></div></dialog><script type="module">
import {watchTogether} from '/watch-together.js';
const peer=Number(new URLSearchParams(location.search).get('peer'));
window.watch=watchTogether({id:17,peer,name:'Partner',preferences:{tabAudio:()=>()=>{}},remote:document.createElement('video'),watchTransport:{resizeCameras(){},remote:()=>new MediaStream()}},call,()=>{},false);
mount.append(watch.pane,watch.root);call.showModal();watch.sync(1,1);
</script>`),
);
app.get("/api/feed/thread/:peer", (_req, res) => res.json({ messages }));
app.post("/api/feed/thread/:peer", (req, res) => {
  messages.push({
    id: messages.length + 1,
    sender: req.params.peer === "1" ? 2 : 1,
    body: req.body.body,
  });
  res.json({ ok: true });
});
app.post("/api/feed/typing/:peer", (_req, res) => res.json({}));
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
let browser;
try {
  await once(server, "listening");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const base = `http://127.0.0.1:${server.address().port}/fixture?peer=`,
    host = await browser.newPage({ viewport: { width: 1280, height: 800 } }),
    guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await Promise.all([
    host.goto(base + 2, { waitUntil: "domcontentloaded" }),
    guest.goto(base + 1, { waitUntil: "domcontentloaded" }),
  ]);
  for (const page of [host, guest])
    await page.getByText("Already here", { exact: true }).waitFor();
  const field = (p) => p.getByPlaceholder("Message your watch partner…"),
    expand = (p) => p.getByRole("button", { name: "Expand shared tab" }),
    show = (p) => p.getByRole("button", { name: "Show conversation" });
  await field(guest).fill("Draft for later");
  const before = await guest.locator(".watch-video").boundingBox();
  await expand(guest).click();
  assert.equal(await field(guest).isVisible(), false);
  assert.equal(await show(guest).getAttribute("aria-expanded"), "false");
  assert.ok(
    (await guest.locator(".watch-video").boundingBox()).height > before.height,
  );
  assert.ok(await field(host).isVisible());
  async function refresh(page) {
    const ready = page.waitForResponse((r) =>
      r.url().includes("/api/feed/thread/"),
    );
    await page.evaluate(() => dispatchEvent(new Event("dm-chat")));
    await (await ready).finished();
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await refresh(guest);
  assert.equal(await guest.locator(".watch-new").textContent(), "");
  messages.push({ id: 2, sender: 2, body: "From my other device" });
  await refresh(guest);
  assert.equal(await guest.locator(".watch-new").textContent(), "");
  await field(host).fill("Already here");
  await host.getByRole("button", { name: "Send", exact: true }).click();
  await host.waitForFunction(
    () => document.querySelectorAll(".watch-line").length === 3,
  );
  await refresh(guest);
  await guest.getByText("New messages", { exact: true }).waitFor();
  await show(guest).press("Enter");
  assert.equal(await field(guest).inputValue(), "Draft for later");
  assert.ok(await field(guest).evaluate((el) => el === document.activeElement));
  assert.equal(await guest.locator(".watch-new").textContent(), "");
  await expand(guest).click();
  messages[2].removed = true;
  await refresh(guest);
  assert.equal(await guest.locator(".watch-new").textContent(), "");
  await expand(host).click();
  assert.ok(!(await field(host).isVisible()));
  await guest.evaluate(() => {
    watch.sync(null, 2);
    watch.sync(1, 3);
  });
  await expand(guest).waitFor();
  assert.ok(await field(guest).isVisible());
  assert.equal(await guest.locator(".watch-new").textContent(), "");
  await host.evaluate(() => {
    watch.sync(null, 5);
    navigator.mediaDevices.getDisplayMedia = async (opts) => {
      window.captureOptions = opts;
      throw new DOMException("Cancelled", "NotAllowedError");
    };
  });
  await host
    .getByRole("button", { name: "Watch together", exact: true })
    .click();
  await host.getByRole("button", { name: "Share a tab", exact: true }).click();
  await host.getByText("No tab was shared.").waitFor();
  assert.deepEqual(
    await host.evaluate(() => [
      captureOptions.surfaceSwitching,
      captureOptions.selfBrowserSurface,
    ]),
    ["include", "exclude"],
  );
  for (const p of [guest, host]) await p.evaluate(() => watch.close());
  console.log(
    "Watch layout passed: independent desktop/mobile views, keyboard return, retained draft, new partner message, no history/own-message/unsend alerts, and reset on stop.",
  );
} finally {
  await browser?.close();
  server.close();
}
