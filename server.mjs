import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url)),
  dbFile = process.env.DB_FILE || resolve(dir, "data/afterlink.sqlite");
mkdirSync(dirname(dbFile), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(dbFile);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,phone TEXT,hash TEXT,google_sub TEXT UNIQUE);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);`);
const app = express(),
  derive = promisify(scrypt),
  sha = (s) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("hex");
const production = process.env.NODE_ENV === "production";
app.disable("x-powered-by");
app.use(
  helmet({
    xFrameOptions: production ? undefined : false,
    contentSecurityPolicy: {
      directives: {
        "frame-ancestors": production ? ["'self'"] : null,
        "upgrade-insecure-requests": production ? [] : null,
      },
    },
  }),
);
app.use(["/api", "/auth"], (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api", (req, res, next) => {
  if (
    req.method === "POST" &&
    (!req.is("application/json") || req.get("X-AfterLink-Request") !== "1")
  )
    return res.sendStatus(403);
  next();
});
app.use(express.json({ limit: "4kb" }));
const limit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 45,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});
// Set this only to the actual number of trusted reverse proxies in deployment.
if (process.env.TRUST_PROXY_HOPS)
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
const cookie = (req, name) =>
  (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="))
    ?.slice(name.length + 1) || "";
const flags = {
  httpOnly: true,
  sameSite: "lax",
  secure: production,
  path: "/",
};
// An embedded HTTPS workspace preview needs a partitioned cookie. Keep production first-party.
const sessionFlags = (req) =>
  !production &&
  (req.hostname.endsWith(".e2b.app") ||
    req.get("x-forwarded-proto") === "https")
    ? { ...flags, secure: true, sameSite: "none", partitioned: true }
    : flags;
const sessionLifetime = 7 * 24 * 3600 * 1000;
const revoke = (req) =>
  db
    .prepare("DELETE FROM sessions WHERE token=?")
    .run(sha(cookie(req, "afterlink_session")));
function login(req, res, id) {
  const raw = token();
  revoke(req);
  db.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now());
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    sha(raw),
    id,
    Date.now() + sessionLifetime,
  );
  res.cookie("afterlink_session", raw, {
    ...sessionFlags(req),
    maxAge: sessionLifetime,
  });
}
const session = (req) =>
  db
    .prepare(
      "SELECT u.email FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
    )
    .get(sha(cookie(req, "afterlink_session")), Date.now());
app.get("/api/session", (req, res) => res.json({ user: session(req) || null }));
app.post("/api/logout", (req, res) => {
  revoke(req);
  res.clearCookie("afterlink_session", sessionFlags(req));
  res.json({ ok: true });
});
const bad = (res, msg, status = 400) => res.status(status).json({ error: msg });
const invalid = "Check your email, phone (if entered), and password.";
app.post(["/api/signup", "/api/signin"], limit, async (req, res) => {
  const signup = req.path.endsWith("signup");
  const { email: rawEmail, phone: rawPhone = "", password } = req.body || {};
  if (
    typeof rawEmail !== "string" ||
    typeof password !== "string" ||
    typeof rawPhone !== "string"
  )
    return bad(res, "Enter valid account details.");
  const email = rawEmail.trim().toLowerCase(),
    phone = rawPhone.replace(/[ ()-]/g, "");
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return bad(res, "Enter a valid email address.");
  if (phone && !/^\+?[0-9]{7,15}$/.test(phone))
    return bad(res, "Enter a valid phone number or leave it blank.");
  if (
    password.length > 128 ||
    !password.length ||
    (signup && password.length < 12)
  )
    return bad(res, "Use a password between 12 and 128 characters.");
  if (signup) {
    const salt = token(),
      hash = (await derive(password, salt, 64)).toString("hex");
    const row = db
      .prepare(
        "INSERT INTO users(email,phone,hash) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING RETURNING id",
      )
      .get(email, phone || null, `${salt}:${hash}`);
    if (!row)
      return bad(
        res,
        "Unable to create this account. Try signing in instead.",
        409,
      );
    login(req, res, row.id);
    return res.status(201).json({ user: { email } });
  }
  const row = db
    .prepare("SELECT id,phone,hash FROM users WHERE email=?")
    .get(email);
  const [salt, hash] = (row?.hash || `unused:${"0".repeat(128)}`).split(":");
  const attempt = await derive(password, salt, 64);
  if (
    !timingSafeEqual(attempt, Buffer.from(hash, "hex")) ||
    !row?.hash ||
    (phone && phone !== row.phone)
  )
    return bad(res, invalid, 401);
  login(req, res, row.id);
  res.json({ user: { email } });
});
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } =
  process.env;
const google =
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI
    ? new OAuth2Client(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI,
      )
    : null;
app.get("/api/providers", (req, res) => res.json({ google: !!google }));
app.get("/auth/google", limit, async (req, res) => {
  if (!google) return res.redirect("/?auth=unavailable");
  const state = token(),
    { codeVerifier, codeChallenge } = await google.generateCodeVerifierAsync();
  res.cookie("afterlink_oauth", `${state}.${codeVerifier}`, {
    ...flags,
    maxAge: 600000,
  });
  res.redirect(
    google.generateAuthUrl({
      scope: ["openid", "email"],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    }),
  );
});
app.get("/auth/google/callback", limit, async (req, res) => {
  const [state, ...parts] = cookie(req, "afterlink_oauth").split(".");
  res.clearCookie("afterlink_oauth", flags);
  if (
    !google ||
    !state ||
    state !== req.query.state ||
    typeof req.query.code !== "string"
  )
    return res.redirect("/?auth=failed");
  try {
    const { tokens } = await google.getToken({
      code: req.query.code,
      codeVerifier: parts.join("."),
    });
    const ticket = await google.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email_verified || !p.email)
      return res.redirect("/?auth=failed");
    let row = db.prepare("SELECT id FROM users WHERE google_sub=?").get(p.sub);
    if (!row)
      row = db
        .prepare(
          "INSERT INTO users(email,google_sub) VALUES(?,?) ON CONFLICT DO NOTHING RETURNING id",
        )
        .get(p.email.toLowerCase(), p.sub);
    if (!row) return res.redirect("/?auth=existing");
    login(req, res, row.id);
    res.redirect("/");
  } catch {
    return res.redirect("/?auth=failed");
  }
});
app.use(express.static(resolve(dir, "public")));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  bad(
    res,
    err.status === 400 ? "Invalid request." : "Request could not be completed.",
    err.status || 500,
  );
});
app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0", function () {
  console.log(`AfterLink listening on ${this.address().port}`);
});
