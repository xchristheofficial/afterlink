// OS permission pickers and speakers cannot be driven in headless CI. Exercise
// the real settings UI with controlled browser output APIs on two media elements.
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { chromium } from "playwright";
const app = express();
app.get("/fixture", (_, res) =>
  res.type("html")
    .send(`<!doctype html><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/chat-media.css"><script type="module">
import {callPreferences} from '/call-preferences.js';
const mode=new URLSearchParams(location.search).get('mode');window.handoffs=0;window.lists=0;window.outcome='ok';window.sinks={voice:'',tab:''};
Object.defineProperty(navigator.mediaDevices,'selectAudioOutput',{value:mode==='native'?async()=>{handoffs++;if(outcome==='cancel')throw new DOMException('cancel','AbortError');return {deviceId:'headset',label:'Headphones'};}:undefined});
Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async()=>{lists++;return [{kind:'audioinput',deviceId:'mic',label:'Microphone'},{kind:'audiooutput',deviceId:'default',label:'Default'},{kind:'audiooutput',deviceId:'headset',label:'Headphones'}];}});
function player(key){const el=document.createElement('video');Object.defineProperty(el,'sinkId',{get:()=>sinks[key]});Object.defineProperty(el,'setSinkId',{value:mode==='unsupported'?undefined:async id=>{if(outcome==='denied')throw new DOMException('denied','NotAllowedError');sinks[key]=id;}});return el;}
const prefs=callPreferences(player('voice'),document.createElement('video'),{});document.body.append(prefs.root);prefs.root.open=true;window.listen=prefs.tabAudio(player('tab'));listen(false);
</script>`),
);
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
let browser;
try {
  await once(server, "listening");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const page = await browser.newPage(),
    base = `http://127.0.0.1:${server.address().port}/fixture?mode=`;
  const button = (name) => page.getByRole("button", { name, exact: true }),
    state = () => page.evaluate(() => ({ ...sinks }));
  await page.goto(base + "native");
  const voice = button("Choose partner voice output"),
    tab = button("Choose shared tab output");
  await voice.waitFor();
  assert.equal(await page.evaluate(() => handoffs), 0);
  assert.ok(!(await tab.isVisible()));
  await voice.click();
  assert.deepEqual(await state(), { voice: "headset", tab: "" });
  await page.evaluate(() => listen(true));
  await tab.click();
  assert.deepEqual(await state(), { voice: "headset", tab: "headset" });
  await page.evaluate(() => (window.outcome = "cancel"));
  await voice.click();
  await page.getByText(/Selection cancelled/).waitFor();
  assert.equal((await state()).voice, "headset");
  await page.evaluate(() => (window.outcome = "denied"));
  await button("Use system default for partner voice").click();
  await page.getByText(/Speaker access was not granted/).waitFor();
  assert.equal((await state()).voice, "headset");
  await page.evaluate(() => (window.outcome = "ok"));
  await button("Use system default for partner voice").click();
  assert.deepEqual(await state(), { voice: "", tab: "headset" });
  await page.goto(base + "list");
  await voice.waitFor();
  assert.equal(await page.evaluate(() => lists), 0);
  await voice.click();
  const select = page.getByRole("combobox", {
    name: "partner voice output device",
  });
  await select.waitFor();
  assert.deepEqual(await select.locator("option").allTextContents(), [
    "System default",
    "Headphones",
  ]);
  await select.selectOption("headset");
  assert.equal((await state()).voice, "headset");
  await button("Use system default for partner voice").click();
  assert.equal((await state()).voice, "");
  await page.goto(base + "unsupported");
  await page
    .getByText(/device’s sound settings to change the partner voice output/)
    .waitFor();
  assert.ok(!(await voice.isVisible()));
  assert.equal(await page.evaluate(() => lists + handoffs), 0);
  console.log(
    "Call output UI passed: gesture-only picker/list, independent voice and tab routing, default reset, cancel/deny recovery, and unsupported-browser guidance.",
  );
} finally {
  await browser?.close();
  server.close();
}
