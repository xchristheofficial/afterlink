// A real MediaRecorder with Chromium's synthetic microphone, no accounts or DB.
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { chromium } from "playwright";

const app = express();
app.get("/fixture", (_, res) =>
  res.type("html")
    .send(`<!doctype html><meta charset="utf-8"><div id="zone"><textarea id="msg"></textarea><button id="send">Send</button></div><dialog id="socialDialog"><div id="sheet"></div></dialog><div id="alert"></div><script type="module">
import { attachmentComposer } from '/chat-media.js';
const draft=attachmentComposer(msg,send,zone);zone.append(draft.file,draft.pick,draft.preview);
</script>`),
);
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
let browser;
try {
  await once(server, "listening");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
  const page = await browser.newPage({
    reducedMotion: "reduce",
    permissions: ["microphone"],
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
  const guard = () =>
    page.evaluate(
      () => !dispatchEvent(new Event("beforeunload", { cancelable: true })),
    );
  const click = (name) =>
    page.getByRole("button", { name, exact: true }).click();
  assert.equal(await guard(), false);
  await page.evaluate(() => {
    const now = performance.now.bind(performance);
    window.offset = 0;
    performance.now = () => now() + window.offset;
  });
  // A controllable silent/tone source avoids depending on a particular
  // Chromium build’s fake capture device or the machine’s microphone.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      await ctx.resume();
      const osc = ctx.createOscillator(),
        gain = ctx.createGain(),
        dest = ctx.createMediaStreamDestination();
      gain.gain.value = 0;
      osc.connect(gain).connect(dest);
      osc.start();
      window.tone = () => {
        gain.gain.value = 0.5;
      };
      return dest.stream;
    };
  });
  await click("Add attachment");
  await click("Voice note");
  await page.getByText("Microphone: quiet").waitFor();
  await page.evaluate(() => window.tone());
  await page.getByText("Microphone: sound detected").waitFor();
  assert.equal(await page.locator(".dm-levels").count(), 0);
  assert.equal(await guard(), true);
  await click("Pause");
  await page.getByText("Microphone check paused").waitFor();
  await page.evaluate(() => (window.offset += 90000));
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole("status").innerText(), "");
  await click("Resume");
  await page.evaluate(() => (window.offset += 106000));
  await page.getByText(/15 seconds or less/).waitFor();
  await page.evaluate(() => (window.offset += 15000));
  await page.getByText("Voice note preview").waitFor();
  await page.getByText(/Two-minute limit reached/).waitFor();
  assert.equal(await guard(), true);
  assert.equal(await page.locator(".dm-preview audio").count(), 1);
  await click("Remove voice note");
  assert.equal(await guard(), false);
  await click("Add attachment");
  await click("Voice note");
  await click("Cancel");
  await page.waitForFunction(() => !document.querySelector("#send").disabled);
  assert.equal(await guard(), false);
  await page.locator("input[type=file]").setInputFiles({
    name: "photo.gif",
    mimeType: "image/gif",
    buffer: Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    ),
  });
  await page.getByText("GIF preview").waitFor();
  assert.equal(await guard(), true);
  const prompt = page.waitForEvent("dialog");
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  const dialog = await prompt;
  assert.equal(dialog.type(), "beforeunload");
  await dialog.dismiss();
  await page.getByText("GIF preview").waitFor();
  await click("Remove GIF");
  assert.equal(await guard(), false);
  console.log(
    "Voice UI passed: microphone signal with reduced motion, pause/resume, limit warning, preview at cutoff, discard and navigation guard.",
  );
} finally {
  await browser?.close();
  server.close();
}
