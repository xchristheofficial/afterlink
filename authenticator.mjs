import { Secret, TOTP } from "otpauth";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
// A stable deployment key is required. Never silently reset a member's second factor.
export function installAuthenticator(
  app,
  db,
  { limit, session, sessionToken, derive },
) {
  const key = Buffer.from(process.env.AFTERLINK_2FA_KEY || "", "base64"),
    available = key.length === 32;
  db.exec(`CREATE TABLE IF NOT EXISTS factors(owner INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,secret TEXT NOT NULL,last_step INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS pending_factors(owner INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,secret TEXT NOT NULL,session TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS recovery_codes(owner INTEGER NOT NULL REFERENCES factors(owner) ON DELETE CASCADE,digest TEXT NOT NULL,PRIMARY KEY(owner,digest));`);
  const one = (q, ...args) => db.prepare(q).get(...args),
    run = (q, ...args) => db.prepare(q).run(...args);
  function seal(value, uid) {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", key, iv);
    c.setAAD(Buffer.from(String(uid)));
    return Buffer.concat([
      iv,
      c.update(value, "utf8"),
      c.final(),
      c.getAuthTag(),
    ]).toString("base64");
  }
  function open(value, uid) {
    const data = Buffer.from(value, "base64"),
      c = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    c.setAAD(Buffer.from(String(uid)));
    c.setAuthTag(data.subarray(-16));
    return Buffer.concat([
      c.update(data.subarray(12, -16)),
      c.final(),
    ]).toString();
  }
  function step(secret, uid, code) {
    if (typeof code !== "string" || !/^\d{6}$/.test(code) || !available)
      return -1;
    const timestamp = Date.now(),
      d = new TOTP({ secret: open(secret, uid) }).validate({
        token: code,
        timestamp,
        window: 1,
      });
    return d === null ? -1 : Math.floor(timestamp / 30000) + d;
  }
  const digest = (code) => createHash("sha256").update(code).digest("hex");
  function active(uid) {
    return !!one("SELECT 1 FROM factors WHERE owner=?", uid);
  }
  function verify(uid, code) {
    const f = one("SELECT * FROM factors WHERE owner=?", uid);
    if (!f || typeof code !== "string") return false;
    if (/^[a-f0-9]{20}$/i.test(code))
      return !!run(
        "DELETE FROM recovery_codes WHERE owner=? AND digest=?",
        uid,
        digest(code.toLowerCase()),
      ).changes;
    const tick = step(f.secret, uid, code);
    return (
      tick > f.last_step &&
      !!run(
        "UPDATE factors SET last_step=? WHERE owner=? AND last_step<?",
        tick,
        uid,
        tick,
      ).changes
    );
  }
  async function reauth(req, uid, password) {
    const row = one("SELECT hash FROM users WHERE id=?", uid);
    if (!row?.hash || typeof password !== "string" || password.length > 128)
      return false;
    const [salt, h] = row.hash.split(":");
    return (
      timingSafeEqual(
        Buffer.from(h, "hex"),
        await derive(password, salt, 64),
      ) &&
      session(req)?.id === uid &&
      one("SELECT 1 FROM users WHERE id=? AND hash=?", uid, row.hash)
    );
  }
  app.post("/api/feed/security/factor/:action", limit, async (req, res) => {
    const uid = res.locals.uid,
      b = req.body || {},
      action = req.params.action;
    if (!available)
      return res
        .status(503)
        .json({ error: "Authenticator setup is not configured." });
    if (action === "enable") {
      const pending = one(
        "SELECT secret FROM pending_factors WHERE owner=? AND session=? AND expires>?",
        uid,
        sessionToken(req),
        Date.now(),
      );
      if (active(uid) || !pending)
        return res
          .status(400)
          .json({ error: "Restart setup to obtain a new key." });
      const tick = step(pending.secret, uid, b.code);
      if (tick < 0)
        return res.status(400).json({ error: "Invalid authenticator code." });
      const codes = Array.from({ length: 8 }, () =>
        randomBytes(10).toString("hex"),
      );
      db.exec("BEGIN");
      try {
        run("INSERT INTO factors VALUES(?,?,?)", uid, pending.secret, tick);
        run("DELETE FROM pending_factors WHERE owner=?", uid);
        for (const c of codes)
          run("INSERT INTO recovery_codes VALUES(?,?)", uid, digest(c));
        run(
          "DELETE FROM sessions WHERE user_id=? AND token<>?",
          uid,
          sessionToken(req),
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return res.json({ codes });
    }
    if (!(await reauth(req, uid, b.password)))
      return res.status(403).json({ error: "Confirm your current password." });
    if (action === "setup" && !active(uid)) {
      const s = new Secret({ size: 20 });
      run(
        "INSERT OR REPLACE INTO pending_factors VALUES(?,?,?,?)",
        uid,
        seal(s.base32, uid),
        sessionToken(req),
        Date.now() + 600000,
      );
      return res.json({ key: s.base32 });
    }
    if (action === "disable" && verify(uid, b.code)) {
      run("DELETE FROM factors WHERE owner=?", uid);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: "Invalid action or code." });
  });
  return { active, verify, available };
}
