import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { installRecovery } from "../recovery.mjs";

test("recovery requests, resend, expiration, single use and session revocation", async (t) => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,hash TEXT);CREATE TABLE sessions(user_id INTEGER);INSERT INTO users VALUES(1,'owner@example.test','old'),(2,'oauth@example.test',NULL); INSERT INTO sessions VALUES(1),(1),(2)`,
  );
  const outbox = [];
  const app = express();
  app.use(express.json());
  installRecovery(
    app,
    db,
    (_req, _res, next) => next(),
    async (email, token) => outbox.push({ email, token }),
    async (pass) => "test-hash:" + pass,
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
  });
  const post = (path, data) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  const request = (email) => post("forgot-password", { email });
  const change = (token, password = "New long password 1") =>
    post("reset-password", { token, password });
  for (const email of [
    "absent@example.test",
    "oauth@example.test",
    "Owner@example.test",
    "owner@example.test",
  ]) {
    const r = await request(email);
    assert.equal(r.status, 202);
    assert.deepEqual(await r.json(), { ok: true });
  }
  assert.equal(outbox.length, 1);
  const first = outbox[0].token;
  assert.equal(outbox[0].email, "owner@example.test");
  assert.equal(
    db.prepare("SELECT digest FROM password_resets").get().digest,
    createHash("sha256").update(first).digest("hex"),
  );
  db.exec("UPDATE password_resets SET issued=0");
  await request("owner@example.test");
  assert.equal((await change(first)).status, 400);
  const second = outbox[1].token;
  db.exec("UPDATE password_resets SET expires=0");
  assert.equal((await change(second)).status, 400);
  await request("owner@example.test");
  const third = outbox[2].token;
  assert.equal((await change(third, "short")).status, 400);
  for (const invalid of ["lowercase only 12", "Uppercase only without digits"])
    assert.equal((await change(third, invalid)).status, 400);
  assert.equal((await change(third)).status, 200);
  assert.equal((await change(third)).status, 400);
  assert.equal(
    db.prepare("SELECT hash FROM users WHERE id=1").get().hash,
    "test-hash:New long password 1",
  );
  assert.deepEqual(
    db
      .prepare("SELECT user_id FROM sessions")
      .all()
      .map((r) => r.user_id),
    [2],
  );
});
