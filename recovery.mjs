import { randomBytes, createHash } from "node:crypto";

// Use only an operator-configured origin for email links, never the request Host.
export function recoveryMailer(env) {
  if (!env.RESET_PUBLIC_ORIGIN || !env.RESEND_API_KEY || !env.RESET_FROM_EMAIL)
    return null;
  const origin = new URL(env.RESET_PUBLIC_ORIGIN);
  if (origin.protocol !== "https:" || origin.username || origin.password)
    throw Error("RESET_PUBLIC_ORIGIN must be a public HTTPS origin.");
  return async (email, token) => {
    const url = `${origin.origin}/#reset=${token}`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESET_FROM_EMAIL,
        to: [email],
        subject: "Reset your AfterLink password",
        text: `Use this link within 15 minutes to choose a new password for AfterLink:\n\n${url}\n\nIf you didn't request this, ignore this email.\nAfterLink by Razorbill`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw Error("Email provider rejected the request.");
  };
}

export function installRecovery(app, db, limit, sendMail, hashPassword) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS password_resets (user_id INTEGER PRIMARY KEY REFERENCES users(id), digest TEXT UNIQUE NOT NULL, issued INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  );
  const digest = (raw) => createHash("sha256").update(raw).digest("hex");
  app.post("/api/forgot-password", limit, (req, res) => {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    if (
      email.length > 254 ||
      !/^[^\s@<>,;:]+@[^\s@<>,;:]+\.[^\s@<>,;:]+$/.test(email)
    )
      return res.status(400).json({ error: "Enter a valid email address." });
    if (!sendMail)
      return res.status(503).json({
        error:
          "Reset email delivery hasn’t been configured yet. No link was sent.",
      });
    const user = db
      .prepare("SELECT id FROM users WHERE email=? AND hash IS NOT NULL")
      .get(email);
    const now = Date.now();
    db.prepare("DELETE FROM password_resets WHERE expires <= ?").run(now);
    if (user) {
      const raw = randomBytes(32).toString("hex"),
        hashed = digest(raw);
      const result = db
        .prepare(
          `INSERT INTO password_resets VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET digest=excluded.digest, issued=excluded.issued, expires=excluded.expires WHERE password_resets.issued <= ?`,
        )
        .run(user.id, hashed, now, now + 900000, now - 60000);
      if (result.changes)
        void sendMail(email, raw).catch(() => {
          db.prepare("DELETE FROM password_resets WHERE digest=?").run(hashed);
          console.error(
            "AfterLink reset email delivery failed. Check the mail provider.",
          );
        });
    }
    // Identical response for existing, unknown, throttled and Google-only accounts.
    res.status(202).json({ ok: true });
  });
  app.post("/api/reset-password", limit, async (req, res) => {
    const { token, password } = req.body || {};
    const invalid = () =>
      res.status(400).json({
        error: "This reset link is invalid or expired. Request a new one.",
      });
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      return invalid();
    if (
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 128 ||
      !/[A-Z]/.test(password) ||
      !/[0-9]/.test(password)
    )
      return res
        .status(400)
        .json({
          error:
            "Use 12–128 characters, including an uppercase letter and a number.",
        });
    const hashed = digest(token);
    if (
      !db
        .prepare("SELECT 1 FROM password_resets WHERE digest=? AND expires>?")
        .get(hashed, Date.now())
    )
      return invalid();
    const newHash = await hashPassword(password);
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db
        .prepare(
          "DELETE FROM password_resets WHERE digest=? AND expires>? RETURNING user_id",
        )
        .get(hashed, Date.now());
      if (!row) {
        db.exec("ROLLBACK");
        return invalid();
      }
      db.prepare("UPDATE users SET hash=? WHERE id=?").run(
        newHash,
        row.user_id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(row.user_id);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    res.json({ ok: true });
  });
}
