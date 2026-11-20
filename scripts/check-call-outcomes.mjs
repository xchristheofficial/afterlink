// Two real call controllers with the production in-memory signaling handlers.
// Identities/permissions and the ringing clock are fixture inputs; no SQLite.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mock } from "node:test";
import express from "express";
import { chromium } from "playwright";
import { installCalls } from "../calls.mjs";
const app = express(),
  actions = [];
let allowed = true,
  offset = 0;
const realNow = Date.now.bind(Date);
mock.method(Date, "now", () => realNow() + offset);
app.use(express.json());
installCalls({
  endpoint(method, path, fn) {
    app[method]("/api/feed/" + path, (req, res) => {
      try {
        const uid = Number(req.get("x-member"));
        const result = fn(uid, req.query, req.body || {});
        if (method === "post") actions.push({ uid, ...req.body, ...result });
        res.json(result || {});
      } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
      }
    });
  },
  id: Number,
  fail(message, status) {
    throw Object.assign(Error(message), { status });
  },
  person: (id) => ({ id, name: "Member " + id }),
  nickname: () => "",
  allowedDM: () => allowed,
  wake: () => {},
});
app.get("/fixture", (_, r) =>
  r
    .type("html")
    .send(
      `<!doctype html><body class="social"><p id="alert"></p><script type="module">import {callControls} from '/calls.js';document.body.append(callControls()({id:7,name:'Other member'}));</script>`,
    ),
);
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
  const base = `http://127.0.0.1:${server.address().port}`;
  async function tab(uid) {
    const page = await browser.newPage({
      permissions: ["microphone"],
      extraHTTPHeaders: { "x-member": String(uid) },
    });
    await page.goto(base + "/fixture");
    return page;
  }
  const [caller, guest] = await Promise.all([tab(1), tab(7)]),
    btn = (p, name) => p.getByRole("button", { name, exact: true }),
    wake = (p) => p.evaluate(() => dispatchEvent(new Event("dm-call"))),
    start = async () => {
      await btn(caller, "Start audio call").click();
      await btn(caller, "Minimize").waitFor();
      return actions.findLast((a) => a.action === "start").id;
    };
  async function status(uid, id) {
    const r = await fetch(
      base + "/api/feed/calls" + (id ? "?live=" + id : ""),
      { headers: { "x-member": String(uid) } },
    );
    return r.json();
  }
  const first = await start();
  await wake(guest);
  await btn(guest, "Decline").click();
  await wake(caller);
  await caller.getByText("Call declined.", { exact: true }).waitFor();
  assert.equal(actions.findLast((a) => a.action === "decline").uid, 7);
  assert.deepEqual(await status(1), { call: null });
  assert.deepEqual(await status(7, first), { call: null });
  assert.deepEqual(await status(3, first), { call: null });
  assert.deepEqual(await status(1, "wrong"), { call: null });
  allowed = false;
  assert.deepEqual(await status(1, first), { call: null });
  allowed = true;
  const second = await start();
  const impostor = await fetch(base + "/api/feed/calls", {
    method: "POST",
    headers: { "x-member": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "decline", id: second }),
  });
  assert.equal(impostor.status, 409);
  offset += 45001;
  await wake(caller);
  await caller.getByText("No answer.", { exact: true }).waitFor();
  assert.deepEqual(await status(1, second), {
    call: null,
    outcome: "unanswered",
  });
  offset += 60001;
  assert.deepEqual(await status(1, second), { call: null });
  const third = await start();
  await btn(caller, "End call").click();
  assert.deepEqual(await status(1, third), { call: null });
  assert.equal(actions.filter((a) => a.action === "start").length, 3);
  console.log(
    "Confirmed explicit decline and unanswered UI in Chromium, scoped/expiring outcomes, and ordinary hang-up without a decline.",
  );
} finally {
  await browser?.close();
  server.close();
  mock.restoreAll();
}
