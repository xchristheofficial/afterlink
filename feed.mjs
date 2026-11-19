import { separated, muted } from "./visibility.mjs";
import { installSocial } from "./social.mjs";
import { installComposer, visiblePost } from "./composer.mjs";
// Public identities are separate from login emails. RADAR is cosmetic, never a role.
export function installFeed(app, db, session, limit) {
  db.exec(`CREATE TABLE IF NOT EXISTS feed_founder(slot INTEGER PRIMARY KEY CHECK(slot=1), user_id INTEGER NOT NULL UNIQUE REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS follows(follower INTEGER NOT NULL REFERENCES users(id), followed INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY(follower,followed), CHECK(follower<>followed));
    CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, author INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS saved_posts(user_id INTEGER NOT NULL REFERENCES users(id),post_id INTEGER NOT NULL REFERENCES posts(id),PRIMARY KEY(user_id,post_id));
    CREATE TABLE IF NOT EXISTS profile_settings(user_id INTEGER PRIMARY KEY REFERENCES users(id), private INTEGER NOT NULL DEFAULT 0, photo BLOB);
    CREATE VIEW IF NOT EXISTS feed_profiles AS SELECT u.id,u.username, CASE WHEN f.user_id IS NOT NULL THEN 'RADAR' ELSE coalesce(u.full_name,u.username,'AfterLink member') END AS name, f.user_id IS NOT NULL AS founder FROM users u LEFT JOIN feed_founder f ON f.user_id=u.id;`);
  app.use("/api/feed", (req, res, next) => {
    const user = session(req);
    if (!user) return res.status(401).json({ error: "Please sign in again." });
    res.locals.uid = user.id;
    db.prepare(
      "INSERT INTO last_activity SELECT owner,? FROM preferences WHERE owner=? AND json_extract(data,'$.activity')=1 ON CONFLICT(owner) DO UPDATE SET seen=excluded.seen WHERE seen<excluded.seen-30000",
    ).run(Date.now(), user.id);
    db.exec(
      "INSERT OR IGNORE INTO feed_founder SELECT 1,id FROM users WHERE NOT EXISTS (SELECT 1 FROM retired_profiles WHERE founder=1) ORDER BY id LIMIT 1",
    );
    next();
  });
  let mention;
  const enrich = installComposer(app, db, limit, (...args) => mention(...args));
  mention = installSocial(app, db, enrich);
  app.get("/api/feed", (req, res) => {
    const uid = res.locals.uid;
    const profile = db
      .prepare(
        `SELECT p.*, (SELECT count(*) FROM follows WHERE followed=p.id) followers,(SELECT count(*) FROM follows WHERE follower=p.id) following FROM feed_profiles p WHERE id=?`,
      )
      .get(uid);
    const view = req.query.view === "saved" ? "saved" : "feed";
    const posts = db
      .prepare(
        `SELECT t.id,t.details,t.audience,t.body,t.created,t.author,p.name,p.username,p.founder, s.post_id IS NOT NULL AS saved FROM posts t JOIN feed_profiles p ON p.id=t.author LEFT JOIN saved_posts s ON s.post_id=t.id AND s.user_id=? WHERE ${visiblePost("t", ":viewer")} AND ${view === "saved" ? "1" : "NOT " + muted(":viewer", "t.author")} AND ${view === "saved" ? "s.user_id=?" : "(t.author=? OR t.author IN (SELECT followed FROM follows WHERE follower=?))"} ORDER BY t.id DESC LIMIT 50`,
      )
      .all(
        { viewer: uid },
        ...(view === "saved" ? [uid, uid] : [uid, uid, uid]),
      );
    res.json({ profile, posts: enrich(posts, uid) });
  });
  app.get("/api/feed/profile", (req, res) => {
    const viewer = res.locals.uid,
      id = req.query.id === undefined ? viewer : Number(req.query.id);
    if (!Number.isSafeInteger(id) || id < 1)
      return res.status(404).json({ error: "Profile not found." });
    const profile = db
      .prepare(
        `SELECT p.*, u.bio,coalesce((SELECT private FROM profile_settings WHERE user_id=p.id),0) AS private,
      (SELECT count(*) FROM posts WHERE author=p.id) postCount,
      (SELECT count(*) FROM follows WHERE followed=p.id) followers,
      (SELECT count(*) FROM follows WHERE follower=p.id) following,
      EXISTS(SELECT 1 FROM follows WHERE follower=? AND followed=p.id) isFollowing
      FROM feed_profiles p JOIN users u ON u.id=p.id WHERE p.id=?`,
      )
      .get(viewer, id);
    if (
      !profile ||
      db
        .prepare(`SELECT ${separated(":viewer", ":id")} hidden`)
        .get({ viewer, id }).hidden
    )
      return res.status(404).json({ error: "Profile not found." });
    const posts =
      viewer !== id && profile.private && !profile.isFollowing
        ? []
        : db
            .prepare(
              `SELECT id,body,created,details,audience FROM posts p WHERE author=? AND ${visiblePost("p", ":viewer")} ORDER BY id DESC LIMIT 50`,
            )
            .all({ viewer }, id);
    const contact =
      viewer === id
        ? db.prepare("SELECT email,phone FROM users WHERE id=?").get(id)
        : undefined;
    res.json({
      profile,
      posts: enrich(posts, viewer),
      contact,
      own: viewer === id,
    });
  });
  const handleOK = (value) =>
    typeof value === "string" && /^[a-zA-Z0-9_]{3,30}$/.test(value);
  const available = (value, uid) =>
    !db
      .prepare("SELECT 1 FROM users WHERE username=? COLLATE NOCASE AND id<>?")
      .get(value, uid);
  app.get("/api/feed/username", (req, res) =>
    res.json({
      available:
        handleOK(req.query.name) && available(req.query.name, res.locals.uid),
    }),
  );
  app.get("/api/feed/avatar/:id", (req, res) => {
    const id = req.params.id === "me" ? res.locals.uid : Number(req.params.id);
    const photo =
      Number.isSafeInteger(id) &&
      db.prepare("SELECT photo FROM profile_settings WHERE user_id=?").get(id)
        ?.photo;
    if (!photo) return res.redirect("/assets/editor-avatar.webp");
    res.type("image/jpeg").send(Buffer.from(photo));
  });
  app.post("/api/feed/profile", limit, (req, res) => {
    const { name, bio } = req.body || {};
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 100 ||
      typeof bio !== "string" ||
      bio.trim().length > 220
    )
      return res.status(400).json({
        error:
          "Enter a name (1–100 characters) and a bio up to 220 characters.",
      });
    const uid = res.locals.uid,
      { username, phone, private: privacy, photo } = req.body;
    if (username !== undefined && !handleOK(username))
      return res.status(400).json({
        error: "Use 3–30 letters, numbers or underscores for your username.",
      });
    if (username !== undefined && !available(username, uid))
      return res.status(409).json({ error: "That username is already taken." });
    if (
      phone !== undefined &&
      (typeof phone !== "string" ||
        (phone && !/^\+?\d{7,15}$/.test(phone.replace(/[ ()-]/g, ""))))
    )
      return res
        .status(400)
        .json({ error: "Enter a valid phone number or leave it blank." });
    if (privacy !== undefined && typeof privacy !== "boolean")
      return res.status(400).json({ error: "Invalid privacy setting." });
    let bytes = null;
    if (photo !== undefined) {
      if (
        typeof photo !== "string" ||
        !photo.startsWith("/9j/") ||
        photo.length > 98000
      )
        return res.status(400).json({ error: "Choose a smaller image." });
      bytes = Buffer.from(photo, "base64");
      if (!bytes.subarray(-2).equals(Buffer.from([255, 217])))
        return res.status(400).json({ error: "Invalid photo." });
    }
    db.exec("BEGIN");
    try {
      db.prepare(
        `UPDATE users SET full_name=CASE WHEN id IN (SELECT user_id FROM feed_founder) THEN full_name ELSE ? END,bio=?,username=coalesce(?,username),phone=coalesce(?,phone) WHERE id=?`,
      ).run(
        name.trim(),
        bio.trim(),
        username ?? null,
        phone?.replace(/[ ()-]/g, "") ?? null,
        uid,
      );
      db.prepare(
        "INSERT OR IGNORE INTO profile_settings(user_id) VALUES(?)",
      ).run(uid);
      db.prepare(
        "UPDATE profile_settings SET private=coalesce(?,private),photo=coalesce(?,photo) WHERE user_id=?",
      ).run(privacy === undefined ? null : Number(privacy), bytes, uid);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.json({ ok: true });
  });
  app.post("/api/feed/delete-account", limit, (req, res) => {
    const uid = res.locals.uid;
    if (req.body?.confirmation !== "DELETE")
      return res.status(400).json({ error: "Type DELETE to confirm." });
    db.exec("BEGIN");
    try {
      db.prepare(
        "INSERT INTO retired_profiles SELECT id,founder FROM feed_profiles WHERE id=?",
      ).run(uid);
      for (const [table, where] of [
        [
          "saved_posts",
          "user_id=:id OR post_id IN (SELECT id FROM posts WHERE author=:id)",
        ],
        ["posts", "author=:id"],
        ["follows", "followed=:id OR follower=:id"],
        ["sessions", "user_id=:id"],
        ["password_resets", "user_id=:id"],
        ["profile_settings", "user_id=:id"],
        ["feed_founder", "user_id=:id"],
        ["users", "id=:id"],
      ])
        db.prepare(`DELETE FROM ${table} WHERE ${where}`).run({ id: uid });
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.json({ ok: true });
  });
  app.get("/api/feed/people", (req, res) => {
    const q = String(req.query.q || "")
        .trim()
        .toLowerCase()
        .slice(0, 100),
      uid = res.locals.uid;
    res.json({
      people: db
        .prepare(
          `SELECT p.*,coalesce((SELECT private FROM profile_settings WHERE user_id=p.id),0) AS private,f.follower IS NOT NULL AS following FROM feed_profiles p LEFT JOIN follows f ON f.followed=p.id AND f.follower=? WHERE NOT ${separated(":viewer", "p.id")} AND p.id<>? AND (instr(lower(p.name),?) OR instr(lower(ifnull(p.username,'')),?) OR ?='') ORDER BY p.id LIMIT 50`,
        )
        .all({ viewer: uid }, uid, uid, q, q, q),
    });
  });
  app.post("/api/feed/follow", limit, (req, res) => {
    const { id, on } = req.body || {},
      uid = res.locals.uid;
    if (
      !Number.isSafeInteger(id) ||
      id === uid ||
      typeof on !== "boolean" ||
      !db.prepare("SELECT 1 FROM users WHERE id=?").get(id)
    )
      return res.status(400).json({ error: "Choose another account." });
    if (
      on &&
      (db.prepare(`SELECT ${separated(":uid", ":id")} hidden`).get({ uid, id })
        .hidden ||
        db
          .prepare("SELECT private FROM profile_settings WHERE user_id=?")
          .get(id)?.private)
    )
      return res.status(403).json({
        error: "This private account is not accepting new followers.",
      });
    db.prepare(
      on
        ? "INSERT OR IGNORE INTO follows VALUES(?,?)"
        : "DELETE FROM follows WHERE follower=? AND followed=?",
    ).run(uid, id);
    res.json({ ok: true });
  });
  app.post("/api/feed/save", limit, (req, res) => {
    const { id, on } = req.body || {},
      uid = res.locals.uid;
    if (
      !Number.isSafeInteger(id) ||
      typeof on !== "boolean" ||
      !db.prepare("SELECT 1 FROM posts WHERE id=?").get(id)
    )
      return res.status(400).json({ error: "Post not found." });
    if (
      on &&
      !db
        .prepare(
          `SELECT 1 FROM posts p WHERE p.id=? AND ${visiblePost("p", ":uid")}`,
        )
        .get({ uid }, id)
    )
      return res.status(403).json({ error: "This post is private." });
    db.prepare(
      on
        ? "INSERT OR IGNORE INTO saved_posts VALUES(?,?)"
        : "DELETE FROM saved_posts WHERE user_id=? AND post_id=?",
    ).run(uid, id);
    res.json({ ok: true });
  });
}
