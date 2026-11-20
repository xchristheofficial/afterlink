import assert from "node:assert/strict";
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
  try {
    await p.goto(url + "/messages");
    await p.getByRole("button", { name: "New Message", exact: false }).click();
    await p.locator(".picker-row").filter({ hasText: "Second Member" }).click();
    await p
      .getByRole("textbox", { name: "Message…" })
      .fill("Private test conversation");
    await p
      .locator("input[type=file]")
      .setInputFiles("public/assets/editor-avatar.webp");
    await p.getByRole("button", { name: "Remove photo" }).waitFor();
    await p.getByRole("button", { name: "Send", exact: false }).click();
    await p.locator(".bubble.mine .message-photo").waitFor();
    const photoUrl = await p.locator(".bubble.mine img").getAttribute("src");
    await p.locator(".bubble.mine img").evaluate((e) => e.decode());
    assert.equal(
      (await (await second.request.get("/api/feed/inbox?q=Private")).json())
        .threads[0].unread,
      1,
    );
    await v.goto(url + "/messages/" + author);
    await v.locator(".bubble").getByText("Private test conversation").waitFor();
    await v.waitForFunction(
      async () =>
        !(await (await fetch("/api/feed/inbox")).json()).threads[0].unread,
    );
    await v.getByRole("textbox", { name: "Message…" }).fill("Received.");
    await v.getByRole("button", { name: "Send", exact: false }).click();
    await p.locator(".chat-log").getByText("Received.").waitFor();
    // Actual browser capture, recording, and peer-to-peer transport, with Chromium test devices.
    const ctl = (page, name) => page.getByRole("button", { name, exact: true });
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
    await v.locator(".dm-voice audio").evaluate((e) => e.play());
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
      await ctl(v, "Accept").click();
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
      await ctl(p, "Mute").click();
      await ctl(p, "Unmute").click();
      if (kind === "video") {
        await v.waitForFunction(
          () => document.querySelector(".call-remote")?.videoWidth > 0,
        );
        await ctl(v, "Camera off").click();
        await ctl(v, "Camera on").click();
      }
      if (kind === "video") {
        // Substitute only the browser picker. Canvas pixels, tab audio and both
        // cameras/mics then travel over the actual WebRTC connection.
        for (const [host, guest] of [
          [p, v],
          [v, p],
        ]) {
          await host.evaluate(() =>
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
                stream.addTrack(
                  document
                    .querySelector(".call-local")
                    .srcObject.getAudioTracks()[0]
                    .clone(),
                );
                return stream;
              },
            }),
          );
          await ctl(host, "Watch together").click();
          await ctl(host, "Share a tab").click();
          await guest.waitForFunction(() => {
            const v = document.querySelector(".watch-video");
            return (
              v?.videoWidth === 256 &&
              v.currentTime > 0 &&
              v.srcObject.getAudioTracks()[0]?.readyState === "live" &&
              document.querySelector(".call-remote")?.videoWidth > 0
            );
          });
          await guest
            .getByPlaceholder("Message your watch partner…")
            .fill("Great scene");
          await guest.locator(".watch-compose button").click();
          await host
            .locator(".watch-log")
            .getByText("Great scene", { exact: true })
            .first()
            .waitFor();
          await ctl(host, "Stop sharing").click();
          await guest.locator(".watch-pane").waitFor({ state: "hidden" });
        }
      }
      await ctl(p, "Request recording").click();
      await ctl(v, "Allow recording").click();
      if (kind === "video") {
        // Replace the OS chooser only. Record a real video track and both live audio streams.
        await p.evaluate(() =>
          Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
            value: async () =>
              new MediaStream([
                document
                  .querySelector(".call-local")
                  .srcObject.getVideoTracks()[0]
                  .clone(),
              ]),
          }),
        );
      }
      await ctl(
        p,
        kind === "audio" ? "Record audio only" : "Record screen + audio",
      ).click();
      await v.getByText("Recording this call", { exact: true }).waitFor();
      await p.waitForTimeout(1250);
      const saved = p.waitForEvent("download");
      await ctl(v, "Stop recording").click();
      const download = await saved;
      assert.equal(await download.failure(), null);
      const file = await download.path();
      assert.ok(
        (await (await import("node:fs/promises")).stat(file)).size > 100,
      );
      await ctl(v, "End call").click();
      await p.locator(".call-panel").waitFor({ state: "hidden" });
    }
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
    await p.getByRole("link", { name: "Groups", exact: true }).click();
    await ctl(p, "Create group").click();
    await p.getByPlaceholder("Group name").fill("Movie night");
    await ctl(p, "Choose people").click();
    await p.getByRole("checkbox", { name: "Second Member" }).check();
    await ctl(p, "Send invites (1)").click();
    await p.getByRole("heading", { name: "Movie night" }).waitFor();
    await v.goto(url + "/groups");
    await v.getByRole("link", { name: /Invitation from.*Movie night/ }).click();
    await ctl(v, "Accept").click();
    await v.getByPlaceholder("Message this group…").fill("Ready to watch!");
    await ctl(v, "Send").click();
    await ctl(p, "Ready to watch!").waitFor();
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
    await p.getByRole("button", { name: "Mark all as read" }).click();
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
    await v.getByRole("link", { name: "Linkbacks", exact: true }).click();
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
