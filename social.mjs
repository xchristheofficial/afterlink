import { installLiveEvents } from "./live-events.mjs";
import { installMessageActions } from "./message-actions.mjs";
import { installDmMedia } from "./dm-media.mjs";
import { installCalls } from "./calls.mjs";
import { installLinkbacks } from "./linkbacks.mjs";
import { installMemberSettings } from "./member-settings.mjs";
import { separated, muted } from "./visibility.mjs";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { visiblePost } from "./composer.mjs";

export function installSocial(app, db, enrich, session) {
  const wake = installLiveEvents(app, session);
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
    CREATE INDEX IF NOT EXISTS unread_dm ON messages(recipient,sender) WHERE seen=0;
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
  const selection = `SELECT p.*,a.name,a.username,a.founder,(SELECT count(*) FROM link_shares WHERE post_id=p.id) shares,(SELECT count(*) FROM saved_posts WHERE post_id=p.id) saves,(SELECT count(*) FROM reel_views WHERE post_id=p.id) views,(SELECT count(*) FROM post_hearts WHERE post_id=p.id) likes,exists(SELECT 1 FROM post_hearts WHERE post_id=p.id AND actor=:uid) liked,(SELECT count(*) FROM comments c WHERE c.post_id=p.id AND NOT ${separated(":uid", "c.author")}) comments,exists(SELECT 1 FROM saved_posts WHERE post_id=p.id AND user_id=:uid) saved FROM posts p JOIN feed_profiles a ON a.id=p.author WHERE ${visible}`;
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
  const { prefs, hidden, allowedDM } = installMemberSettings(app, db, {
    endpoint,
    one,
    all,
    run,
    id,
    body,
    fail,
    person,
    getPost,
    enrich,
  });
  const { parseMedia, checkQuota } = installDmMedia(app, db, {
    wake,
    endpoint,
    id,
    fail,
    one,
    run,
  });
  app.post("/api/feed/calls", express.json({ limit: "72kb" }));
  db.exec(
    `CREATE TABLE IF NOT EXISTS dm_nicknames(owner INTEGER REFERENCES users(id) ON DELETE CASCADE,peer INTEGER REFERENCES users(id) ON DELETE CASCADE,nickname TEXT NOT NULL,PRIMARY KEY(owner,peer))`,
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS inbox_pins(owner INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,peer INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(owner,peer))`,
  );
  endpoint("post", "inbox-pin/:peer", (uid, q, b, p) => {
    const peer = id(p.peer);
    if (
      hidden(uid, peer) ||
      !one(
        "SELECT 1 FROM messages WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?) LIMIT 1",
        uid,
        peer,
        peer,
        uid,
      )
    )
      fail("Conversation unavailable.", 404);
    if (typeof b.pinned !== "boolean") fail("Choose a pin state.");
    if (b.pinned)
      run(
        "INSERT OR IGNORE INTO inbox_pins(owner,peer) VALUES(?,?)",
        uid,
        peer,
      );
    else run("DELETE FROM inbox_pins WHERE owner=? AND peer=?", uid, peer);
    wake("chat", uid);
  });
  const nickname = (uid, peer) =>
    one("SELECT nickname FROM dm_nicknames WHERE owner=? AND peer=?", uid, peer)
      ?.nickname || "";
  endpoint("post", "nickname/:peer", (uid, q, b, p) => {
    const peer = id(p.peer);
    if (peer === uid || hidden(uid, peer))
      fail("Conversation unavailable.", 403);
    person(peer, uid);
    if (typeof b.nickname !== "string" || b.nickname.length > 40)
      fail("Use up to 40 characters.");
    const value = b.nickname.trim();
    if (value)
      run(
        "INSERT OR REPLACE INTO dm_nicknames VALUES(?,?,?)",
        uid,
        peer,
        value,
      );
    else run("DELETE FROM dm_nicknames WHERE owner=? AND peer=?", uid, peer);
    wake("chat", uid);
  });
  installCalls({ endpoint, id, fail, person, allowedDM, wake, nickname });
  const { select, target } = installMessageActions(db, {
    endpoint,
    id,
    fail,
    run,
    one,
    all,
    person,
    hidden,
    allowedDM,
    wake,
    checkQuota,
  });
  const groupCounts = installLinkbacks(db, {
    wake,
    endpoint,
    one,
    all,
    run,
    id,
    body,
    fail,
    allowedDM,
  });
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
        (prefs(member.id).mentions === "everyone" ||
          one(
            "SELECT 1 FROM follows WHERE follower=? AND followed=?",
            actor,
            member.id,
          )) &&
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
        ` AND NOT ${muted(":uid", "p.author")} AND (instr(lower(p.body),:term) OR instr(lower(a.name),:term) OR instr(lower(coalesce(a.username,'')),:term) OR instr(lower(coalesce(json_extract(p.details,'$.location'),'')),:term)) ${kind === "reels" ? "AND EXISTS(SELECT 1 FROM post_media WHERE post_id=p.id AND type LIKE 'video/%')" : ""} ORDER BY p.id DESC LIMIT 51`,
      { uid, term },
    );
    return { posts: enrich(rows.slice(0, 50), uid), more: rows.length > 50 };
  });
  endpoint("get", "post/:id", (uid, q, b, p) => {
    const item = getPost(id(p.id), uid),
      before = q.before ? id(q.before) : Number.MAX_SAFE_INTEGER;
    const rows = all(
      `SELECT c.*,a.name,a.username,a.founder,pa.name parentName,(SELECT count(*) FROM comment_hearts WHERE comment=c.id) likes,exists(SELECT 1 FROM comment_hearts WHERE comment=c.id AND actor=:uid) liked FROM comments c JOIN feed_profiles a ON a.id=c.author LEFT JOIN comments pc ON pc.id=c.parent LEFT JOIN feed_profiles pa ON pa.id=pc.author AND NOT ${separated(":uid", "pc.author")} WHERE c.post_id=:post AND c.id<:before AND NOT ${separated(":uid", "c.author")} ORDER BY c.id DESC LIMIT 51`,
      { uid, post: item.id, before },
    );
    return {
      post: enrich([item], uid)[0],
      author: person(item.author, uid),
      own: item.author === uid,
      downloadable:
        item.author === uid ||
        (prefs(item.author).downloads &&
          item.audience === "everyone" &&
          !one(
            "SELECT 1 FROM profile_settings WHERE user_id=? AND private=1",
            item.author,
          )),
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
    if (parent && (!reply || hidden(uid, reply.author)))
      fail("Reply not found.");
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
      if (
        !one(
          `SELECT 1 FROM comments c WHERE c.id=:c AND c.post_id=:post AND NOT ${separated(":uid", "c.author")}`,
          { c, post: p.id, uid },
        )
      )
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
  const visibleNotice = `recipient=:uid AND NOT ${separated(":uid", "n.actor")} AND (post_id IS NULL OR EXISTS(SELECT 1 FROM posts p WHERE p.id=n.post_id AND ${visible}))`;
  endpoint("get", "unread", (uid) => {
    const counts = one(
      `SELECT (SELECT count(*) FROM messages WHERE recipient=:uid AND seen=0 AND NOT ${separated(":uid", "sender")}) chats,(SELECT count(*) FROM notices n WHERE seen=0 AND ${visibleNotice}) notifications`,
      { uid },
    );
    Object.assign(counts, groupCounts(uid));
    return {
      ...counts,
      messages: counts.chats + counts.groups + counts.linkbacks,
    };
  });
  endpoint("get", "notices", (uid) => ({
    notices: all(
      `SELECT n.*,a.name,a.founder,exists(SELECT 1 FROM follows WHERE follower=:uid AND followed=n.actor) following,coalesce(s.private,0) private FROM notices n JOIN feed_profiles a ON a.id=n.actor LEFT JOIN profile_settings s ON s.user_id=a.id WHERE ${visibleNotice} ORDER BY n.id DESC LIMIT 100`,
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
        `WITH mine AS (SELECT *,CASE WHEN sender=:uid THEN recipient ELSE sender END peer FROM messages WHERE sender=:uid OR recipient=:uid), latest AS (SELECT peer,max(id) id,sum(CASE WHEN recipient=:uid AND seen=0 THEN 1 ELSE 0 END) unread FROM mine GROUP BY peer) SELECT p.*,nn.nickname,ip.peer IS NOT NULL pinnedChat,m.body,m.removed,(SELECT type FROM dm_media WHERE message=m.id) mediaType,m.created,m.sender=:uid outgoing,l.unread FROM latest l JOIN mine m ON m.id=l.id JOIN feed_profiles p ON p.id=l.peer LEFT JOIN dm_nicknames nn ON nn.owner=:uid AND nn.peer=p.id LEFT JOIN inbox_pins ip ON ip.owner=:uid AND ip.peer=p.id WHERE (:unread=0 OR l.unread>0) AND NOT ${separated(":uid", "l.peer")} AND (instr(lower(p.name||' '||coalesce(p.username,'')||' '||coalesce(nn.nickname,'')),:term) OR EXISTS(SELECT 1 FROM mine t WHERE t.peer=l.peer AND instr(lower(t.body),:term))) ORDER BY pinnedChat DESC,l.id DESC LIMIT 100`,
        { uid, term, unread: Number(q.view === "unread") },
      ),
    };
  });
  // Short-lived presence only: never persist a draft or transmit its content.
  const typing = new Map();
  setInterval(() => {
    for (const [key, t] of typing)
      if (t.until <= Date.now()) typing.delete(key);
  }, 6000).unref();
  const canType = (from, to) =>
    from !== to &&
    allowedDM(from, to) &&
    prefs(from).typing &&
    prefs(to).typing;
  const typingPath = "/api/feed/typing/:peer";
  app.post(
    typingPath,
    rateLimit({
      windowMs: 60000,
      limit: 60,
      keyGenerator: (_req, res) => String(res.locals.uid),
    }),
    (req, res) => {
      const uid = res.locals.uid,
        peer = Number(req.params.peer);
      if (
        !Number.isSafeInteger(peer) ||
        !one("SELECT id FROM feed_profiles WHERE id=?", peer) ||
        !canType(uid, peer)
      )
        return res.json({ ok: true });
      if (req.body?.active === true) {
        typing.set(uid, { peer, until: Date.now() + 5000 });
        wake("typing", peer);
      } else if (typing.get(uid)?.peer === peer) {
        typing.delete(uid);
        wake("typing", peer);
      }
      res.json({ ok: true });
    },
  );
  endpoint("get", "typing/:peer", (uid, q, b, p) => {
    const peer = id(p.peer),
      t = typing.get(peer);
    return {
      remaining:
        t?.peer === uid && canType(peer, uid)
          ? Math.max(0, t.until - Date.now())
          : 0,
    };
  });
  endpoint("get", "thread/:peer", (uid, q, b, p) => {
    const peer = id(p.peer);
    if (peer === uid) fail("Choose another member.");
    if (hidden(peer, uid)) fail("Conversation unavailable.", 403);
    const member = person(peer, uid),
      before = q.before ? id(q.before) : Number.MAX_SAFE_INTEGER;
    const rows = all(
      select +
        " WHERE ((m.recipient=? AND m.sender=?) OR (m.sender=? AND m.recipient=?)) AND m.id<? ORDER BY m.id DESC LIMIT 61",
      uid,
      peer,
      uid,
      peer,
      before,
    );
    return {
      viewer: uid,
      member: {
        ...member,
        nickname: nickname(uid, peer),
        pinnedChat: !!one(
          "SELECT 1 FROM inbox_pins WHERE owner=? AND peer=?",
          uid,
          peer,
        ),
      },
      ...(q.opening === "1"
        ? {
            firstUnread: one(
              "SELECT min(id) n FROM messages WHERE recipient=? AND sender=? AND seen=0",
              uid,
              peer,
            ).n,
          }
        : {}),
      pin:
        one(
          "SELECT id,body FROM messages WHERE pinned=1 AND ((sender=? AND recipient=?) OR (sender=? AND recipient=?))",
          uid,
          peer,
          peer,
          uid,
        ) || null,
      active: !!(
        prefs(uid).activity &&
        prefs(peer).activity &&
        one(
          "SELECT 1 FROM last_activity WHERE owner=? AND seen>?",
          peer,
          Date.now() - 90000,
        )
      ),
      messages: rows.slice(0, 60).reverse(),
      more: rows.length > 60,
    };
  });
  app.use("/api/feed/thread/:peer", express.json({ limit: "6mb" }));
  endpoint("post", "thread/:peer", (uid, q, b, p) => {
    const peer = id(p.peer);
    if (peer === uid) fail("Choose another member.");
    person(peer, uid);
    if (!allowedDM(uid, peer))
      fail("This member is not accepting messages from you.", 403);
    if (b.expectedSender !== undefined && b.expectedSender !== uid)
      fail("Your account changed. Reload this conversation.", 409);
    const token = b.clientId ?? null;
    if (token !== null) {
      if (typeof token !== "string" || !/^[-a-zA-Z0-9]{16,64}$/.test(token))
        fail("Invalid message token.");
      const prior = one(
        select + " WHERE m.sender=? AND m.recipient=? AND m.client_token=?",
        uid,
        peer,
        token,
      );
      if (prior) return { message: prior };
    }
    if (b.media !== undefined && b.photo !== undefined)
      fail("Choose one attachment.");
    const media = b.media === undefined ? null : parseMedia(b.media, uid);
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
      checkQuota(uid, photo.length);
    }
    let reply = null;
    if (b.replyTo) {
      const m = target(uid, b.replyTo);
      if (![m.sender, m.recipient].includes(peer))
        fail("Reply must be in this conversation.");
      reply = m.id;
    }
    const result = run(
      "INSERT INTO messages(sender,recipient,body,created,reply_to,client_token) VALUES(?,?,?,?,?,?)",
      uid,
      peer,
      (photo || media) && !b.body ? "" : body(b.body, 1000),
      Date.now(),
      reply,
      token,
    );
    if (media)
      run(
        "INSERT INTO dm_media(message,type,once_only,bytes) VALUES(?,?,?,?)",
        result.lastInsertRowid,
        media.type,
        media.once,
        media.bytes,
      );
    if (photo)
      run(
        "INSERT INTO message_photos VALUES(?,?)",
        result.lastInsertRowid,
        photo,
      );
    if (typing.get(uid)?.peer === peer) {
      typing.delete(uid);
      wake("typing", peer);
    }
    wake("chat", peer, uid);
    return { message: one(select + " WHERE m.id=?", result.lastInsertRowid) };
  });
  app.get("/api/feed/message-photo/:id", (req, res) => {
    const uid = res.locals.uid,
      row = one(
        `SELECT bytes FROM message_photos JOIN messages ON message=id WHERE id=? AND (sender=? OR recipient=?) AND NOT ${separated("sender", "recipient")}`,
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
    if (hidden(res.locals.uid, peer)) return res.sendStatus(403);
    run(
      "UPDATE messages SET seen=1 WHERE recipient=? AND sender=? AND id<=? AND seen=0",
      res.locals.uid,
      peer,
      through,
    );
    wake("read", peer);
    res.json({ ok: true });
  });
  return mentions;
}
