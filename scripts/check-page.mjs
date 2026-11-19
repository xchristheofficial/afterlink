// Run with npm run test:ui after installing Playwright Chromium. Never uses the live DB.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const dir = await mkdtemp(join(tmpdir(), "afterlink-ui-"));
const server = spawn(process.execPath, ["server.mjs"], {
  env: {
    ...process.env,
    PORT: "0",
    NODE_ENV: "test",
    DB_FILE: join(dir, "ui.sqlite"),
    GOOGLE_CLIENT_ID: "",
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#forgot");
  await page.getByRole("dialog", { name: "Forgot password?" }).waitFor();
  await page.keyboard.press("Escape");
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
  await page.reload();
  await page.locator("#account").waitFor();
  assert.equal(await page.innerText("#accountEmail"), email);
  await page.click("#logout");
  await page.fill("#email", email);
  await page.fill("#password", "incorrect");
  await page.click("#submit");
  await page.locator("#error").waitFor();
  await page.fill("#password", password);
  await page.click("#submit");
  await page.locator("#account").waitFor();
  await page.click("#logout");
  await page.locator("#form").waitFor();
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
