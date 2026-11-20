// Real page shells, synthetic color bars and in-memory request capture only.
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import express from "express";
import { chromium } from "playwright";
import { memberAssets } from "../web-assets.mjs";
const app = express(),
  changes = [],
  shell = await readFile("public/index.html", "utf8");
let priv = true,
  memberId = 3,
  currentTheme = "light";
app.use(express.json());
app.get(["/profile", "/profile/edit"], (req, res) =>
  res
    .type("html")
    .send(
      memberAssets(shell, req.path).replace(
        "<!-- member-session -->",
        '<meta name="member-session" content="member%40example.test">',
      ),
    ),
);
app.get("/settings/privacy", (_, res) =>
  res.sendFile(resolve("public/social.html")),
);
app.get("/api/feed/settings", (_, res) =>
  memberId === null
    ? res.sendStatus(401)
    : res.json({
        id: memberId,
        prefs: {
          theme: currentTheme,
          messages: "followers",
          mention: true,
          like: false,
          privateTestField: "not for export",
        },
        private: priv,
        restricted: [{ id: 9, name: "Private fixture name", kind: "block" }],
      }),
);
app.get("/api/feed/profile", (_, res) =>
  res.json({
    own: true,
    posts: [],
    profile: { id: 3, name: "Mila", username: "mila", private: priv, bio: "" },
    contact: { email: "member@example.test" },
  }),
);
app.post(["/api/feed/settings", "/api/feed/profile"], (req, res) => {
  changes.push(req.body);
  priv = req.body.private;
  res.json({ ok: true });
});
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
let browser;
try {
  await once(server, "listening");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    base = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/profile/edit");
  await page.locator("#editForm").waitFor();
  async function photo(width, height) {
    const data = await page.evaluate(
      ([w, h]) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const g = c.getContext("2d");
        ["red", "lime", "blue"].forEach((color, i) => {
          g.fillStyle = color;
          if (w >= h) g.fillRect((i * w) / 3, 0, w / 3, h);
          else g.fillRect(0, (i * h) / 3, w, h / 3);
        });
        return c.toDataURL().split(",")[1];
      },
      [width, height],
    );
    await page.locator("#photoFile").setInputFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: Buffer.from(data, "base64"),
    });
    await page.waitForFunction(
      () =>
        !document.querySelector("#pickPhoto").disabled &&
        document.querySelector("#editAvatar").src.startsWith("data:"),
    );
  }
  async function color(index) {
    await page.locator("#editAvatar").evaluate(async (img, index) => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, 1, 1);
      const pixel = g.getImageData(0, 0, 1, 1).data;
      if (pixel[index] < 240) throw Error("Unexpected crop " + pixel);
    }, index);
  }
  const focus = page.getByLabel("Photo framing");
  await photo(300, 100);
  await color(1);
  await focus.selectOption("Left");
  await color(0);
  await focus.selectOption("Right");
  await color(2);
  await page.getByRole("button", { name: "Undo photo change" }).click();
  assert.match(
    await page.locator("#editAvatar").getAttribute("src"),
    /avatar\/me$/,
  );
  assert.equal(await focus.isVisible(), false);
  await photo(100, 300);
  await focus.selectOption("Top");
  await color(0);
  await focus.selectOption("Bottom");
  await color(2);
  const chosen = await page.locator("#editAvatar").getAttribute("src");
  await page.locator("#editBio").fill("Unsaved draft");
  await page.locator("#editPrivate").uncheck();
  await page.locator("#editSave").click();
  const consent = page.getByRole("dialog", {
    name: "Make your account public?",
  });
  await consent.waitFor();
  assert.equal(changes.length, 0);
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.querySelector("#editPrivate").checked,
  );
  assert.equal(await page.locator("#editBio").inputValue(), "Unsaved draft");
  assert.equal(await page.locator("#editAvatar").getAttribute("src"), chosen);
  await page.locator("#editPrivate").uncheck();
  await page.locator("#editSave").click();
  await consent
    .getByRole("button", { name: "Make public", exact: true })
    .click();
  await page.waitForURL(base + "/profile");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].photo, chosen.split(",")[1]);
  assert.equal(priv, false);
  await page.goto(base + "/profile?utm_campaign=test#fragment");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async ({ url }) => {
        window.shared = url;
      },
    }),
  );
  await page.locator("#shareProfile").click();
  const clean = base + "/profile/3";
  assert.equal(await page.locator("#shareUrl").inputValue(), clean);
  await page.getByRole("button", { name: "Share via device" }).click();
  assert.equal(await page.evaluate(() => window.shared), clean);
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await page.locator("#copyLink").click();
  await page.getByText("Link copied.", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    clean,
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
      },
    }),
  );
  await page.locator("#copyLink").click();
  await page.getByText("Copy the selected link.").waitFor();
  assert.equal(
    await page
      .locator("#shareUrl")
      .evaluate((e) => e.value.slice(e.selectionStart, e.selectionEnd)),
    clean,
  );
  await page.goto(base + "/settings/privacy");
  await page.getByRole("button", { name: "Private", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".segments [aria-pressed=true]").textContent ===
      "Private",
  );
  assert.equal(priv, true);
  const pub = page.getByRole("button", { name: "Public", exact: true });
  await pub.click();
  await consent.getByRole("button", { name: "Keep account private" }).click();
  assert.equal(changes.length, 2);
  await pub.click();
  await consent
    .getByRole("button", { name: "Make public", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".segments [aria-pressed=true]").textContent ===
      "Public",
  );
  assert.equal(changes.length, 3);
  assert.equal(priv, false);
  const downloadButton = page.getByRole("button", {
    name: "Download settings",
    exact: true,
  });
  currentTheme = "dark";
  let downloads = 0;
  page.on("download", () => downloads++);
  const started = page.waitForEvent("download");
  await downloadButton.click();
  const file = await started;
  assert.equal(file.suggestedFilename(), "afterlink-settings.json");
  const snapshot = JSON.parse(await readFile(await file.path(), "utf8"));
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "appearance",
    "exportedAt",
    "format",
    "notifications",
    "privacy",
    "version",
  ]);
  assert.deepEqual(snapshot.appearance, { theme: "dark" });
  assert.deepEqual(snapshot.privacy, {
    privateAccount: false,
    messages: "followers",
  });
  assert.deepEqual(snapshot.notifications, { mention: true, like: false });
  memberId = 4;
  await downloadButton.click();
  await page.getByText(/signed-in account changed/).waitFor();
  assert.equal(downloads, 1);
  // No app-server or real credentials involved: simulate expiry on the fresh request.
  memberId = null;
  await page.route("**/?auth=session*", (r) =>
    r.fulfill({ contentType: "text/html", body: "Sign in again" }),
  );
  await downloadButton.click();
  await page.getByText("Sign in again").waitFor();
  assert.equal(downloads, 1);
  assert.deepEqual(errors, []);
  console.log(
    "Profile UI passed: landscape and portrait crop pixels, undo, preserved edits, exact preview submitted, audience review, canonical device/clipboard sharing and fallback, fresh settings download and rejection after account switch or expiry.",
  );
} finally {
  await browser?.close();
  server.close();
}
