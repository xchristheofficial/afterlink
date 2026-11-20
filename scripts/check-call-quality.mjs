// Real RTP between two local Chromium peers, with a synthetic tone and no database.
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { chromium } from "playwright";
const app = express();
app.get("/fixture", (_, res) =>
  res.type("html")
    .send(`<!doctype html><button id="connect">Connect peers</button><script type="module">
import {callPreferences} from '/call-preferences.js';
const a=new RTCPeerConnection({iceServers:[]}), b=new RTCPeerConnection({iceServers:[]});
const remote=document.createElement('audio'), local=document.createElement('video'); const prefs=callPreferences(remote,local,b);document.body.append(prefs.root);prefs.root.open=true;
// Exchange candidates after gathering completes; no external ICE service needed.
async function gather(pc,desc){await pc.setLocalDescription(desc);if(pc.iceGatheringState!=='complete')await new Promise(resolve=>pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete')resolve()}));return pc.localDescription;}
b.ontrack=e=>{remote.srcObject=new MediaStream([e.track]);remote.muted=true;remote.play().catch(()=>{});};
connect.onclick=async()=>{const ctx=new AudioContext();await ctx.resume();const osc=ctx.createOscillator(),out=ctx.createMediaStreamDestination();osc.connect(out);osc.start();a.addTrack(out.stream.getAudioTracks()[0],out.stream);await b.setRemoteDescription(await gather(a,await a.createOffer()));await a.setRemoteDescription(await gather(b,await b.createAnswer()));};b.onconnectionstatechange=()=>document.body.dataset.state=b.connectionState;
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
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
  const check = page.getByRole("button", { name: "Check connection" });
  await check.click();
  await page.getByText("Connect the call first, then check again.").waitFor();
  await page.getByRole("button", { name: "Connect peers" }).click();
  await page.waitForFunction(() => document.body.dataset.state === "connected");
  await check.click();
  await page.waitForFunction(() =>
    document
      .querySelector(".call-quality")
      .textContent.startsWith("Connection estimate:"),
  );
  const result = await page.locator(".call-quality").textContent();
  assert.match(result, /Connection estimate: (Good|Fair|Poor)/);
  assert.match(result, /\d+\.\d% incoming audio loss/);
  assert.match(result, /Direct/);
  console.log("Loopback WebRTC: " + result);
} finally {
  await browser?.close();
  server.close();
}
