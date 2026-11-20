// Intentionally no application server or database in this suite.
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { get } from "node:http";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";
import express from "express";
import { memberAssets, publicAssets } from "../web-assets.mjs";

const html = await readFile("public/index.html", "utf8");
const scripts = (source) =>
  [...source.matchAll(/<script[^>]* src="\/(.*?)\.js"/g)].map((m) => m[1]);
test("sign-in skips eight member assets; authenticated routes keep their prerequisites", () => {
  assert.deepEqual(scripts(html), ["app", "appearance"]);
  for (const css of ["notes", "editor", "composer"])
    assert.ok(!html.includes(`href="/${css}.css"`));
  for (const [path, extra] of [
    ["/home", []],
    ["/create", []],
    ["/profile/2", ["profile"]],
    ["/profile/edit/", ["editor", "profile"]],
  ]) {
    const shell = memberAssets(html, path);
    assert.deepEqual(scripts(shell), [
      "navigation",
      "composer",
      ...extra,
      "feed",
      "app",
      "appearance",
    ]);
    for (const css of ["notes", "editor", "composer"])
      assert.ok(shell.includes(`href="/${css}.css"`));
  }
});

test("public assets negotiate smaller wire bodies with byte-identical fallback", async (t) => {
  const app = express();
  app.use(publicAssets("public"));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, "listening");
  const load = (path, encoding, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = get(
        `http://127.0.0.1:${server.address().port}${path}`,
        { headers: { "Accept-Encoding": encoding, ...headers } },
        async (res) => {
          try {
            const chunks = [];
            for await (const chunk of res) chunks.push(chunk);
            resolve({
              data: Buffer.concat(chunks),
              headers: res.headers,
              status: res.statusCode,
            });
          } catch (e) {
            reject(e);
          }
        },
      );
      req.on("error", reject);
    });
  for (const path of ["/", "/app.js", "/social.css", "/assets/emoji.json"]) {
    const plain = await load(path, "identity");
    assert.equal(plain.status, 200);
    for (const [encoding, decode] of [
      ["br", brotliDecompressSync],
      ["gzip", gunzipSync],
    ]) {
      const r = await load(path, encoding);
      assert.equal(r.headers["content-encoding"], encoding);
      assert.match(r.headers.vary, /Accept-Encoding/i);
      assert.deepEqual(decode(r.data), plain.data);
      assert.ok(r.data.length < plain.data.length * 0.5);
      if (encoding === "br")
        t.diagnostic(
          `${path}: ${plain.data.length} → ${r.data.length} bytes (Brotli)`,
        );
    }
    const notModified = await load(path, "br", {
      "If-None-Match": plain.headers.etag,
    });
    assert.equal(notModified.status, 304);
  }
  const partial = await load("/app.js", "br", { Range: "bytes=0-99" });
  assert.equal(partial.status, 206);
  assert.equal(partial.data.length, 100);
  assert.equal(partial.headers["content-encoding"], undefined);
  assert.equal(
    (await load("/assets/auth-illustration.webp", "br")).headers[
      "content-encoding"
    ],
    undefined,
  );
});

test("slow unread requests coalesce change events, ignore overlapping poll ticks, and stop when hidden", async () => {
  const listeners = {},
    pending = [];
  let timer;
  const document = {
    hidden: false,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (name, cb) => (listeners[name] = cb),
  };
  runInNewContext(await readFile("public/navigation.js", "utf8"), {
    document,
    location: { pathname: "/home" },
    addEventListener: document.addEventListener,
    setInterval: (cb) => (timer = cb),
    fetch: () => new Promise((resolve) => pending.push(resolve)),
  });
  const response = { ok: true, json: async () => ({}) };
  const first = listeners.pageshow({});
  for (let i = 0; i < 10; i++) {
    timer();
    listeners["unread-change"]({});
  }
  assert.equal(pending.length, 1);
  pending.shift()(response);
  await first;
  assert.equal(pending.length, 1);
  timer();
  pending.shift()(response);
  await new Promise(setImmediate);
  assert.equal(pending.length, 0);
  const next = timer();
  listeners["unread-change"]({});
  document.hidden = true;
  pending.shift()({ ok: false });
  await next;
  assert.equal(pending.length, 0);
  document.hidden = false;
  const resumed = listeners.visibilitychange({});
  assert.equal(pending.length, 1);
  pending.shift()(response);
  await resumed;
});
