import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { googleClient, googleHandoff } from "../google-signin.mjs";

const env = {
  GOOGLE_CLIENT_ID: "example-client",
  GOOGLE_CLIENT_SECRET: "private-example",
  NODE_ENV: "production",
  RENDER_EXTERNAL_URL: "https://sample.onrender.com",
};

test("Google account chooser uses the configured callback and a matching PKCE challenge", async () => {
  for (const explicit of [
    undefined,
    "https://community.example/auth/google/callback",
  ]) {
    const client = googleClient({ ...env, GOOGLE_REDIRECT_URI: explicit });
    const { url, codeVerifier } = await googleHandoff(client, "sample-state");
    const consent = new URL(url),
      params = consent.searchParams;
    assert.equal(consent.origin, "https://accounts.google.com");
    assert.equal(
      params.get("redirect_uri"),
      explicit ?? env.RENDER_EXTERNAL_URL + "/auth/google/callback",
    );
    assert.equal(params.get("scope"), "openid email");
    assert.equal(params.get("prompt"), "select_account");
    assert.equal(params.get("state"), "sample-state");
    assert.equal(params.get("code_challenge_method"), "S256");
    assert.equal(
      params.get("code_challenge"),
      createHash("sha256").update(codeVerifier).digest("base64url"),
    );
    assert.ok(
      !url.includes(env.GOOGLE_CLIENT_SECRET) && !url.includes(codeVerifier),
    );
  }
});
test("incomplete credentials and invalid callbacks disable Google; loopback HTTP is development only", () => {
  const local = "http://localhost:3000/auth/google/callback";
  for (const override of [
    { GOOGLE_CLIENT_ID: "" },
    { GOOGLE_CLIENT_SECRET: "" },
    { RENDER_EXTERNAL_URL: undefined },
    { GOOGLE_REDIRECT_URI: "not-a-url" },
    { GOOGLE_REDIRECT_URI: "https://community.example/" },
    { GOOGLE_REDIRECT_URI: local },
  ])
    assert.equal(googleClient({ ...env, ...override }), null);
  assert.ok(
    googleClient({
      ...env,
      NODE_ENV: "development",
      GOOGLE_REDIRECT_URI: local,
    }),
  );
});
