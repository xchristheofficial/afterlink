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
      assert.equal(await image.evaluate(el => getComputedStyle(el).objectFit), "contain");
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
  await page.setViewportSize({ width: 390, height: 844 });
  for (const button of await page.locator("footer button").all()) {
    await button.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(
      await dialog.locator("h2").innerText(),
      await button.getAttribute("data-info"),
    );
    await dialog.getByRole("button", { name: "Close" }).click();
  }
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
  await page.click("#signup");
  await page.click("#submit");
  assert.ok(await page.locator("#email:invalid").count());
  await page.fill("#email", email);
  await page.fill("#phone", "abc");
  await page.click("#submit");
  await page.locator("#error").waitFor();
  await page.fill("#phone", "");
  await page.click("#submit");
  for (const [mode, other, finalLabel, autocomplete] of [
    ["signin", "signup", "Sign In", "current-password"],
    ["signup", "signin", "Create Account", "new-password"],
  ]) {
    await page.fill("#password", password);
    await page.click(`#${mode}`);
    assert.equal(await page.getAttribute(`#${mode}`, "aria-pressed"), "true");
    assert.equal(await page.getAttribute(`#${other}`, "aria-pressed"), "false");
    assert.equal(await page.inputValue("#password"), "");
    assert.equal(await page.inputValue("#email"), email);
    assert.equal(await page.innerText("#submit"), `Continue to ${finalLabel.toLowerCase()}`);
    await page.click("#submit");
    assert.equal(await page.innerText("#submit"), finalLabel);
    assert.equal(await page.getAttribute("#password", "autocomplete"), autocomplete);
  }
  await page.click("#back");
  assert.equal(await page.inputValue("#email"), email);
  await page.click("#submit");
  await page.fill("#password", password);
  await page.click("#submit");
  await page.locator("#account").waitFor();
  await page.reload();
  await page.locator("#account").waitFor();
  assert.equal(await page.innerText("#accountEmail"), email);
  await page.click("#logout");
  await page.click("#signin");
  await page.fill("#email", email);
  await page.click("#submit");
  await page.fill("#password", "incorrect");
  await page.click("#submit");
  await page.locator("#error").waitFor();
  await page.fill("#password", password);
  await page.click("#submit");
  await page.locator("#account").waitFor();
  await page.click("#logout");
  await page.locator("#identity").waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: responsive bounds, favicon, footer, Google fallback, validation and account lifecycle.",
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
