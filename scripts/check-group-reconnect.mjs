// Real Chromium EventSource + HTTP, with disposable in-memory data only.
import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import express from "express";
import { chromium } from "playwright";
const app = express(),
  peers = new Map();
function fixture(name) {
  const p = { title: name, reads: 0, active: 0, peak: 0, connections: 0 };
  peers.set(name, p);
  return p;
}
const alice = fixture("Alice"),
  bob = fixture("Bob");
app.use((req, res, next) => {
  res.locals.p = peers.get(req.get("x-test-member"));
  next();
});
app.get("/groups", (_, res) => res.sendFile(resolve("public/social.html")));
app.get("/api/feed/settings", (_, res) => res.json({ prefs: {} }));
app.get("/api/feed/unread", (_, res) => res.json({}));
app.get("/api/feed/linkbacks", (_, res) => {
  const p = res.locals.p,
    snapshot = p.title;
  p.reads++;
  p.active++;
  p.peak = Math.max(p.peak, p.active);
  const reply = () => {
    p.active--;
    res.json({
      groups: snapshot ? [{ id: 10, groupName: snapshot, count: 2 }] : [],
    });
  };
  if (p.hold) {
    p.hold = false;
    p.release = reply;
  } else reply();
});
app.get("/api/feed/live", (_, res) => {
  const p = res.locals.p;
  p.connections++;
  p.stream = res;
  res.on("close", () => {
    if (p.stream === res) p.stream = null;
  });
  const open = () => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
    });
    res.flushHeaders();
    res.write("retry: 100\n: ready\n\n");
  };
  if (p.holdReconnect) {
    p.resume = open;
    p.holdReconnect = false;
  } else open();
});
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
let browser;
try {
  await once(server, "listening");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  async function tab(name) {
    const page = await browser.newPage({
      extraHTTPHeaders: { "x-test-member": name },
    });
    // Drive the fallback tick explicitly: a timer must not mask a lost wake-up.
    await page.addInitScript(() => {
      const interval = window.setInterval;
      window.setInterval = (fn, ms, ...args) =>
        ms === 4500
          ? ((window.fallbackTick = fn), 0)
          : interval(fn, ms, ...args);
      const Native = window.EventSource;
      window.EventSource = class extends Native {
        constructor(url) {
          super(url);
          this.addEventListener("barrier", (e) => {
            window.barrier = e.data;
          });
        }
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/groups`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByText(name, { exact: true }).waitFor();
    return page;
  }
  const [a, b] = await Promise.all([tab("Alice"), tab("Bob")]);
  async function until(fn) {
    const deadline = Date.now() + 5000;
    while (!fn()) {
      if (Date.now() > deadline) throw Error("Timed out waiting for fixture");
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  await until(() => alice.reads === 2 && bob.reads === 2);
  await a.waitForFunction(() => !!window.fallbackTick);
  alice.hold = true;
  alice.stream.write("event: group\ndata: {}\n\n");
  await until(() => alice.release);
  alice.title = "Fresh group";
  for (let i = 0; i < 8; i++) alice.stream.write("event: group\ndata: {}\n\n");
  alice.stream.write("event: barrier\ndata: received\n\n");
  await a.waitForFunction(() => window.barrier === "received");
  await a.evaluate(() => {
    for (let i = 0; i < 8; i++) window.fallbackTick();
  });
  assert.equal(alice.reads, 3);
  alice.release();
  await a.getByText("Fresh group", { exact: true }).waitFor();
  assert.equal(alice.reads, 4);
  assert.equal(alice.peak, 1);
  assert.equal(bob.reads, 2);
  // Change the authorized snapshot during a real stream interruption. The
  // browser reconnects on its own. Do not send an event on the new stream.
  alice.holdReconnect = true;
  alice.stream.end();
  await a.getByText("Reconnecting live updates…", { exact: true }).waitFor();
  await until(() => alice.resume);
  alice.title = "From fallback poll";
  await a.evaluate(() => window.fallbackTick());
  await a.getByText("From fallback poll", { exact: true }).waitFor();
  await a.getByText("Reconnecting live updates…", { exact: true }).waitFor();
  alice.title = null;
  alice.hold = true;
  alice.release = null;
  alice.resume();
  await a.getByText("Catching up on group updates…", { exact: true }).waitFor();
  await until(() => alice.release);
  alice.release();
  await a.getByText("Create a group or wait for an invitation.").waitFor();
  assert.equal(await a.locator(".lb-card").count(), 0);
  await a.locator(".lb-live-status").waitFor({ state: "hidden" });
  assert.equal(alice.connections, 2);
  assert.equal(alice.reads, 6);
  assert.equal(bob.connections, 1);
  assert.equal(await b.locator(".lb-card strong").innerText(), "Bob");
  console.log(
    "Group live checks passed: serialized burst recovery, real EventSource reconnect, permission-filtered catch-up, and independent member views.",
  );
} finally {
  await browser?.close();
  for (const p of peers.values()) p.stream?.end();
  server.close();
}
