// Public identities are separate from login emails. RADAR is cosmetic, never a role.
export function installFeed(app, db, session, limit) {
  db.exec(`CREATE TABLE IF NOT EXISTS feed_founder(slot INTEGER PRIMARY KEY CHECK(slot=1), user_id INTEGER NOT NULL UNIQUE REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS follows(follower INTEGER NOT NULL REFERENCES users(id), followed INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY(follower,followed), CHECK(follower<>followed));
    CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, author INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS saved_posts(user_id INTEGER NOT NULL REFERENCES users(id),post_id INTEGER NOT NULL REFERENCES posts(id),PRIMARY KEY(user_id,post_id));
    CREATE VIEW IF NOT EXISTS feed_profiles AS SELECT u.id,u.username, CASE WHEN f.user_id IS NOT NULL THEN 'RADAR' ELSE coalesce(u.full_name,u.username,'AfterLink member') END AS name, f.user_id IS NOT NULL AS founder FROM users u LEFT JOIN feed_founder f ON f.user_id=u.id;`);
  app.use("/api/feed", (req, res, next) => {
    const user = session(req);
    if (!user) return res.status(401).json({ error: "Please sign in again." });
    res.locals.uid = user.id;
    db.exec(
      "INSERT OR IGNORE INTO feed_founder SELECT 1,id FROM users ORDER BY id LIMIT 1",
    );
    next();
  });
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
        `SELECT t.id,t.body,t.created,p.name,p.username, s.post_id IS NOT NULL AS saved FROM posts t JOIN feed_profiles p ON p.id=t.author LEFT JOIN saved_posts s ON s.post_id=t.id AND s.user_id=? WHERE ${view === "saved" ? "s.user_id=?" : "(t.author=? OR t.author IN (SELECT followed FROM follows WHERE follower=?))"} ORDER BY t.id DESC LIMIT 50`,
      )
      .all(...(view === "saved" ? [uid, uid] : [uid, uid, uid]));
    res.json({ profile, posts });
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
          `SELECT p.*,f.follower IS NOT NULL AS following FROM feed_profiles p LEFT JOIN follows f ON f.followed=p.id AND f.follower=? WHERE p.id<>? AND (instr(lower(p.name),?) OR instr(lower(ifnull(p.username,'')),?) OR ?='') ORDER BY p.id LIMIT 50`,
        )
        .all(uid, uid, q, q, q),
    });
  });
  app.post("/api/feed/posts", limit, (req, res) => {
    const text = req.body?.body;
    if (typeof text !== "string" || !text.trim() || text.trim().length > 500)
      return res
        .status(400)
        .json({ error: "Write a post of 1–500 characters." });
    db.prepare("INSERT INTO posts(author,body,created) VALUES(?,?,?)").run(
      res.locals.uid,
      text.trim(),
      Date.now(),
    );
    res.status(201).json({ ok: true });
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
    db.prepare(
      on
        ? "INSERT OR IGNORE INTO saved_posts VALUES(?,?)"
        : "DELETE FROM saved_posts WHERE user_id=? AND post_id=?",
    ).run(uid, id);
    res.json({ ok: true });
  });
}
