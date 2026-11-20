// Browser-only rehearsal. No application server, database, or Google credentials.
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { chromium } from "playwright";

const app = express();
app.get("/api/session", (_req, res) => res.json({ user: null }));
let release,
  notify,
  checks = 0,
  handoffs = 0;
app.get("/api/providers", (_req, res) => {
  checks++;
  release = (status, google) => res.status(status).json({ google });
  notify();
});
app.get("/auth/google", (_req, res) => {
  handoffs++;
  res.redirect("/?auth=cancelled");
});
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
let browser;
try {
  await once(server, "listening");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const page = await browser.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  await page.click("#switchMode");
  const google = page.locator("#google");
  for (const [status, available] of [
    [503, false],
    [200, false],
    [200, true],
  ]) {
    const previous = checks;
    // Wait for the mock server to actually receive the request before releasing it.
    const received = new Promise((resolve) => {
      notify = resolve;
    });
    await google.click();
    await received;
    assert.equal(await google.isDisabled(), true);
    assert.match(await google.innerText(), /Connecting/);
    await google.evaluate((el) => el.click());
    assert.equal(checks, previous + 1);
    release(status, available);
    if (!available) {
      await page
        .getByRole("dialog", {
          name: status === 503 ? "Connection issue" : "Google sign-in",
        })
        .waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await google.isEnabled(), true);
    }
  }
  await page.getByText(/Google sign-in was cancelled/).waitFor();
  assert.equal(await page.locator("#heading").innerText(), "Create Account");
  assert.equal(handoffs, 1);
  assert.equal(checks, 3);
  await page.goto(base + "/?auth=restart");
  await page.getByText(/expired or was replaced/).waitFor();
  assert.equal(await google.isEnabled(), true);
  console.log(
    "Google UI checks passed: pending, single handoff, retry, cancellation, signup return, and expired attempt.",
  );
} finally {
  await browser?.close();
  server.close();
}
