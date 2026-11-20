import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";

const callbackPath = "/auth/google/callback";

// Only deployment settings determine the callback, never a request Host header.
export function googleClient(env) {
  const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = env;
  if (!id?.trim() || !secret?.trim()) return null;
  try {
    const callback = env.GOOGLE_REDIRECT_URI?.trim()
      ? new URL(env.GOOGLE_REDIRECT_URI.trim())
      : new URL(callbackPath, env.RENDER_EXTERNAL_URL);
    const local =
      env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname);
    if (
      callback.pathname !== callbackPath ||
      callback.username ||
      callback.password ||
      callback.search ||
      callback.hash ||
      !(
        callback.protocol === "https:" ||
        (local && callback.protocol === "http:")
      )
    )
      return null;
    return new OAuth2Client(id.trim(), secret.trim(), callback.href);
  } catch {
    return null;
  }
}

export async function googleHandoff(client, state) {
  const { codeVerifier, codeChallenge } =
    await client.generateCodeVerifierAsync();
  return {
    codeVerifier,
    url: client.generateAuthUrl({
      scope: ["openid", "email"],
      prompt: "select_account",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    }),
  };
}
