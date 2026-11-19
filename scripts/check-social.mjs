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
    if (process.env.SOCIAL_SCREENSHOTS) {
      const { mkdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await mkdir(process.env.SOCIAL_SCREENSHOTS, { recursive: true });
      await v.setViewportSize({ width: 1440, height: 900 });
      for (const [k, path] of Object.entries({
        inbox: "/messages",
        thread: "/messages/" + author,
        post: "/post/" + postId,
        search: "/search",
        reels: "/reels",
        notifications: "/notifications",
      })) {
        await v.goto(url + path);
        await v.locator("#surface[aria-busy=false]").waitFor();
        await v.screenshot({
          path: join(process.env.SOCIAL_SCREENSHOTS, k + ".jpg"),
          animations: "disabled",
        });
      }
    }
    await v.setViewportSize({ width: 320, height: 640 });
    for (const path of [
      "/messages",
      "/messages/" + author,
      "/search",
      "/notifications",
      "/reels",
      "/post/" + postId,
    ]) {
      await v.goto(url + path);
      await v.locator("#surface[aria-busy=false]").waitFor();
      assert.equal(await v.locator("#alert").isVisible(), false, path);
      assert.ok(
        await v.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        path + " overflows mobile",
      );
    }
    assert.deepEqual(errors, []);
  } finally {
    await p.close();
    await v.close();
  }
}
