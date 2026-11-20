import { installAuthenticator } from "./authenticator.mjs";
import { installFeed } from "./feed.mjs";
import { installRecovery, recoveryMailer } from "./recovery.mjs";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url)),
  dbFile = process.env.DB_FILE || resolve(dir, "data/afterlink.sqlite");
mkdirSync(dirname(dbFile), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(dbFile);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,phone TEXT,hash TEXT,google_sub TEXT UNIQUE);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);`);
// Existing accounts (including Google users) do not need invented profile values.
const columns = db
  .prepare("PRAGMA table_info(users)")
  .all()
  .map((row) => row.name);
if (!columns.includes("full_name"))
  db.exec("ALTER TABLE users ADD COLUMN full_name TEXT");
if (!columns.includes("username"))
  db.exec("ALTER TABLE users ADD COLUMN username TEXT COLLATE NOCASE");
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(username COLLATE NOCASE)",
);
if (!columns.includes("bio"))
  db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
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
        "media-src": ["'self'", "data:", "blob:"],
        "img-src": ["'self'", "data:", "blob:"],
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
app.use("/api/feed/profile", express.json({ limit: "100kb" }));
const smallJson = express.json({ limit: "4kb" });
app.use((req, res, next) =>
  /^\/api\/feed\/(posts|stories|draft|thread\/[1-9]\d*)\/?$/.test(req.path)
    ? next()
    : smallJson(req, res, next),
);
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
  const ua = req.get("user-agent") || "",
    browser = /Edg\//.test(ua)
      ? "Edge"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  db.prepare("INSERT INTO session_devices VALUES(?,?)").run(
    sha(raw),
    browser + (/Mobile|Android|iPhone/.test(ua) ? " on mobile" : " on desktop"),
  );
  res.cookie("afterlink_session", raw, {
    ...sessionFlags(req),
    maxAge: sessionLifetime,
  });
}
const session = (req) =>
  db
    .prepare(
      "SELECT u.email,u.id FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
    )
    .get(sha(cookie(req, "afterlink_session")), Date.now());
installFeed(app, db, session, limit);
app.get("/api/session", (req, res) => {
  const user = session(req);
  res.json({ user: user ? { email: user.email } : null });
});
app.post("/api/logout", (req, res) => {
  revoke(req);
  res.clearCookie("afterlink_session", sessionFlags(req));
  res.json({ ok: true });
});
const bad = (res, msg, status = 400) => res.status(status).json({ error: msg });
async function hashPassword(password) {
  const salt = token();
  return `${salt}:${(await derive(password, salt, 64)).toString("hex")}`;
}
const factor = installAuthenticator(app, db, {
  limit,
  session,
  derive,
  sessionToken: (req) => sha(cookie(req, "afterlink_session")),
});
db.exec(`CREATE TABLE IF NOT EXISTS session_devices(token TEXT PRIMARY KEY REFERENCES sessions(token) ON DELETE CASCADE,label TEXT NOT NULL);CREATE TABLE IF NOT EXISTS password_changes(owner INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,changed INTEGER NOT NULL);
 CREATE TRIGGER IF NOT EXISTS password_updated AFTER UPDATE OF hash ON users WHEN new.hash IS NOT old.hash BEGIN INSERT OR REPLACE INTO password_changes VALUES(new.id,unixepoch('subsec')*1000);END;`);
app.get("/api/feed/security", (req, res) => {
  const uid = res.locals.uid,
    user = db
      .prepare(
        "SELECT email,google_sub IS NOT NULL verified, hash IS NOT NULL password FROM users WHERE id=?",
      )
      .get(uid);
  const devices = db
    .prepare(
      "SELECT expires,s.token=? current,d.label FROM sessions s LEFT JOIN session_devices d ON d.token=s.token WHERE user_id=? AND expires>? ORDER BY current DESC,expires DESC",
    )
    .all(sha(cookie(req, "afterlink_session")), uid, Date.now());
  res.json({
    user,
    devices,
    changed: db
      .prepare("SELECT changed FROM password_changes WHERE owner=?")
      .get(uid)?.changed,
    factor: factor.active(uid),
    factorAvailable: factor.available && !!user.password,
  });
});
app.post("/api/feed/security/logout-others", limit, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE user_id=? AND token<>?").run(
    res.locals.uid,
    sha(cookie(req, "afterlink_session")),
  );
  res.json({ ok: true });
});
app.post("/api/feed/security/password", limit, async (req, res) => {
  const { current, password } = req.body || {},
    uid = res.locals.uid;
  if (
    typeof current !== "string" ||
    current.length > 128 ||
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    return bad(res, "Use a password of 12–128 characters.");
  const old = db.prepare("SELECT hash FROM users WHERE id=?").get(uid).hash;
  if (!old)
    return bad(res, "Manage your password through your sign-in provider.");
  const [salt, digest] = old.split(":");
  if (
    !timingSafeEqual(
      await derive(current, salt, 64),
      Buffer.from(digest, "hex"),
    )
  )
    return bad(res, "Current password did not match.", 403);
  const hash = await hashPassword(password);
  if (
    !session(req) ||
    !db
      .prepare("UPDATE users SET hash=? WHERE id=? AND hash=?")
      .run(hash, uid, old).changes
  )
    return bad(res, "Sign in again.", 403);
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(uid);
  db.prepare("DELETE FROM password_resets WHERE user_id=?").run(uid);
  login(req, res, uid);
  res.json({ ok: true });
});
installRecovery(app, db, limit, recoveryMailer(process.env), hashPassword);
// Never recycle a deleted profile link or transfer the founder identity.
db.exec(
  "CREATE TABLE IF NOT EXISTS retired_profiles(id INTEGER PRIMARY KEY, founder INTEGER NOT NULL)",
);
const nextId =
  "(SELECT 1+max(coalesce((SELECT max(id) FROM users),0),coalesce((SELECT max(id) FROM retired_profiles),0)))";
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
    const { fullName, username } = req.body;
    if (
      typeof fullName !== "string" ||
      !fullName.trim() ||
      fullName.trim().length > 100
    )
      return bad(res, "Enter your full name (up to 100 characters).");
    if (typeof username !== "string" || !/^[a-zA-Z0-9_]{3,30}$/.test(username))
      return bad(
        res,
        "Choose a username with 3–30 letters, numbers, or underscores.",
      );
    const hash = await hashPassword(password);
    const row = db
      .prepare(
        `INSERT INTO users(id,email,phone,hash,full_name,username) VALUES(${nextId},?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id`,
      )
      .get(email, phone || null, hash, fullName.trim(), username);
    if (!row)
      return bad(
        res,
        "That email or username is already in use. Try signing in or choose another username.",
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
    !db
      .prepare("SELECT 1 FROM users WHERE id=? AND hash=?")
      .get(row.id, row.hash) ||
    (phone && phone !== row.phone)
  )
    return bad(res, invalid, 401);
  if (factor.active(row.id)) {
    if (!req.body.code) return res.json({ requiresCode: true });
    if (!factor.verify(row.id, req.body.code))
      return bad(res, "Invalid or previously used code.", 403);
  }
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
          `INSERT INTO users(id,email,google_sub) VALUES(${nextId},?,?) ON CONFLICT DO NOTHING RETURNING id`,
        )
        .get(p.email.toLowerCase(), p.sub);
    if (!row) return res.redirect("/?auth=existing");
    login(req, res, row.id);
    res.redirect("/home");
  } catch {
    return res.redirect("/?auth=failed");
  }
});
app.get(
  [
    "/settings",
    "/settings/:section",
    "/saved",
    "/connections",
    "/stories",
    "/stories/create",
    "/safety",
    "/messages",
    "/messages/:peer",
    "/notifications",
    "/search",
    "/reels",
    "/post/:id",
  ],
  (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!session(req))
      return res.redirect(
        "/?auth=session&next=" + encodeURIComponent(req.originalUrl),
      );
    res.sendFile(resolve(dir, "public/social.html"));
  },
);
// These routes already checked the session. Send only the signed-in email
// needed by the shared shell so navigation needs no second session round trip.
const memberShell = readFileSync(resolve(dir, "public/index.html"), "utf8");
app.get(["/home", "/create", "/profile", "/profile/:id"], (req, res) => {
  res.set("Cache-Control", "no-store");
  const member = session(req);
  if (!member) {
    const profile = req.path.startsWith("/profile")
      ? req.params.id === "edit"
        ? "edit"
        : /^[1-9]\d*$/.test(req.params.id)
          ? req.params.id
          : "me"
      : "";
    return res.redirect(
      "/?auth=session" + (profile ? "&profile=" + profile : ""),
    );
  }
  res
    .type("html")
    .send(
      memberShell.replace(
        "<!-- member-session -->",
        () =>
          `<meta name="member-session" content="${encodeURIComponent(member.email)}">`,
      ),
    );
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
