// Run the real call controller against in-memory signaling with synthetic audio.
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { chromium } from "playwright";
const app = express(),
  name = "W".repeat(95);
let call = null,
  starts = 0,
  holdEnd = false,
  finishEnd;
const invitations = [];
app.use(express.json());
app.get("/fixture", (_, res) =>
  res.type("html")
    .send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/social.css"><link rel="stylesheet" href="/chat-media.css"><body class="social"><div class="thread-head"><div class="summary"><button class="contact-name">${name}</button></div></div><textarea style="position:fixed;bottom:12px" aria-label="Message"></textarea><p id="alert"></p><script type="module">
import {callControls} from '/calls.js';document.querySelector('.thread-head').append(callControls()({id:7,name:'${name}'}));</script>`),
);
app.get("/api/feed/calls", (_, res) => res.json({ call }));
app.post("/api/feed/calls", (req, res) => {
  if (req.body.action === "start") {
    starts++;
    invitations.push([req.body.peer, req.body.kind]);
    call = { id: starts, state: "ringing" };
    return res.json({ id: starts, iceServers: [] });
  }
  if (req.body.action === "accept") return res.json({ iceServers: [] });
  if (req.body.action === "end") {
    call = null;
    if (holdEnd) {
      holdEnd = false;
      finishEnd = () => res.json({});
      return;
    }
  }
  res.json({});
});
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
let browser;
try {
  await once(server, "listening");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 320, height: 630 },
    permissions: ["microphone"],
  });
  await page.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(...args) {
        super(...args);
        window.testPC = this;
      }
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
  const button = (name) => page.getByRole("button", { name, exact: true }),
    corner = page.getByLabel("Dock position"),
    panel = page.locator(".call-panel");
  async function fits(el) {
    const r = await el.boundingBox(),
      { width, height } = page.viewportSize();
    assert.ok(
      r &&
        r.x >= 0 &&
        r.x + r.width <= width + 1 &&
        r.y >= 0 &&
        r.y + r.height <= height + 1,
      `outside viewport: ${JSON.stringify(r)}`,
    );
  }
  await fits(button("Start video call"));
  await button("Start audio call").click();
  await button("Minimize").waitFor();
  await fits(button("Mute"));
  await fits(button("End call"));
  assert.ok((await panel.locator("h2").textContent()).includes(name));
  await page.getByLabel("Call size").selectOption("small");
  await button("Minimize").click();
  await corner.waitFor();
  assert.equal(await corner.inputValue(), "bottom-right");
  await button("Mute").click();
  await page.setViewportSize({ width: 390, height: 680 });
  const positions = {};
  for (const v of ["bottom-right", "top-left", "top-right", "bottom-left"]) {
    await corner.selectOption(v);
    positions[v] = await panel.boundingBox();
    await fits(button("Unmute"));
    await fits(button("End call"));
    await fits(corner);
  }
  assert.ok(
    positions["top-right"].x > positions["top-left"].x &&
      positions["bottom-right"].x > positions["bottom-left"].x,
  );
  assert.ok(
    positions["bottom-left"].y > positions["top-left"].y &&
      positions["bottom-right"].y > positions["top-right"].y,
  );
  await corner.selectOption("top-right");
  await page.getByRole("textbox", { name: "Message" }).fill("Draft still here");
  await button("Restore call").click();
  assert.equal(await page.getByLabel("Call size").inputValue(), "small");
  assert.ok(!(await corner.isVisible()));
  await page.keyboard.press("Escape");
  assert.equal(await corner.inputValue(), "top-right");
  await button("End call").click();
  assert.equal(starts, 1);
  assert.equal(
    await page.getByRole("textbox", { name: "Message" }).inputValue(),
    "Draft still here",
  );
  await button("Start audio call").click();
  await button("Minimize").click();
  assert.equal(await corner.inputValue(), "bottom-right");
  await button("End call").click();
  // Answer a video invitation without camera access, then simulate a terminal
  // RTC failure. The real peer and synthetic microphone must both close.
  call = {
    id: 70,
    peer: 7,
    name,
    kind: "video",
    state: "ringing",
    caller: false,
  };
  await page.evaluate(() => dispatchEvent(new Event("dm-call")));
  await page.getByLabel("Start with mic muted").check();
  await button("Answer with mic only").click();
  await button("Unmute").waitFor();
  async function failPeer() {
    await page.evaluate(() => {
      const pc = window.testPC;
      window.failedTracks = document
        .querySelector(".call-local")
        .srcObject.getTracks();
      Object.defineProperty(pc, "connectionState", {
        value: "failed",
        configurable: true,
      });
      pc.dispatchEvent(new Event("connectionstatechange"));
      delete pc.connectionState;
    });
  }
  holdEnd = true;
  await failPeer();
  const redial = button("Redial with audio");
  await redial.waitFor();
  assert.ok(await redial.isDisabled());
  assert.deepEqual(
    await page.evaluate(() => [
      testPC.connectionState,
      ...failedTracks.map((t) => t.readyState),
    ]),
    ["closed", "ended"],
  );
  assert.equal(starts, 2);
  assert.equal(await button("Redial with video").count(), 0);
  finishEnd();
  await fits(redial);
  await page.evaluate(() => dispatchEvent(new Event("dm-call")));
  await redial.click();
  await button("Unmute").waitFor();
  assert.deepEqual(invitations, [
    [7, "audio"],
    [7, "audio"],
    [7, "audio"],
  ]);
  assert.ok(
    await page.evaluate(
      () =>
        document.querySelector(".call-local").srcObject.getAudioTracks()[0]
          .enabled === false,
    ),
  );
  await failPeer();
  await button("Dismiss").click();
  await page.evaluate(() => dispatchEvent(new Event("dm-call")));
  assert.equal(starts, 3);
  assert.equal(await redial.count(), 0);
  // Read the actual constraints sent by the normal video-start path.
  await page.evaluate(() =>
    localStorage.setItem("afterlink.lowDataCalls", "true"),
  );
  await page.reload();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "connection", {
      value: { saveData: false, effectiveType: "4g" },
    });
    navigator.mediaDevices.getUserMedia = async (opts) => {
      window.requestedCamera = opts.video;
      throw new DOMException("Cancelled", "NotAllowedError");
    };
  });
  await button("Start video call").click();
  assert.deepEqual(
    await page.evaluate(() => [
      requestedCamera.width.ideal,
      requestedCamera.height.ideal,
      requestedCamera.frameRate.ideal,
    ]),
    [320, 180, 15],
  );
  assert.equal(starts, 3);
  console.log(
    "Call dock passed: long unbroken name at 320px, all four corners, compose while docked, mute and size retained, new call resets position; failed media released, explicit mic-only redial retains mute, dismiss sends nothing.",
  );
} finally {
  await browser?.close();
  server.close();
}
