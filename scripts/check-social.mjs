import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
// Validate the bytes saved by the browser, not the live recording stream.
async function verifyRecording(page, bytes, withScreen) {
  const result = await page.evaluate(
    async ({ encoded, withScreen }) => {
      const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      const ctx = new AudioContext();
      let duration;
      try {
        duration = (await ctx.decodeAudioData(raw.buffer.slice(0))).duration;
      } finally {
        await ctx.close();
      }
      if (!withScreen) return { duration };
      const video = document.createElement("video");
      video.muted = true;
      const url = URL.createObjectURL(new Blob([raw]));
      video.src = url;
      let timer;
      try {
        await Promise.race([
          new Promise((resolve, reject) => {
            video.requestVideoFrameCallback(resolve);
            video.play().catch(reject);
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("No decoded recording frame")),
              5000,
            );
          }),
        ]);
        return { duration, width: video.videoWidth, height: video.videoHeight };
      } finally {
        clearTimeout(timer);
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      }
    },
    { encoded: bytes.toString("base64"), withScreen },
  );
  assert.ok(result.duration > 0.1, "Playable microphone audio");
  if (withScreen)
    assert.ok(result.width > 0 && result.height > 0, "Decoded screen frame");
}
// Runs against the isolated database and authenticated contexts from check-page.mjs.
export async function checkSocial({
  page,
  second,
  url,
  peer,
  author,
  postId,
  browser,
}) {
  const p = await page.context().newPage(),
    v = await second.newPage(),
    errors = [];
  for (const b of [p, v]) b.on("pageerror", (e) => errors.push(e.message));
  const headers = { "X-AfterLink-Request": "1" };
  // Commit a real send upstream but discard its first response to the browser.
  async function loseConfirmation(page, url, match) {
    let lost = false;
    await page.route(url, async (route) => {
      const req = route.request();
      if (!lost && req.method() === "POST" && match(req.postDataJSON())) {
        lost = true;
        assert.ok((await route.fetch()).ok());
        await route.abort("failed");
      } else await route.continue();
    });
    return () => page.unroute(url);
  }
  try {
    await p.goto(url + "/messages");
    await p.getByRole("button", { name: "New Message", exact: false }).click();
    await p.locator(".picker-row").filter({ hasText: "Second Member" }).click();
    const firstDraft = p.getByRole("textbox", {
      name: "Message…",
      exact: true,
    });
    await firstDraft.fill("x".repeat(999));
    await p.locator(".composer-limit").getByText("1 character left").waitFor();
    await firstDraft.fill("Private test conversation");
    await p.locator(".composer-limit").waitFor({ state: "hidden" });
    const transfer = (kind) =>
      p.evaluate(async (kind) => {
        const data = new DataTransfer();
        const blob = await (await fetch("/assets/editor-avatar.webp")).blob();
        data.items.add(new File([blob], "sample.webp", { type: "image/webp" }));
        const opts = { bubbles: true, cancelable: true };
        const event =
          kind === "paste"
            ? new ClipboardEvent("paste", { ...opts, clipboardData: data })
            : new DragEvent("drop", { ...opts, dataTransfer: data });
        (kind === "paste"
          ? document.querySelector(".send-bar textarea")
          : document.querySelector(".chat-log")
        ).dispatchEvent(event);
        return event.defaultPrevented;
      }, kind);
    assert.ok(await transfer("paste"));
    await p.getByRole("button", { name: "Remove photo" }).waitFor();
    assert.equal(
      await p.getByLabel("Add a caption…").inputValue(),
      "Private test conversation",
    );
    await p.locator(".dm-preview img").evaluate((el) => el.decode());
    assert.equal(await p.locator(".chat-log .bubble").count(), 0);
    await p.getByRole("button", { name: "Remove photo" }).click();
    assert.ok(await transfer("drop"));
    await p.getByRole("button", { name: "Remove photo" }).waitFor();
    const sizeText = await p.locator(".dm-size").getAttribute("title");
    const sending = p.waitForRequest(
      (req) =>
        req.url().endsWith("/api/feed/thread/" + peer) &&
        req.method() === "POST",
    );
    await p.getByRole("button", { name: "Send", exact: false }).click();
    const { media } = (await sending).postDataJSON();
    assert.equal(media.type, "image/jpeg");
    const bytes = Buffer.from(media.data, "base64").length;
    assert.equal(
      sizeText,
      await p.evaluate(
        (b) => `Attachment size: ${b.toLocaleString()} bytes`,
        bytes,
      ),
    );
    await p.locator(".bubble.mine .message-photo").waitFor();
    const photoUrl = await p.locator(".bubble.mine img").getAttribute("src");
    await p.locator(".bubble.mine img").evaluate((e) => e.decode());
    assert.equal(
      (await (await second.request.get("/api/feed/inbox?q=Private")).json())
        .threads[0].unread,
      1,
    );
    await v.goto(url + "/messages");
    await v
      .locator('#socialNav a[href="/messages"] .nav-unread')
      .getByText("1", { exact: true })
      .waitFor();
    await v.getByRole("button", { name: "Unread", exact: true }).click();
    await v.locator(".thread-row").click();
    await v
      .locator(".dm-unread-divider")
      .getByText("First unread", { exact: true })
      .waitFor();
    assert.equal(
      await v.locator(".dm-unread-divider + .bubble p").textContent(),
      "Private test conversation",
    );
    await v.locator(".bubble").getByText("Private test conversation").waitFor();
    await v.waitForFunction(
      async () =>
        !(await (await fetch("/api/feed/inbox")).json()).threads[0].unread,
    );
    await v.getByRole("textbox", { name: "Message…" }).fill("Received.");
    await p.locator(".thread-head .dm-typing").getByText("Typing…").waitFor();
    await v.getByRole("button", { name: "Send", exact: false }).click();
    await p.locator(".chat-log").getByText("Received.").waitFor();
    // Actual browser capture, recording, and peer-to-peer transport, with Chromium test devices.
    const ctl = (page, name) => page.getByRole("button", { name, exact: true });
    await ctl(p, "Conversation details").click();
    await ctl(p, "Pin chat to inbox").click();
    await p.locator(".thread-row .private-chat-pin").waitFor();
    await ctl(p, "Conversation details").click();
    await p.getByPlaceholder("Nickname").fill("Movie buddy");
    await ctl(p, "Save nickname").click();
    await p.locator(".thread-head").getByText("Movie buddy").waitFor();
    await p.getByRole("button", { name: /Your note/ }).click();
    await p.getByRole("textbox", { name: "Note text" }).fill("Available today");
    await ctl(p, "Save note").click();
    await p.getByRole("button", { name: /Available today/ }).waitFor();
    const received = p
      .locator(".bubble")
      .filter({ has: p.getByText("Received.", { exact: true }) });
    const actions = () =>
      received.getByRole("button", { name: "Message actions" }).click();
    await actions();
    await p
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], { origin: url });
    await ctl(p, "Copy text").click();
    await ctl(p, "Copied").waitFor();
    assert.equal(
      await p.evaluate(() => navigator.clipboard.readText()),
      "Received.",
    );
    await p.evaluate(() =>
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
      }),
    );
    await ctl(p, "Close").click();
    await actions();
    await ctl(p, "Copy text").click();
    assert.ok(
      await p
        .getByLabel("Message text", { exact: true })
        .evaluate(
          (el) =>
            el.readOnly &&
            el.value === "Received." &&
            el.selectionStart === 0 &&
            el.selectionEnd === el.value.length,
        ),
    );
    await p.evaluate(() => delete navigator.clipboard.writeText);
    await ctl(p, "Close").click();
    await actions();
    await ctl(p, "Pin").click();
    await v.getByText("Pinned · Received.", { exact: true }).waitFor();
    await actions();
    await ctl(p, "React").click();
    await p.getByPlaceholder("Search emojis").fill("red heart");
    await ctl(p, "red heart").click();
    await v.locator(".reaction-badge").waitFor();
    await actions();
    await ctl(p, "Reply").click();
    await ctl(p, "Add emoji").click();
    await p.getByPlaceholder("Search emojis").fill("flag: Kenya");
    await ctl(p, "flag: Kenya").click();
    await ctl(p, "Send").click();
    await v.locator(".reply-quote").filter({ hasText: "Received." }).waitFor();
    await v
      .locator("button.reply-quote")
      .filter({ hasText: "Received." })
      .click();
    await v
      .locator(".finder-selected p")
      .getByText("Received.", { exact: true })
      .waitFor();
    await ctl(v, "Close").click();
    const reply = p
      .locator(".bubble.mine")
      .filter({ has: p.locator(".reply-quote") });
    await reply.getByRole("button", { name: "Message actions" }).click();
    await ctl(p, "Unsend").click();
    await ctl(p, "Unsend for everyone").click();
    await v
      .locator(".chat-log")
      .getByText("Message unsent", { exact: true })
      .waitFor();
    await ctl(p, "Add attachment").click();
    await ctl(p, "Voice note").click();
    await ctl(p, "Cancel").click();
    await ctl(p, "Add attachment").click();
    await ctl(p, "Voice note").click();
    await ctl(p, "Pause").click();
    await ctl(p, "Resume").click();
    await p.waitForFunction(() =>
      document.querySelector(".dm-preview")?.textContent.includes("0:01"),
    );
    await ctl(p, "Finish").click();
    await ctl(p, "Remove voice note").waitFor();
    await ctl(p, "Send").click();
    const voiceRate = v.getByLabel("Voice note speed");
    await voiceRate.selectOption("1.5");
    await v.locator(".dm-voice audio").evaluate((e) => e.play());
    assert.equal(
      await v.locator(".dm-voice audio").evaluate((el) => el.playbackRate),
      1.5,
    );
    assert.equal(
      await p.locator(".dm-voice audio").evaluate((el) => el.playbackRate),
      1,
    );
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    );
    await p
      .locator("input[type=file]")
      .setInputFiles({ name: "test.gif", mimeType: "image/gif", buffer: gif });
    await ctl(p, "View once").click();
    await ctl(p, "Send").click();
    await ctl(v, "View once · GIF").click();
    await v.locator("#sheet img").evaluate((e) => e.decode());
    await ctl(v, "Close").click();
    await ctl(p, "Opened · GIF").waitFor();
    await ctl(p, "Start audio call").click();
    await ctl(v, "Decline").click();
    await p.locator(".call-panel").waitFor({ state: "hidden" });
    for (const kind of ["audio", "video"]) {
      await ctl(p, "Start " + kind + " call").click();
      await v.getByLabel("Start with mic muted").check();
      await v.evaluate(() => {
        const original = RTCPeerConnection.prototype.addTrack;
        window.micAtAttach = [];
        RTCPeerConnection.prototype.addTrack = function (track, ...rest) {
          if (track.kind === "audio") window.micAtAttach.push(track.enabled);
          return original.call(this, track, ...rest);
        };
        window.restoreAddTrack = () => {
          RTCPeerConnection.prototype.addTrack = original;
        };
      });
      if (kind === "video") {
        // Simulate an unavailable camera, not an unavailable mic. The same
        // invitation must still be answerable without another camera request.
        await v.evaluate(() => {
          const devices = navigator.mediaDevices,
            original = devices.getUserMedia.bind(devices);
          window.cameraAttempts = 0;
          devices.getUserMedia = (constraints) => {
            if (constraints.video) {
              window.cameraAttempts++;
              throw new DOMException("Camera busy", "NotReadableError");
            }
            return original(constraints);
          };
          window.restoreCapture = () => {
            devices.getUserMedia = original;
          };
        });
        await ctl(v, "Answer with camera").click();
        await v.getByText(/Couldn’t open the camera/).waitFor();
        await ctl(v, "Answer with mic only").click();
      } else await ctl(v, "Accept").click();
      for (const page of [p, v])
        await page
          .locator(".call-panel")
          .getByText("Connected", { exact: true })
          .waitFor();
      await v.waitForFunction(
        () =>
          document.querySelector(".call-remote")?.srcObject?.getAudioTracks()[0]
            ?.readyState === "live",
      );
      assert.deepEqual(
        await v.evaluate(() => {
          window.restoreAddTrack();
          return window.micAtAttach;
        }),
        [false],
      );
      await ctl(v, "Minimize").click();
      await v.getByText("Mic muted", { exact: true }).waitFor();
      await ctl(v, "Unmute").click();
      await v.getByText("Mic on", { exact: true }).waitFor();
      await ctl(v, "Restore call").click();
      const panel = p.locator(".call-panel"),
        size = panel.getByRole("combobox", { name: "Call size" });
      const stream = await panel
        .locator(".call-remote")
        .evaluateHandle((el) => el.srcObject);
      if (kind === "video") {
        assert.equal(
          await v.evaluate(() => {
            window.restoreCapture();
            return window.cameraAttempts;
          }),
          1,
        );
        assert.equal(
          await v
            .locator(".call-local")
            .evaluate((el) => el.srcObject.getVideoTracks().length),
          0,
        );
        await ctl(v, "Camera on").click();
        await p.waitForFunction(
          () => document.querySelector(".call-remote").videoWidth > 0,
        );
      } else {
        const url = "**/api/feed/calls?live=*";
        await p.route(url, (route) =>
          route.fulfill({ status: 503, body: "Temporarily unavailable" }),
        );
        await p.evaluate(() => window.dispatchEvent(new Event("dm-call")));
        await panel.getByText("Call controls reconnecting…").waitFor();
        await p.unroute(url);
        await p.evaluate(() => window.dispatchEvent(new Event("dm-call")));
        await panel.getByText("Connected", { exact: true }).waitFor();
      }
      for (const page of [p, v])
        await page.getByText("My call settings", { exact: true }).click();
      const voice = p.getByRole("slider", { name: "Partner volume" }),
        preview = p.getByRole("checkbox", { name: "Show my camera preview" });
      assert.equal(await voice.inputValue(), "100");
      await voice.press("Home");
      assert.ok(
        await panel
          .locator(".call-remote")
          .evaluate(
            (el) => el.muted && el.srcObject.getAudioTracks()[0].enabled,
          ),
      );
      await voice.press("ArrowRight");
      assert.equal(
        await panel.locator(".call-remote").evaluate((el) => el.volume),
        0.01,
      );
      assert.equal(
        await v.locator(".call-remote").evaluate((el) => el.volume),
        1,
      );
      if (kind === "video") {
        await preview.uncheck();
        await panel.locator(".call-local").waitFor({ state: "hidden" });
        assert.ok(
          await panel.locator(".call-local").evaluate((el) => {
            const t = el.srcObject.getVideoTracks()[0];
            return t.enabled && t.readyState === "live";
          }),
        );
        await v
          .locator(".call-remote")
          .evaluate(
            (el) =>
              new Promise((resolve) =>
                el.requestVideoFrameCallback(() =>
                  el.requestVideoFrameCallback(resolve),
                ),
              ),
          );
        await preview.check();
        await panel.locator(".call-local").waitFor();
      } else assert.ok(await preview.isDisabled());
      const widths = [];
      // Measure final layout, independent of the user's motion preference.
      for (const preset of ["small", "medium", "large"]) {
        await size.selectOption(preset);
        widths.push(
          await panel.evaluate(async (el) => {
            void el.offsetWidth;
            await Promise.all(el.getAnimations().map((a) => a.finished));
            return el.offsetWidth;
          }),
        );
      }
      assert.ok(
        widths[0] < widths[1] && widths[1] < widths[2],
        "Call sizes increase",
      );
      if (kind === "video") await p.keyboard.press("Escape");
      else await ctl(p, "Minimize").click();
      assert.equal(await panel.evaluate((el) => el.matches(":modal")), false);
      await p
        .getByPlaceholder("Message…", { exact: true })
        .fill("Still on the call");
      await ctl(p, "Send").click();
      await ctl(p, "Restore call").click();
      assert.equal(await size.inputValue(), "large");
      assert.equal(await panel.evaluate((el) => el.matches(":modal")), true);
      assert.ok(
        await panel
          .locator(".call-remote")
          .evaluate(
            (el, old) =>
              el.srcObject === old &&
              old.getAudioTracks()[0].readyState === "live",
            stream,
          ),
      );
      if (kind === "audio") {
        await ctl(p, "Switch to video").click();
        await ctl(v, "Camera on").waitFor();
        await v.waitForFunction(
          () => document.querySelector(".call-remote").videoWidth > 0,
        );
        assert.equal(
          await v
            .locator(".call-local")
            .evaluate((el) => el.srcObject.getVideoTracks().length),
          0,
        );
        await ctl(v, "Camera on").click();
        await p.waitForFunction(
          () => document.querySelector(".call-remote").videoWidth > 0,
        );
        await ctl(v, "Switch to audio").click();
        await ctl(p, "Switch to video").waitFor();
        for (const page of [p, v])
          assert.equal(
            await page
              .locator(".call-local")
              .evaluate((el) => el.srcObject.getVideoTracks().length),
            0,
          );
        assert.ok(
          await panel
            .locator(".call-remote")
            .evaluate(
              (el, old) =>
                el.srcObject === old &&
                old.getAudioTracks()[0].readyState === "live",
              stream,
            ),
        );
      }
      await stream.dispose();
      await ctl(p, "Mute").click();
      await ctl(p, "Unmute").click();
      if (kind === "video") {
        await v.waitForFunction(
          () => document.querySelector(".call-remote")?.videoWidth > 0,
        );
        assert.ok(
          await p.locator(".call-local").evaluate((el) => {
            const r = el.getBoundingClientRect();
            return (
              getComputedStyle(el).objectFit === "contain" &&
              r.height > r.width / 2
            );
          }),
        );
        await ctl(v, "Camera off").click();
        await ctl(v, "Camera on").click();
      }
      {
        // Substitute only the browser picker. Canvas pixels, tab audio and both
        // cameras/mics then travel over the actual WebRTC connection.
        for (const [host, guest] of [
          [p, v],
          [v, p],
        ]) {
          const noAudio = host === v && kind === "video",
            blockPlayback = guest === v && kind === "audio";
          if (blockPlayback)
            await guest.locator(".watch-video").evaluate((el) => {
              const original = el.play.bind(el);
              el.play = () => {
                el.play = original;
                return Promise.reject(
                  new DOMException("Gesture required", "NotAllowedError"),
                );
              };
            });
          await host.evaluate(
            (noAudio) =>
              Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
                configurable: true,
                value: async () => {
                  const page = document.createElement("canvas");
                  page.width = 256;
                  page.height = 160;
                  const ctx = page.getContext("2d"),
                    stream = page.captureStream(12);
                  let count = 0;
                  const t = setInterval(() => {
                    ctx.fillStyle = count++ % 2 ? "blue" : "red";
                    ctx.fillRect(0, 0, 256, 160);
                    if (!stream.active) clearInterval(t);
                  }, 80);
                  if (!noAudio)
                    stream.addTrack(
                      document
                        .querySelector(".call-local")
                        .srcObject.getAudioTracks()[0]
                        .clone(),
                    );
                  return stream;
                },
              }),
            noAudio,
          );
          await ctl(host, "Watch together").click();
          await ctl(host, "Share a tab").click();
          if (noAudio) {
            await host.getByText("No tab audio captured").waitFor();
            assert.equal(await ctl(host, "Pause tab sound").count(), 0);
          } else {
            await host.getByText("Tab audio included").waitFor();
            await ctl(host, "Pause tab sound").click();
            await host.getByText("Tab sound paused").waitFor();
            assert.ok(
              await host.evaluate(
                () =>
                  !document
                    .querySelector(".watch-video")
                    .srcObject.getAudioTracks()[0].enabled &&
                  document
                    .querySelector(".call-local")
                    .srcObject.getAudioTracks()[0].enabled,
              ),
            );
            await ctl(host, "Resume tab sound").click();
            assert.ok(
              await host
                .locator(".watch-video")
                .evaluate((el) => el.srcObject.getAudioTracks()[0].enabled),
            );
          }
          if (blockPlayback) {
            await ctl(guest, "Play shared tab").click();
            await ctl(guest, "Play shared tab").waitFor({ state: "hidden" });
          }
          await guest.waitForFunction((kind) => {
            const v = document.querySelector(".watch-video");
            return (
              v?.videoWidth === 256 &&
              v.currentTime > 0 &&
              v.srcObject.getAudioTracks()[0]?.readyState === "live" &&
              (kind === "audio" ||
                document.querySelector(".call-remote")?.videoWidth > 0)
            );
          }, kind);
          const tab = guest.getByRole("slider", { name: "Shared tab volume" });
          await tab.press("Home");
          assert.ok(
            await guest
              .locator(".watch-video")
              .evaluate((el) => el.muted && el.volume === 0),
          );
          assert.equal(
            await guest.locator(".call-remote").evaluate((el) => el.volume),
            guest === p ? 0.01 : 1,
          );
          assert.equal(
            await host
              .getByRole("slider", { name: "Shared tab volume" })
              .count(),
            0,
          );
          assert.ok(
            await host
              .locator(".watch-video")
              .evaluate((el) => el.muted && !el.controls),
          );
          await tab.press("End");
          const loss = kind === "audio" && guest === v,
            text = loss ? "One copy after retry" : "Great scene";
          const restore = loss
            ? await loseConfirmation(
                guest,
                `**/api/feed/thread/${author}`,
                (b) => b.body === text,
              )
            : null;
          await guest
            .getByPlaceholder("Message your watch partner…")
            .fill(text);
          await guest.locator(".watch-compose button").click();
          if (loss) {
            await ctl(guest, "Retry send").click();
            await restore();
            assert.equal(
              (
                await (
                  await guest.request.get("/api/feed/thread/" + author)
                ).json()
              ).messages.filter((m) => m.body === text).length,
              1,
            );
          }
          await host
            .locator(".watch-log")
            .getByText(text, { exact: true })
            .first()
            .waitFor();
          await ctl(host, "Stop sharing").click();
          await guest.locator(".watch-pane").waitFor({ state: "hidden" });
        }
      }
      // Reuse the stand-in for the browser tab picker above. Exercise both
      // screen recording entry points and retain the audio-only download check.
      for (const action of kind === "audio"
        ? ["Record audio only", "Record screen + audio"]
        : ["Record screen + audio"]) {
        await ctl(p, "Request recording").click();
        await p.getByText("Before requesting recording").waitFor();
        assert.equal(await ctl(v, "Allow recording").count(), 0);
        await ctl(p, "Ask for consent").click();
        await v
          .getByText(/Shared-tab and system sound are not mixed in/)
          .waitFor();
        await ctl(v, "Allow recording").click();
        await ctl(p, action).click();
        await v.getByText("Recording this call", { exact: true }).waitFor();
        for (const page of [p, v])
          await page.waitForFunction(() =>
            /^0:0[1-9]$/.test(
              document.querySelector(".record-clock")?.textContent,
            ),
          );
        const saved = p.waitForEvent("download");
        await ctl(v, "Stop recording").click();
        const download = await saved;
        assert.equal(await download.failure(), null);
        const file = await download.path();
        const bytes = await readFile(file);
        await verifyRecording(p, bytes, action === "Record screen + audio");
        const again = p.getByRole("link", { name: "Download recording again" });
        await again.waitFor();
        assert.equal(
          await v
            .getByRole("link", { name: "Download recording again" })
            .count(),
          0,
        );
        if (action === "Record audio only") {
          const repeated = p.waitForEvent("download");
          await again.click();
          const second = await repeated;
          assert.equal(
            second.suggestedFilename(),
            download.suggestedFilename(),
          );
          assert.ok(bytes.equals(await readFile(await second.path())));
        }
      }
      await ctl(p, "Minimize").click();
      await ctl(v, "End call").click();
      await p.locator(".call-panel").waitFor({ state: "hidden" });
      await p.getByRole("link", { name: "Download recording again" }).waitFor();
      await ctl(p, "Dismiss download link").click();
      await p.locator(".record-download").waitFor({ state: "hidden" });
    }
    // Exercise a real overflowing conversation, not synthetic scroll events.
    const composer = p.getByRole("textbox", { name: "Message…", exact: true });
    await composer.fill("First line");
    await composer.press("Shift+Enter");
    await composer.pressSequentially("Second line");
    assert.equal(await composer.inputValue(), "First line\nSecond line");
    await composer.press("Enter");
    await v
      .locator(".bubble p")
      .getByText("First line Second line", { exact: true })
      .waitFor();
    const history = v.getByRole("region", { name: "Conversation history" });
    await history.evaluate((el) => (el.scrollTop = 0));
    await ctl(v, "Jump to latest ↓").waitFor();
    await composer.fill("While you were reading");
    await composer.press("Enter");
    await ctl(v, "New messages ↓").waitFor();
    assert.equal(await history.evaluate((el) => el.scrollTop), 0);
    assert.ok(
      (await (await second.request.get("/api/feed/inbox")).json()).threads.find(
        (t) => t.id === author,
      ).unread > 0,
    );
    // Search and context use their own pane: the log stays scrolled up and
    // the new message stays unread until the recipient actually jumps down.
    await ctl(v, "Search this chat").click();
    await v
      .getByRole("searchbox", { name: "Search text or captions" })
      .fill("private TEST");
    await v.getByText("Filters", { exact: true }).click();
    await v.getByLabel("Sent by").selectOption("me");
    await ctl(v, "Search").click();
    await v.getByText("No matches in this conversation.").waitFor();
    const today = await v.evaluate(() => {
      const d = new Date();
      return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-");
    });
    await v.getByLabel("Sent by").selectOption("partner");
    await v.getByLabel("From date").fill(today);
    await v.getByLabel("Through date").fill(today);

    await ctl(v, "Search").click();
    await v
      .locator(".finder-result")
      .filter({ hasText: "Private test conversation" })
      .click();
    await v
      .locator(".finder-selected")
      .getByText("Private test conversation", { exact: true })
      .waitFor();
    await v
      .locator(".finder-line")
      .getByText("Received.", { exact: true })
      .waitFor();
    await ctl(v, "Back to search").click();
    await v.locator(".finder-result").waitFor();
    await ctl(v, "Close").click();
    assert.equal(await history.evaluate((el) => el.scrollTop), 0);
    await ctl(v, "Pinned · Received.").click();
    await v
      .locator(".finder-selected")
      .getByText("Received.", { exact: true })
      .waitFor();
    await ctl(v, "Close").click();
    await ctl(v, "New messages ↓").click();
    await v.waitForFunction(
      async () =>
        !(await (await fetch("/api/feed/inbox")).json()).threads[0].unread,
    );
    const dmPath = `**/api/feed/thread/${peer}`,
      recoveryText = "Recovered DM",
      attempts = [];
    await p.route(dmPath, async (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.postDataJSON().body === recoveryText) {
        attempts.push(req.postDataJSON().clientId);
        if (attempts.length === 1) return route.abort("internetdisconnected");
      }
      await route.continue();
    });
    await composer.fill(recoveryText);
    await composer.press("Enter");
    await p.getByText("Not confirmed · Will retry when connected").waitFor();
    await p.evaluate(() => window.dispatchEvent(new Event("online")));
    await v
      .locator(".chat-log")
      .getByText(recoveryText, { exact: true })
      .waitFor();
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0], attempts[1]);
    await p.unroute(dmPath);
    const third = await browser.newContext({ baseURL: url });
    try {
      assert.equal((await third.request.get(photoUrl)).status(), 401);
      assert.equal(
        (
          await third.request.post("/api/signup", {
            headers,
            data: {
              email: "third@example.test",
              username: "third_test",
              fullName: "Third Test",
              password: "Third-Test-Password-123",
            },
          })
        ).status(),
        201,
      );
      assert.equal((await third.request.get(photoUrl)).status(), 404);
      assert.deepEqual(
        (await (await third.request.get("/api/feed/thread/" + peer)).json())
          .messages,
        [],
      );
      assert.equal(
        (await third.request.get("/api/feed/post/" + postId)).status(),
        404,
      );
      assert.equal(
        (
          await third.request.post("/api/feed/comment", {
            headers,
            data: { post: postId, body: "Not visible" },
          })
        ).status(),
        404,
      );
      assert.deepEqual(
        (
          await (
            await third.request.get("/api/feed/discover?q=My%20first")
          ).json()
        ).posts,
        [],
      );
    } finally {
      await third.close();
    }
    await p.getByRole("link", { name: /^Groups(?:, \d+ unread)?$/ }).click();
    await ctl(p, "Create group").click();
    await p.getByPlaceholder("Group name").fill("Movie night");
    await p.getByLabel("Group topic (optional)").fill("Plan a watch party");
    await ctl(p, "Choose people").click();
    await p.getByText("1 joined · 0 pending · 29 of 30 places free").waitFor();
    await p.getByRole("checkbox", { name: "Second Member" }).check();
    await p.getByText("1 joined · 0 pending · 28 of 30 places free").waitFor();
    await ctl(p, "Send invites (1)").click();
    await p.getByRole("heading", { name: "Movie night" }).waitFor();
    await p.getByText("Plan a watch party", { exact: true }).waitFor();
    await ctl(p, "Details").click();
    await ctl(p, "Leave group").click();
    await p.getByText("Invitations cancelled: 1").waitFor();
    await p
      .getByRole("dialog")
      .getByText("Second Member", { exact: true })
      .waitFor();
    await ctl(p, "Stay in group").click();
    await ctl(p, "Close").click();
    await v.goto(url + "/groups");
    await ctl(v, "Unread chats").click();
    await v.getByText("No unread conversations.").waitFor();
    await ctl(v, "Invitations").click();
    await v.getByRole("link", { name: /Invitation from.*Movie night/ }).click();
    await ctl(v, "Accept").click();
    await v.getByText("Plan a watch party", { exact: true }).waitFor();
    await ctl(p, "Details").click();
    await ctl(p, "Edit group").click();
    await p.getByLabel("Group name").fill("Friday film club");
    await p.getByLabel("Group topic (optional)").fill("Vote for the next film");
    await ctl(p, "Save group details").click();
    await v.getByRole("heading", { name: "Friday film club" }).waitFor();
    await v.getByText("Vote for the next film", { exact: true }).waitFor();
    const gid = new URL(p.url()).pathname.split("/").pop();
    await ctl(p, "Details").click();
    const restoreGroup = await loseConfirmation(
      v,
      `**/api/feed/linkbacks/${gid}`,
      (b) => b.action === "message",
    );
    const composerG = v.getByPlaceholder("Message this group…");
    await composerG.fill("Ready");
    await composerG.press("Shift+Enter");
    await composerG.pressSequentially("to watch!");
    await composerG.press("Enter");
    await ctl(v, "Retry send").click();
    await restoreGroup();
    const group = await (
      await p.request.get("/api/feed/linkbacks/" + gid)
    ).json();
    assert.equal(
      group.messages.filter((m) => m.body === "Ready\nto watch!").length,
      1,
    );
    assert.equal(group.unread, 1);
    await ctl(p, "Close").click();
    await ctl(p, "Ready to watch!").waitFor();
    await p.waitForFunction(
      async (gid) =>
        (await (await fetch("/api/feed/linkbacks/" + gid)).json()).unread === 0,
      gid,
    );
    await ctl(p, "Details").click();
    const roster = p.getByLabel("Find a member or invitee");
    await roster.fill("Absent person");
    await p.getByText("No matching members or invitees.").waitFor();
    await roster.fill("seConD");
    assert.equal(await p.locator(".lb-people .lb-person").count(), 1);
    await ctl(p, "Make admin").click();
    await ctl(p, "Confirm transfer").click();
    await v.reload();
    await ctl(v, "Details").click();
    await v.getByRole("dialog").getByText("Second Member · Admin").waitFor();
    await ctl(v, "Edit group").waitFor();
    await ctl(v, "Close").click();
    await v.goto(url + "/post/" + postId);
    await v
      .getByRole("textbox", { name: "Add a comment…" })
      .fill("@ui_updated thanks!");
    await v.getByRole("button", { name: "Post", exact: true }).click();
    await v
      .locator(".comment")
      .getByText("@ui_updated thanks!", { exact: true })
      .waitFor();
    await v.getByRole("button", { name: "Like post, 0 likes" }).click();
    await v.getByRole("button", { name: "Like post, 1 likes" }).waitFor();
    await p.goto(url + "/post/" + postId);
    await p.getByRole("button", { name: "Reply", exact: false }).click();
    await p
      .getByRole("textbox", { name: "Add a comment…" })
      .fill("Thanks for reading");
    await p.getByRole("button", { name: "Post", exact: true }).click();
    await p.locator(".reply-reference").waitFor();
    await p.goto(url + "/notifications");
    await p.getByRole("button", { name: "Mentions", exact: true }).click();
    await p
      .locator(".notice.unread")
      .getByText("Second Member mentioned you")
      .waitFor();
    const badge = p.locator('#socialNav [href="/notifications"] .nav-unread');
    await badge.waitFor();
    await p.getByRole("button", { name: "Mark all as read" }).click();
    await badge.waitFor({ state: "hidden" });
    await p.getByRole("heading", { name: "Earlier", exact: true }).waitFor();
    // Create a short playable test clip at runtime, never seed member feeds.
    const clip = await v.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const ctx = c.getContext("2d"),
        stream = c.captureStream(10),
        rec = new MediaRecorder(stream, { mimeType: "video/webm" }),
        chunks = [];
      const stopped = new Promise((resolve) => (rec.onstop = resolve));
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.start();
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? "#7822aa" : "#221166";
        ctx.fillRect(0, 0, 64, 64);
        await new Promise((r) => setTimeout(r, 100));
      }
      rec.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      return btoa(
        String.fromCharCode(
          ...new Uint8Array(await new Blob(chunks).arrayBuffer()),
        ),
      );
    });
    const resp = await second.request.post("/api/feed/posts", {
      headers,
      data: {
        body: "Test motion clip",
        media: [{ type: "video/webm", data: clip }],
      },
    });
    assert.equal(resp.status(), 201);
    const { id } = await resp.json();
    await v.goto(url + "/search?q=motion");
    await v.getByRole("button", { name: "Reels", exact: true }).click();
    await v.locator(".result-card").click();
    const video = v.locator(".player video");
    await video.evaluate(async (e) => {
      e.muted = true;
      await e.play();
    });
    await v.waitForFunction(async () => {
      const r = await (await fetch("/api/feed/discover?kind=reels")).json();
      return r.posts[0].views === 1;
    });
    await v.getByRole("button", { name: "Like reel, 0 likes" }).click();
    await v.getByRole("button", { name: "Like reel, 1 likes" }).waitFor();
    assert.equal(new URL(v.url()).searchParams.get("id"), String(id));
    // Follow a real invitation from the post into the recipient's mobile inbox.
    await p.goto(url + "/post/" + postId);
    await p.getByRole("button", { name: "Post options" }).click();
    await p.getByRole("button", { name: "Start a Linkback" }).click();
    await p
      .getByRole("textbox", { name: "First message (optional)" })
      .fill("Meet by the station?");
    await p.getByRole("button", { name: "Choose people" }).click();
    await p.getByRole("checkbox", { name: "Second Member" }).check();
    await p.getByRole("button", { name: "Send invites (1)" }).click();
    await p
      .getByRole("button", { name: "Meet by the station?", exact: true })
      .waitFor();
    const groupPath = new URL(p.url()).pathname;
    await v.setViewportSize({ width: 390, height: 844 });
    await v.goto(url + "/messages");
    await v.getByRole("link", { name: /^Linkbacks(?:, \d+ unread)?$/ }).click();
    await v.getByRole("link", { name: /Invitation from/ }).click();
    assert.equal(await v.locator(".lb-bubble").count(), 0);
    await v.getByRole("button", { name: "Accept", exact: true }).click();
    await v
      .getByRole("textbox", { name: "Message this Linkback…" })
      .fill("Saturday at seven");
    await v.getByRole("button", { name: "Send", exact: true }).click();
    await v
      .getByRole("button", { name: "Saturday at seven", exact: true })
      .click();
    await v.getByRole("button", { name: "Pin as decision" }).click();
    await v.locator(".lb-decision").getByText("Saturday at seven").waitFor();
    await v.getByRole("button", { name: "Details" }).click();
    await v.getByRole("dialog").getByText("RADAR · Admin").waitFor();
    await v.keyboard.press("Escape");
    await p.goto(url + "/post/" + postId);
    await p.getByRole("button", { name: "Post options" }).click();
    await p.getByRole("button", { name: "Your Linkbacks" }).click();
    await p
      .getByRole("dialog")
      .getByRole("link", { name: /Saturday at seven/ })
      .click();
    await p.locator(".lb-decision").getByText("Saturday at seven").waitFor();
    if (process.env.SOCIAL_SCREENSHOTS) {
      const { mkdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await mkdir(process.env.SOCIAL_SCREENSHOTS, { recursive: true });
      await v.setViewportSize({ width: 1440, height: 900 });
      for (const [k, path] of Object.entries({
        inbox: "/messages",
        linkback: groupPath,
        thread: "/messages/" + author,
        post: "/post/" + postId,
        search: "/search",
        reels: "/reels",
        notifications: "/notifications",
        settings: "/settings",
        privacy: "/settings/privacy",
        security: "/settings/security",
        preferences: "/settings/notifications",
        appearance: "/settings/appearance",
        saved: "/saved",
        connections: "/connections",
        storyEditor: "/stories/create",
        safety: "/safety?id=" + author,
      })) {
        await v.goto(url + path);
        await v.locator("#surface[aria-busy=false]").waitFor();
        await v.screenshot({
          path: join(process.env.SOCIAL_SCREENSHOTS, k + ".jpg"),
          animations: "disabled",
        });
      }
    }
    await v.goto(url + "/stories/create");
    await v.getByRole("button", { name: "Forest", exact: true }).click();
    await v.getByRole("textbox", { name: "Add caption…" }).fill("Forest story");
    await v
      .getByRole("button", { name: "Share to Story", exact: true })
      .click();
    await v.locator(".story-player").getByText("Forest story").waitFor();
    await v.goto(url + "/settings/appearance");
    await v.getByRole("button", { name: "dark", exact: true }).click();
    await v.getByRole("button", { name: "green", exact: true }).click();
    await v.getByRole("switch", { name: "Reduce Motion" }).check();
    await v.getByRole("button", { name: "Save Appearance" }).click();
    await v.waitForFunction(
      () =>
        document.documentElement.dataset.color === "dark" &&
        document.documentElement.dataset.motion === "reduce",
    );
    await v.setViewportSize({ width: 320, height: 640 });
    for (const path of [
      "/messages",
      "/messages/" + author,
      "/search",
      "/notifications",
      "/reels",
      "/post/" + postId,
      "/settings",
      "/settings/privacy",
      groupPath,
      "/linkbacks",
      "/settings/notifications",
      "/settings/appearance",
      "/settings/security",
      "/connections",
      "/saved",
      "/safety?id=" + author + "&post=" + postId,
      "/stories/create",
      "/stories",
    ]) {
      await v.goto(url + path);
      await v.locator("#surface[aria-busy=false]").waitFor();
      assert.equal(await v.locator("#alert").isVisible(), false, path);
      assert.equal(
        await v.locator("html").getAttribute("data-accent"),
        "green",
        path,
      );
      assert.equal(
        await v
          .locator("#socialBar")
          .evaluate((e) => getComputedStyle(e).backgroundColor),
        "rgb(32, 33, 44)",
        path,
      );
      assert.deepEqual(
        await v
          .locator("#socialNav a")
          .evaluateAll((nodes) => nodes.map((e) => e.getAttribute("href"))),
        ["/home", "/messages", "/notifications", "/settings", "/profile"],
        path,
      );
      for (const use of await v.locator("#socialNav svg use").all()) {
        assert.match(await use.getAttribute("href"), /^\/assets\/icons\.svg#/);
        assert.ok(await use.evaluate((n) => n.getBBox().width > 0));
      }
      assert.ok(
        await v.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        path + " overflows mobile",
      );
    }
    for (const path of ["/home", "/profile", "/profile/edit", "/create"]) {
      await v.goto(url + path);
      await v.locator("#account").waitFor();
      assert.equal(
        await v.locator("html").getAttribute("data-accent"),
        "green",
        path,
      );
      assert.equal(
        await v
          .locator(".topbar")
          .evaluate((e) => getComputedStyle(e).backgroundColor),
        "rgb(32, 33, 44)",
        path,
      );
      if (path === "/create")
        assert.match(
          await v
            .locator("#publishPost")
            .evaluate((e) => getComputedStyle(e).backgroundImage),
          /rgb\(20, 127, 113\)/,
        );
    }
    assert.deepEqual(errors, []);
  } finally {
    await p.close();
    await v.close();
  }
}
