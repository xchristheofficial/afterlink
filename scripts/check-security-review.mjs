// Exercise the production settings page. All account actions are captured in
// memory by this fixture; no real password or account is changed.
import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import express from "express";
import { chromium } from "playwright";
const app = express(),
  changes = [],
  deletions = [];
app.use(express.json());
app.get("/settings/security", (_, r) =>
  r.sendFile(resolve("public/social.html")),
);
app.get("/api/feed/security", (_, r) =>
  r.json({
    user: { password: true, email: "member@example.test" },
    devices: [],
  }),
);
app.get("/api/feed/settings", (_, r) => r.json({ prefs: {} }));
app.get("/api/feed/unread", (_, r) => r.json({}));
app.post("/api/feed/security/password", (q, r) => {
  changes.push(q.body);
  if (q.body.current !== "correct")
    return r.status(403).json({ error: "Current password did not match." });
  r.json({ ok: true });
});
app.post("/api/feed/delete-account", (q, r) => {
  deletions.push(q.body);
  r.json({ ok: true });
});
app.get("/", (_, r) => r.send("Signed out fixture"));
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
  await page.goto(base + "/settings/security");
  const btn = (name) => page.getByRole("button", { name, exact: true }),
    field = (name) => page.getByLabel(name, { exact: true });
  async function invalid(el, text) {
    await page.getByText(text, { exact: true }).waitFor();
    assert.deepEqual(
      await el.evaluate((e) => [
        e === document.activeElement,
        e.getAttribute("aria-invalid"),
        document.getElementById(e.getAttribute("aria-describedby"))
          ?.textContent,
      ]),
      [true, "true", text],
    );
  }
  await btn("Change").click();
  const current = field("Current password"),
    next = field("New password (12–128 characters)");
  await btn("Save password").click();
  await invalid(current, "Enter your current password.");
  await current.fill("wrong");
  assert.equal(await current.getAttribute("aria-invalid"), null);
  await btn("Save password").click();
  await invalid(next, "Use 12–128 characters for your new password.");
  assert.equal(changes.length, 0);
  await next.fill("fixture-password");
  await btn("Save password").click();
  await invalid(current, "Current password did not match.");
  assert.equal(await next.inputValue(), "fixture-password");
  await current.fill("correct");
  await btn("Save password").click();
  await btn("Delete Account").waitFor();
  assert.equal(changes.length, 2);
  await btn("Delete Account").click();
  await page.getByText(/earliest-joined remaining member/).waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "Review my groups" })
      .getAttribute("href"),
    "/groups",
  );
  assert.equal(await btn("Delete permanently").count(), 0);
  await btn("Keep my account").click();
  await btn("Delete Account").click();
  await btn("Continue to confirmation").click();
  const code = field("Type DELETE to confirm");
  await code.fill("delete");
  await btn("Delete permanently").click();
  await invalid(code, "Enter DELETE exactly, in uppercase.");
  await btn("Keep my account").click();
  assert.equal(deletions.length, 0);
  await btn("Delete Account").click();
  await btn("Continue to confirmation").click();
  assert.equal(await code.inputValue(), "");
  await code.fill("DELETE");
  await btn("Delete permanently").click();
  await page.waitForURL(base + "/");
  assert.deepEqual(deletions, [{ confirmation: "DELETE" }]);
  console.log(
    "Security review passed: explicit group impact, cancellation, exact typed confirmation, inline field relationships, password mismatch and correction.",
  );
} finally {
  await browser?.close();
  server.close();
}
