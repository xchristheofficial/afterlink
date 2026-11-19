import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test(
  "real account lifecycle in an isolated temporary database",
  { timeout: 20000 },
  async (t) => {
    const temp = await mkdtemp(join(tmpdir(), "afterlink-test-"));
    let server, url;
    async function start(config = {}) {
      server = spawn(process.execPath, ["server.mjs"], {
        env: {
          ...process.env,
          PORT: "0",
          DB_FILE: join(temp, "test.sqlite"),
          GOOGLE_CLIENT_ID: "",
          ...config,
        },
        stdio: ["ignore", "pipe", "inherit"],
      });
      const [line] = await once(server.stdout, "data");
      url = "http://127.0.0.1:" + line.toString().match(/on (\d+)/)[1];
    }
    async function stop() {
      if (server?.exitCode === null && !server.signalCode) {
        const stopped = once(server, "exit");
        server.kill();
        await stopped;
      }
    }
    t.after(async () => {
      await stop();
      await rm(temp, { recursive: true, force: true });
    });
    await start();
    const payload = {
      fullName: "Account lifecycle test",
      username: "lifecycle_test",
      email: `${randomUUID()}@example.test`,
      phone: "+1 (555) 010-1234",
      password: randomUUID(),
    };
    const post = (path, data, cookie = "") =>
      fetch(url + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AfterLink-Request": "1",
          cookie,
        },
        body: JSON.stringify(data),
      });
    const current = async (cookie = "") =>
      (
        await (
          await fetch(url + "/api/session", { headers: { cookie } })
        ).json()
      ).user;
    assert.equal(await current(), null);
    assert.equal(
      (await post("/api/signup", { ...payload, password: "tiny" })).status,
      400,
    );
    assert.equal(
      (
        await fetch(url + "/api/signup", {
          method: "POST",
          body: new URLSearchParams(payload),
        })
      ).status,
      403,
    );
    for (const invalid of [{ fullName: " " }, { username: "x" }])
      assert.equal(
        (await post("/api/signup", { ...payload, ...invalid })).status,
        400,
      );
    const signup = await post("/api/signup", payload);
    assert.equal(signup.status, 201);
    const c = signup.headers.get("set-cookie");
    assert.match(c, /HttpOnly/);
    const cookie = c.split(";")[0];
    assert.deepEqual(await current(cookie), { email: payload.email });
    assert.equal((await post("/api/signup", payload)).status, 409);
    assert.equal(
      (
        await post("/api/signup", {
          ...payload,
          email: "other@example.test",
          username: payload.username.toUpperCase(),
        })
      ).status,
      409,
    );
    await stop();
    await start();
    assert.deepEqual(await current(cookie), { email: payload.email });
    assert.equal((await post("/api/logout", {}, cookie)).status, 200);
    assert.equal(await current(cookie), null);
    assert.equal(
      (await post("/api/signin", { ...payload, password: randomUUID() }))
        .status,
      401,
    );
    assert.equal(
      (await post("/api/signin", { ...payload, phone: "+12345678901" })).status,
      401,
    );
    assert.equal(
      (
        await post("/api/signin", {
          ...payload,
          email: payload.email.toUpperCase(),
          phone: "",
        })
      ).status,
      200,
    );
    assert.deepEqual(await (await fetch(url + "/api/providers")).json(), {
      google: false,
    });
    assert.equal(
      (await fetch(url + "/auth/google", { redirect: "manual" })).headers.get(
        "location",
      ),
      "/?auth=unavailable",
    );

    // Exercise the configured provider handoff locally without contacting Google.
    await stop();
    const callback = "https://afterlink.example/auth/google/callback";
    await start({
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-only",
      GOOGLE_REDIRECT_URI: callback,
    });
    assert.deepEqual(await (await fetch(url + "/api/providers")).json(), {
      google: true,
    });
    const handoff = await fetch(url + "/auth/google", { redirect: "manual" });
    assert.equal(handoff.status, 302);
    const consent = new URL(handoff.headers.get("location"));
    assert.equal(consent.origin, "https://accounts.google.com");
    assert.equal(consent.searchParams.get("redirect_uri"), callback);
    assert.equal(consent.searchParams.get("code_challenge_method"), "S256");
    assert.ok(consent.searchParams.get("code_challenge"));
    const state = consent.searchParams.get("state");
    assert.ok(
      state &&
        handoff.headers
          .get("set-cookie")
          .startsWith(`afterlink_oauth=${state}.`),
    );
    const cancelled = await fetch(
      url + "/auth/google/callback?error=access_denied",
      { redirect: "manual" },
    );
    assert.equal(cancelled.headers.get("location"), "/?auth=failed");
  },
);
