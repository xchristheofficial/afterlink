// Run with npm run test:ui after installing Playwright Chromium. Never uses the live DB.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const dir = await mkdtemp(join(tmpdir(), "afterlink-ui-"));
const server = spawn(process.execPath, ["server.mjs"], {
  env: {
    ...process.env,
    PORT: "0",
    NODE_ENV: "test",
    DB_FILE: join(dir, "ui.sqlite"),
    GOOGLE_CLIENT_ID: "",
    RESEND_API_KEY: "",
  },
  stdio: ["ignore", "pipe", "inherit"],
});
let browser;
try {
  const [line] = await once(server.stdout, "data");
  const url = `http://127.0.0.1:${line.toString().match(/on (\d+)/)[1]}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const page = await browser.newPage({ baseURL: url });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(url + "/home");
  await page.getByText(/Sign in to open your Home Feed/).waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  for (const [width, height] of [
    [1568, 730],
    [1440, 900],
    [1024, 768],
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    const bounds = await page.locator(".layout").boundingBox();
    if (width > 760) {
      const image = page.locator(".art img");
      const box = await image.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= height);
      assert.equal(
        await image.evaluate((el) => getComputedStyle(el).objectFit),
        "contain",
      );
    }
    assert.equal(bounds.x, 0);
    assert.equal(bounds.y, 0);
    assert.equal(bounds.width, width);
    assert.ok(bounds.height >= height);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth === innerWidth,
      ),
    );
  }
  await page.setViewportSize({ width: 1568, height: 784 });
  const art = page.locator(".art img");
  await art.evaluate((img) => img.decode());
  const original = await art.elementHandle();
  const rect = await art.boundingBox();
  const imageRequests = () =>
    page.evaluate(
      () =>
        performance
          .getEntriesByType("resource")
          .filter((e) => e.name.endsWith("/auth-illustration.webp")).length,
    );
  const initialRequests = await imageRequests();
  for (const label of [
    "Create Account",
    "Sign In",
    "Create Account",
    "Sign In",
  ]) {
    await page.fill("#password", "discarded");
    await page.click("#reveal");
    assert.equal(await page.getAttribute("#password", "type"), "text");
    await page.click("#switchMode");
    assert.equal(await page.innerText("#heading"), label);
    assert.equal(await page.getAttribute("#password", "type"), "password");
    assert.equal(await page.inputValue("#password"), "");
    assert.ok(
      await original.evaluate(
        (el) => el === document.querySelector(".art img"),
      ),
    );
    assert.deepEqual(await art.boundingBox(), rect);
    assert.equal(await imageRequests(), initialRequests);
  }
  await page.click("#forgot");
  await page.getByRole("heading", { name: "Forgot Password?" }).waitFor();
  assert.deepEqual(await art.boundingBox(), rect);
  assert.equal(await imageRequests(), initialRequests);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.fill("#recoveryEmail", "owner@example.test");
  await page.click("#sendReset");
  await page.getByText(/No link was sent/).waitFor();
  await page.click("#resend");
  await page.getByText(/No link was sent/).waitFor();
  await page.locator(".recovery-links .back").click();
  assert.equal(await page.inputValue("#email"), "owner@example.test");
  await page.click("#google");
  await page.getByRole("dialog", { name: "Google sign-in" }).waitFor();
  await page.keyboard.press("Escape");
  const icon = await page.request.get(
    await page.locator("link[rel=icon]").getAttribute("href"),
  );
  assert.ok(icon.ok());
  assert.match(icon.headers()["content-type"], /svg/);
  const email = `${randomUUID()}@example.test`,
    password = randomUUID();
  await page.click("#switchMode");
  await page.fill("#fullName", "UI test");
  await page.fill("#username", "ui_test");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("#submit");
  await page.locator("#account").waitFor();
  assert.equal(new URL(page.url()).pathname, "/home");
  await page.reload();
  await page.locator("#account").waitFor();
  assert.equal(new URL(page.url()).pathname, "/home");
  assert.equal(await page.innerText("#accountEmail"), email);
  await page.locator("#emptyFeed").waitFor();
  assert.equal(await page.innerText("#profileName"), "RADAR");
  assert.equal(await page.innerText("#profileHandle"), "@ui_test");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth === innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1568, height: 1045 });
  if (process.env.FEED_SCREENSHOT)
    await page.screenshot({ path: process.env.FEED_SCREENSHOT });
  await page.click("#openComposer");
  await page.fill("#postText", "My first real post.");
  await page.click("#publishPost");
  await page.locator("#feedRows").getByText("My first real post.").waitFor();
  await page.getByRole("button", { name: "Save post", exact: true }).click();
  await page.getByRole("button", { name: "Unsave", exact: true }).waitFor();
  await page.locator('.side-nav [data-view="Saved"]').click();
  await page.locator("#feedRows").getByText("My first real post.").waitFor();
  await page.getByRole("link", { name: "AfterLink home" }).click();
  await page.locator("#feedPanel").waitFor();
  await page.locator("#feedRows").getByText("My first real post.").waitFor();
  // Another authenticated user in the same isolated test database must not inherit RADAR.
  const second = await browser.newContext({ baseURL: url });
  const headers = { "X-AfterLink-Request": "1" };
  assert.equal((await second.request.get("/api/feed")).status(), 401);
  await second.request.post("/api/signup", {
    headers,
    data: {
      fullName: "Second Member",
      username: "second_member",
      email: `${randomUUID()}@example.test`,
      password: randomUUID(),
    },
  });
  const secondFeed = async () => (await second.request.get("/api/feed")).json();
  const initial = await secondFeed();
  assert.equal(initial.profile.name, "Second Member");
  assert.equal(initial.profile.founder, 0);
  assert.deepEqual(initial.posts, []);
  const { people } = await (
    await second.request.get("/api/feed/people?q=radar")
  ).json();
  assert.equal(people.length, 1);
  assert.ok(!("email" in people[0]));
  await second.request.post("/api/feed/follow", {
    headers,
    data: { id: people[0].id, on: true },
  });
  assert.equal((await secondFeed()).posts[0].body, "My first real post.");
  assert.equal((await secondFeed()).profile.following, 1);
  await second.close();
  await page.click("#logout");
  await page.fill("#email", email);
  await page.fill("#password", "incorrect");
  await page.click("#submit");
  await page.locator("#error").waitFor();
  await page.fill("#password", password);
  await page.click("#submit");
  await page.locator("#account").waitFor();
  assert.equal(new URL(page.url()).pathname, "/home");
  await page.click("#logout");
  await page.locator("#form").waitFor();
  // Exercise the real reset route with a token issued only in the test database.
  const token = randomBytes(32).toString("hex");
  const db = new DatabaseSync(join(dir, "ui.sqlite"));
  try {
    db.prepare(
      "INSERT INTO password_resets(user_id,digest,issued,expires) SELECT id,?,?,? FROM users WHERE email=?",
    ).run(
      createHash("sha256").update(token).digest("hex"),
      Date.now(),
      Date.now() + 60000,
      email,
    );
  } finally {
    db.close();
  }
  await page.goto("about:blank");
  await page.goto(`${url}/#reset=${token}`);
  await page.getByRole("heading", { name: "Reset Password" }).waitFor();
  assert.equal(await page.innerText("#strengthText"), "Not entered");
  const replacement = "A1" + randomUUID();
  await page.fill("#newPassword", replacement);
  assert.equal(await page.innerText("#strengthText"), "Strong");
  assert.equal(
    await page.locator("#passwordRules li[data-met=true]").count(),
    3,
  );
  await page
    .getByRole("button", { name: "Show new password", exact: true })
    .click();
  assert.equal(await page.getAttribute("#newPassword", "type"), "text");
  assert.equal(await page.getAttribute("#confirmPassword", "type"), "password");
  await page.fill("#confirmPassword", replacement + "x");
  await page.click("#sendReset");
  assert.ok(await page.locator("#confirmPassword:invalid").count());
  await page.fill("#confirmPassword", replacement);
  await page.click("#sendReset");
  await page.getByRole("dialog", { name: "Password updated" }).waitFor();
  await page.keyboard.press("Escape");
  await page.fill("#email", email);
  await page.fill("#password", replacement);
  await page.click("#submit");
  await page.locator("#account").waitFor();
  assert.equal(new URL(page.url()).pathname, "/home");
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: stationary artwork, form switching, responsive bounds, favicon, Google fallback, validation and account lifecycle.",
  );
} finally {
  await browser?.close();
  if (server.exitCode === null && !server.signalCode) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  await rm(dir, { force: true, recursive: true });
}
