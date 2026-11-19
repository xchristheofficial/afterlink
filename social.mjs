import express from "express";
import { rateLimit } from "express-rate-limit";
import { visiblePost } from "./composer.mjs";

export function installSocial(app, db, enrich) {
  const limit = rateLimit({
    windowMs: 60_000,
    limit: 60,
    keyGenerator: (_req, res) => String(res.locals.uid),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Please wait a moment before trying again." },
  });
  const user = "INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE",
    post = "INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE";
  db.exec(`CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, sender ${user}, recipient ${user}, body TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER DEFAULT 0, CHECK(sender<>recipient));
    CREATE TABLE IF NOT EXISTS message_photos(message INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,bytes BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS link_shares(post_id ${post},actor ${user},PRIMARY KEY(post_id,actor));
    CREATE TABLE IF NOT EXISTS reel_views(post_id ${post},viewer ${user},PRIMARY KEY(post_id,viewer));
    CREATE INDEX IF NOT EXISTS message_pair ON messages(sender,recipient,id);
    CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY,post_id ${post},author ${user},parent INTEGER REFERENCES comments(id) ON DELETE SET NULL,body TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS comments_for ON comments(post_id,id);
    CREATE TABLE IF NOT EXISTS post_hearts(post_id ${post},actor ${user},PRIMARY KEY(post_id,actor));
    CREATE TABLE IF NOT EXISTS comment_hearts(comment INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,actor ${user},PRIMARY KEY(comment,actor));
    CREATE TABLE IF NOT EXISTS notices(id INTEGER PRIMARY KEY,recipient ${user},actor ${user},kind TEXT NOT NULL,post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,created INTEGER NOT NULL,seen INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS notices_for ON notices(recipient,id);
    CREATE TRIGGER IF NOT EXISTS follow_notice AFTER INSERT ON follows BEGIN INSERT INTO notices(recipient,actor,kind,created) VALUES(new.followed,new.follower,'follow',unixepoch('subsec')*1000); END;
    CREATE TRIGGER IF NOT EXISTS undo_follow_notice AFTER DELETE ON follows BEGIN DELETE FROM notices WHERE recipient=old.followed AND actor=old.follower AND kind='follow'; END;`);
  const one = (q, ...v) => db.prepare(q).get(...v),
    all = (q, ...v) => db.prepare(q).all(...v),
    run = (q, ...v) => db.prepare(q).run(...v);
  function fail(message, status = 400) {
    throw Object.assign(Error(message), { status, expected: true });
  }
  const id = (n) => {
    n = Number(n);
    if (!Number.isSafeInteger(n) || n < 1) fail("Invalid item.");
    return n;
  };
  const body = (s, n) => {
    if (typeof s !== "string" || !s.trim() || s.length > n)
      fail(`Write 1–${n} characters.`);
    return s.trim();
  };
  const visible = visiblePost("p", ":uid");
  const person = (who, uid) =>
    one(
      `SELECT a.*,coalesce(s.private,0) private,exists(SELECT 1 FROM follows WHERE follower=:uid AND followed=a.id) following FROM feed_profiles a LEFT JOIN profile_settings s ON s.user_id=a.id WHERE a.id=:who`,
      { who, uid },
    ) || fail("Member not found.", 404);
  const selection = `SELECT p.*,a.name,a.username,a.founder,(SELECT count(*) FROM link_shares WHERE post_id=p.id) shares,(SELECT count(*) FROM saved_posts WHERE post_id=p.id) saves,(SELECT count(*) FROM reel_views WHERE post_id=p.id) views,(SELECT count(*) FROM post_hearts WHERE post_id=p.id) likes,exists(SELECT 1 FROM post_hearts WHERE post_id=p.id AND actor=:uid) liked,(SELECT count(*) FROM comments WHERE post_id=p.id) comments,exists(SELECT 1 FROM saved_posts WHERE post_id=p.id AND user_id=:uid) saved FROM posts p JOIN feed_profiles a ON a.id=p.author WHERE ${visible}`;
  const getPost = (pid, uid) =>
    one(selection + " AND p.id=:pid", { uid, pid }) ||
    fail("Post unavailable.", 404);
  function endpoint(method, path, fn) {
    app[method](
      "/api/feed/" + path,
      ...(method === "post" ? [limit] : []),
      (req, res, next) => {
        const write = method === "post";
        try {
          if (write) db.exec("BEGIN");
          const result = fn(
            res.locals.uid,
            req.query,
            req.body || {},
            req.params,
          );
          if (write) db.exec("COMMIT");
          res.json(result ?? { ok: true });
        } catch (e) {
          if (write) db.exec("ROLLBACK");
          if (e.expected) res.status(e.status).json({ error: e.message });
          else next(e);
        }
      },
    );
  }
  function notify(recipient, actor, kind, pid) {
    if (recipient !== actor)
      run(
        "INSERT INTO notices(recipient,actor,kind,post_id,created) VALUES(?,?,?,?,?)",
        recipient,
        actor,
        kind,
        pid,
        Date.now(),
      );
  }
  function mentions(pid, actor, text) {
    for (const handle of new Set(
      [...text.matchAll(/(?:^|[^\w@])@([a-zA-Z0-9_]{3,30})\b/g)].map((m) =>
        m[1].toLowerCase(),
      ),
    )) {
      const member = one(
        "SELECT id FROM users WHERE username=? COLLATE NOCASE",
        handle,
      );
      if (
        member &&
        one(`SELECT 1 FROM posts p WHERE id=:pid AND ${visible}`, {
          pid,
          uid: member.id,
        })
      )
        notify(member.id, actor, "mention", pid);
    }
  }
  endpoint("get", "discover", (uid, q) => {
    const term = String(q.q || "")
        .trim()
        .slice(0, 100)
        .toLowerCase(),
      kind = q.kind === "reels" ? "reels" : "posts";
    const rows = all(
      selection +
        ` AND (instr(lower(p.body),:term) OR instr(lower(a.name),:term) OR instr(lower(coalesce(a.username,'')),:term) OR instr(lower(coalesce(json_extract(p.details,'$.location'),'')),:term)) ${kind === "reels" ? "AND EXISTS(SELECT 1 FROM post_media WHERE post_id=p.id AND type LIKE 'video/%')" : ""} ORDER BY p.id DESC LIMIT 51`,
      { uid, term },
    );
    return { posts: enrich(rows.slice(0, 50), uid), more: rows.length > 50 };
  });
  endpoint("get", "post/:id", (uid, q, b, p) => {
    const item = getPost(id(p.id), uid),
      before = q.before ? id(q.before) : Number.MAX_SAFE_INTEGER;
    const rows = all(
      `SELECT c.*,a.name,a.username,a.founder,pa.name parentName,(SELECT count(*) FROM comment_hearts WHERE comment=c.id) likes,exists(SELECT 1 FROM comment_hearts WHERE comment=c.id AND actor=?) liked FROM comments c JOIN feed_profiles a ON a.id=c.author LEFT JOIN comments pc ON pc.id=c.parent LEFT JOIN feed_profiles pa ON pa.id=pc.author WHERE c.post_id=? AND c.id<? ORDER BY c.id DESC LIMIT 51`,
      uid,
      item.id,
      before,
    );
    return {
      post: enrich([item], uid)[0],
      author: person(item.author, uid),
      own: item.author === uid,
      comments: rows.slice(0, 50).reverse(),
      more: rows.length > 50,
    };
  });
  endpoint("post", "comment", (uid, q, b) => {
    const p = getPost(id(b.post), uid),
      text = body(b.body, 500),
      parent = b.parent ? id(b.parent) : null,
      reply =
        parent &&
        one(
          "SELECT author FROM comments WHERE id=? AND post_id=?",
          parent,
          p.id,
        );
    if (parent && !reply) fail("Reply not found.");
    run(
      "INSERT INTO comments(post_id,author,parent,body,created) VALUES(?,?,?,?,?)",
      p.id,
      uid,
      parent,
      text,
      Date.now(),
    );
    notify(p.author, uid, "comment", p.id);
    if (reply && reply.author !== p.author)
      notify(reply.author, uid, "reply", p.id);
    mentions(p.id, uid, text);
  });
  endpoint("post", "share", (uid, q, b) => {
    const p = getPost(id(b.post), uid);
    run("INSERT OR IGNORE INTO link_shares VALUES(?,?)", p.id, uid);
    return {
      shares: one("SELECT count(*) n FROM link_shares WHERE post_id=?", p.id).n,
    };
  });
  endpoint("post", "reel/view", (uid, q, b) => {
    const p = getPost(id(b.post), uid);
    if (
      !one(
        "SELECT 1 FROM post_media WHERE post_id=? AND type LIKE 'video/%'",
        p.id,
      )
    )
      fail("Reel not found.", 404);
    run("INSERT OR IGNORE INTO reel_views VALUES(?,?)", p.id, uid);
  });
  endpoint("post", "heart", (uid, q, b) => {
    const p = getPost(id(b.post), uid);
    if (typeof b.on !== "boolean") fail("Invalid selection.");
    if (b.comment) {
      const c = id(b.comment);
      if (!one("SELECT 1 FROM comments WHERE id=? AND post_id=?", c, p.id))
        fail("Comment unavailable.", 404);
      run(
        b.on
          ? "INSERT OR IGNORE INTO comment_hearts VALUES(?,?)"
          : "DELETE FROM comment_hearts WHERE comment=? AND actor=?",
        c,
        uid,
      );
    } else {
      const r = run(
        b.on
          ? "INSERT OR IGNORE INTO post_hearts VALUES(?,?)"
          : "DELETE FROM post_hearts WHERE post_id=? AND actor=?",
        p.id,
        uid,
      );
      if (
        b.on &&
        r.changes &&
        !one(
          "SELECT 1 FROM notices WHERE actor=? AND post_id=? AND kind='like'",
          uid,
          p.id,
        )
      )
        notify(p.author, uid, "like", p.id);
    }
  });
  endpoint("get", "notices", (uid) => ({
    notices: all(
      `SELECT n.*,a.name,a.founder,exists(SELECT 1 FROM follows WHERE follower=:uid AND followed=n.actor) following,coalesce(s.private,0) private FROM notices n JOIN feed_profiles a ON a.id=n.actor LEFT JOIN profile_settings s ON s.user_id=a.id WHERE recipient=:uid AND (post_id IS NULL OR EXISTS(SELECT 1 FROM posts p WHERE p.id=n.post_id AND ${visible})) ORDER BY n.id DESC LIMIT 100`,
      { uid },
    ),
  }));
  endpoint("post", "notices/read", (uid, q, b) => {
    if (b.all === true) run("UPDATE notices SET seen=1 WHERE recipient=?", uid);
    else
      run(
        "UPDATE notices SET seen=1 WHERE id=? AND recipient=?",
        id(b.id),
        uid,
      );
  });
  endpoint("get", "inbox", (uid, q) => {
    const term = String(q.q || "")
      .trim()
      .toLowerCase()
      .slice(0, 100);
    return {
      threads: all(
        `WITH mine AS (SELECT *,CASE WHEN sender=:uid THEN recipient ELSE sender END peer FROM messages WHERE sender=:uid OR recipient=:uid), latest AS (SELECT peer,max(id) id,sum(CASE WHEN recipient=:uid AND seen=0 THEN 1 ELSE 0 END) unread FROM mine GROUP BY peer) SELECT p.*,m.body,m.created,m.sender=:uid outgoing,l.unread FROM latest l JOIN mine m ON m.id=l.id JOIN feed_profiles p ON p.id=l.peer WHERE instr(lower(p.name||' '||coalesce(p.username,'')),:term) OR EXISTS(SELECT 1 FROM mine t WHERE t.peer=l.peer AND instr(lower(t.body),:term)) ORDER BY l.id DESC LIMIT 100`,
        { uid, term },
      ),
    };
  });
  endpoint("get", "thread/:peer", (uid, q, b, p) => {
    const peer = id(p.peer);
    if (peer === uid) fail("Choose another member.");
    const member = person(peer, uid),
      before = q.before ? id(q.before) : Number.MAX_SAFE_INTEGER;
    const rows = all(
      "SELECT id,body,created,sender,seen,exists(SELECT 1 FROM message_photos WHERE message=id) hasPhoto FROM messages WHERE ((recipient=? AND sender=?) OR (sender=? AND recipient=?)) AND id<? ORDER BY id DESC LIMIT 61",
      uid,
      peer,
      uid,
      peer,
      before,
    );
    return {
      member,
      messages: rows.slice(0, 60).reverse(),
      more: rows.length > 60,
    };
  });
  app.use("/api/feed/thread/:peer", express.json({ limit: "240kb" }));
  endpoint("post", "thread/:peer", (uid, q, b, p) => {
    const peer = id(p.peer);
    if (peer === uid) fail("Choose another member.");
    person(peer, uid);
    let photo = null;
    if (b.photo !== undefined) {
      if (
        typeof b.photo !== "string" ||
        b.photo.length > 230000 ||
        !b.photo.startsWith("/9j/")
      )
        fail("Invalid photo.");
      photo = Buffer.from(b.photo, "base64");
      if (!photo.subarray(-2).equals(Buffer.from([255, 217])))
        fail("Invalid photo.");
      if (
        one(
          "SELECT coalesce(sum(length(bytes)),0) used FROM message_photos JOIN messages ON message=id WHERE sender=?",
          uid,
        ).used +
          photo.length >
        64 * 1024 * 1024
      )
        fail("Message photo storage is full.", 413);
    }
    const result = run(
      "INSERT INTO messages(sender,recipient,body,created) VALUES(?,?,?,?)",
      uid,
      peer,
      photo && !b.body ? "" : body(b.body, 1000),
      Date.now(),
    );
    if (photo)
      run(
        "INSERT INTO message_photos VALUES(?,?)",
        result.lastInsertRowid,
        photo,
      );
  });
  app.get("/api/feed/message-photo/:id", (req, res) => {
    const uid = res.locals.uid,
      row = one(
        "SELECT bytes FROM message_photos JOIN messages ON message=id WHERE id=? AND (sender=? OR recipient=?)",
        Number(req.params.id),
        uid,
        uid,
      );
    if (!row) return res.sendStatus(404);
    res
      .set("Content-Security-Policy", "default-src 'none'; sandbox")
      .type("image/jpeg")
      .send(Buffer.from(row.bytes));
  });
  // Mark only messages actually delivered to the signed-in recipient as read.
  app.post("/api/feed/thread/:peer/read", limit, (req, res) => {
    const peer = Number(req.params.peer),
      through = Number(req.body?.through);
    if (!Number.isSafeInteger(peer) || !Number.isSafeInteger(through))
      return res.sendStatus(400);
    run(
      "UPDATE messages SET seen=1 WHERE recipient=? AND sender=? AND id<=? AND seen=0",
      res.locals.uid,
      peer,
      through,
    );
    res.json({ ok: true });
  });
  return mentions;
}
