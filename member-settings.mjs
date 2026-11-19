import express from "express";
import { mediaType, visiblePost } from "./composer.mjs";
import { muted, separated } from "./visibility.mjs";
const rules = {
  messages: ["everyone", "followers", "none"],
  mentions: ["everyone", "followers"],
  stories: ["everyone", "followers"],
  theme: ["system", "light", "dark"],
  accent: ["purple", "blue", "green", "orange", "rose"],
  activity: [false, true],
  downloads: [false, true],
  reduce: [false, true],
  autoplay: [false, true],
  autoReels: [false, true],
  follow: [true, false],
  mention: [true, false],
  comment: [true, false],
  like: [true, false],
  message: [true, false],
  reel: [false, true],
};
export function installMemberSettings(
  app,
  db,
  { endpoint, one, all, run, id, body, fail, person, getPost, enrich },
) {
  const user = "INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE";
  db.exec(`CREATE TABLE IF NOT EXISTS preferences(owner INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS last_activity(owner INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,seen INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS restrictions(owner ${user},target ${user},kind TEXT NOT NULL,PRIMARY KEY(owner,target,kind));
 CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY,owner ${user},target ${user},post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,reason TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS collections(id INTEGER PRIMARY KEY,owner ${user},name TEXT NOT NULL COLLATE NOCASE,UNIQUE(owner,name));
 CREATE TABLE IF NOT EXISTS collected(collection INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,owner INTEGER NOT NULL,post INTEGER NOT NULL,PRIMARY KEY(collection,post),FOREIGN KEY(owner,post) REFERENCES saved_posts(user_id,post_id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS stories(id INTEGER PRIMARY KEY AUTOINCREMENT,author ${user},created INTEGER NOT NULL,template TEXT,type TEXT,bytes BLOB,caption TEXT NOT NULL,audience TEXT NOT NULL,replies INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS story_friends(story INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,friend ${user},PRIMARY KEY(story,friend));
 CREATE TRIGGER IF NOT EXISTS preference_notice BEFORE INSERT ON notices WHEN coalesce(json_extract((SELECT data FROM preferences WHERE owner=new.recipient),'$.'||CASE new.kind WHEN 'reply' THEN 'comment' ELSE new.kind END),CASE new.kind WHEN 'reel' THEN 0 ELSE 1 END)=0 OR ${separated("new.actor", "new.recipient")} BEGIN SELECT RAISE(IGNORE); END;
 CREATE TRIGGER IF NOT EXISTS message_notice AFTER INSERT ON messages BEGIN INSERT INTO notices(recipient,actor,kind,created) VALUES(new.recipient,new.sender,'message',new.created);END;
 CREATE TRIGGER IF NOT EXISTS reel_notice AFTER INSERT ON post_media WHEN new.type LIKE 'video/%' BEGIN INSERT INTO notices(recipient,actor,kind,post_id,created) SELECT f.follower,p.author,'reel',p.id,p.created FROM posts p JOIN follows f ON f.followed=p.author JOIN preferences s ON s.owner=f.follower WHERE p.id=new.post_id AND json_extract(s.data,'$.reel')=1; END;`);
  const prefs = (uid) =>
    Object.assign(
      Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, v[0]])),
      JSON.parse(
        one("SELECT data FROM preferences WHERE owner=?", uid)?.data || "{}",
      ),
    );
  const hidden = (a, b) =>
    one(`SELECT ${separated(":a", ":b")} hide`, { a, b }).hide;
  const allowedDM = (from, to) =>
    !hidden(from, to) &&
    (prefs(to).messages === "everyone" ||
      (prefs(to).messages === "followers" &&
        one(
          "SELECT 1 FROM follows WHERE follower=? AND followed=?",
          from,
          to,
        )));
  endpoint("get", "settings", (uid) => ({
    prefs: prefs(uid),
    private: !!one("SELECT private FROM profile_settings WHERE user_id=?", uid)
      ?.private,
    id: uid,
    restricted: all(
      "SELECT p.id,p.name,p.founder,r.kind FROM restrictions r JOIN feed_profiles p ON p.id=r.target WHERE owner=?",
      uid,
    ),
  }));
  endpoint("post", "settings", (uid, q, b) => {
    const next = prefs(uid);
    for (const [k, v] of Object.entries(b)) {
      if (k === "private" && typeof v === "boolean") {
        run(
          "INSERT INTO profile_settings(user_id,private) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET private=excluded.private",
          uid,
          +v,
        );
        continue;
      }
      if (!Object.hasOwn(rules, k) || !rules[k].includes(v))
        fail("Invalid preference.");
      next[k] = v;
    }
    run(
      "INSERT OR REPLACE INTO preferences VALUES(?,?)",
      uid,
      JSON.stringify(next),
    );
  });
  endpoint("post", "restrict", (uid, q, b) => {
    const target = id(b.id);
    if (
      target === uid ||
      !one("SELECT id FROM users WHERE id=?", target) ||
      !["block", "mute"].includes(b.kind) ||
      typeof b.on !== "boolean"
    )
      fail("Choose another member.");
    run(
      b.on
        ? "INSERT OR IGNORE INTO restrictions VALUES(?,?,?)"
        : "DELETE FROM restrictions WHERE owner=? AND target=? AND kind=?",
      uid,
      target,
      b.kind,
    );
    if (b.kind === "block" && b.on)
      run(
        "DELETE FROM follows WHERE (follower=? AND followed=?) OR (follower=? AND followed=?)",
        uid,
        target,
        target,
        uid,
      );
  });
  endpoint("post", "report", (uid, q, b) => {
    const target = id(b.id);
    person(target, uid);
    if (
      target === uid ||
      ![
        "Spam",
        "Harassment",
        "Inappropriate Content",
        "Misinformation",
      ].includes(b.reason)
    )
      fail("Select a reason.");
    if (b.post && getPost(id(b.post), uid).author !== target)
      fail("Post unavailable.");
    run(
      "INSERT INTO reports(owner,target,post_id,reason,created) VALUES(?,?,?,?,?)",
      uid,
      target,
      b.post || null,
      b.reason,
      Date.now(),
    );
  });
  endpoint("get", "connections", (uid, q) => {
    const who = id(q.id || uid),
      p = person(who, uid);
    if (hidden(uid, who)) fail("Profile unavailable.", 404);
    const data = {};
    for (const [key, from, to] of [
      ["Followers", "followed", "follower"],
      ["Following", "follower", "followed"],
    ])
      data[key] = all(
        `SELECT p.*,coalesce(s.private,0) private,exists(SELECT 1 FROM follows WHERE follower=:uid AND followed=p.id) following FROM follows f JOIN feed_profiles p ON p.id=f.${to} LEFT JOIN profile_settings s ON s.user_id=p.id WHERE f.${from}=:who AND NOT ${separated(":uid", "p.id")} ORDER BY p.name`,
        { who, uid },
      );
    return { member: p, uid, ...data };
  });
  endpoint("get", "library", (uid) => ({
    posts: enrich(
      all(
        `SELECT p.*,a.name FROM posts p JOIN saved_posts s ON s.post_id=p.id JOIN feed_profiles a ON a.id=p.author WHERE s.user_id=:uid AND ${visiblePost("p", ":uid")} ORDER BY s.rowid DESC`,
        { uid },
      ),
      uid,
    ),
    collections: all(
      "SELECT id,name FROM collections WHERE owner=? ORDER BY id",
      uid,
    ),
    links: all(
      `SELECT c.collection,c.post FROM collected c JOIN posts p ON p.id=c.post WHERE owner=:uid AND ${visiblePost("p", ":uid")}`,
      { uid },
    ),
  }));
  endpoint("post", "collection", (uid, q, b) => {
    if (!b.id) {
      const title = body(b.name, 50);
      if (
        !run(
          "INSERT OR IGNORE INTO collections(owner,name) VALUES(?,?)",
          uid,
          title,
        ).changes
      )
        fail("A collection already has that name.");
      return;
    }
    const col = id(b.id);
    if (!one("SELECT 1 FROM collections WHERE id=? AND owner=?", col, uid))
      fail("Collection unavailable.", 404);
    const pid = id(b.post);
    getPost(pid, uid);
    if (
      !one("SELECT 1 FROM saved_posts WHERE user_id=? AND post_id=?", uid, pid)
    )
      fail("Save this post first.");
    run(
      b.on
        ? "INSERT OR IGNORE INTO collected VALUES(?,?,?)"
        : "DELETE FROM collected WHERE collection=? AND owner=? AND post=?",
      col,
      uid,
      pid,
    );
  });
  const storyScope = `s.created>:since AND NOT ${separated("s.author", ":uid")} AND (s.author=:uid OR ((s.audience='everyone' OR EXISTS(SELECT 1 FROM follows WHERE follower=:uid AND followed=s.author)) AND (s.audience<>'friends' OR EXISTS(SELECT 1 FROM story_friends WHERE story=s.id AND friend=:uid)) AND (EXISTS(SELECT 1 FROM follows WHERE follower=:uid AND followed=s.author) OR (coalesce((SELECT private FROM profile_settings WHERE user_id=s.author),0)=0 AND coalesce(json_extract((SELECT data FROM preferences WHERE owner=s.author),'$.stories'),'everyone')='everyone'))))`;
  const args = (uid) => ({ uid, since: Date.now() - 86400000 });
  endpoint("get", "stories", (uid) => ({
    uid,
    stories: all(
      `SELECT s.id,s.author,s.type,s.created,s.template,s.caption,s.replies,p.name,p.founder FROM stories s JOIN feed_profiles p ON p.id=s.author WHERE ${storyScope} AND NOT ${muted(":uid", "s.author")} ORDER BY s.id DESC LIMIT 150`,
      args(uid),
    ),
  }));
  app.use("/api/feed/stories", express.json({ limit: "11mb" }));
  endpoint("post", "stories", (uid, q, b) => {
    run("DELETE FROM stories WHERE created<=?", Date.now() - 86400000);
    if (one("SELECT count(*) n FROM stories WHERE author=?", uid).n >= 12)
      fail("You can share 12 stories per day.");
    const template = b.template || null,
      bytes = template
        ? null
        : Buffer.from(typeof b.file === "string" ? b.file : "", "base64"),
      type = bytes && mediaType(bytes);
    if (
      template
        ? !["Mountains", "Forest", "Lake", "Beach", "City", "Desert"].includes(
            template,
          )
        : !type || bytes.length > 8388608
    )
      fail("Choose a template or supported photo/video under 8 MB.");
    if (
      typeof b.caption !== "string" ||
      b.caption.length > 220 ||
      !["everyone", "followers", "friends"].includes(b.audience) ||
      typeof b.replies !== "boolean"
    )
      fail("Invalid story details.");
    const r = run(
      "INSERT INTO stories(author,created,template,type,bytes,caption,audience,replies) VALUES(?,?,?,?,?,?,?,?)",
      uid,
      Date.now(),
      template,
      type,
      bytes,
      b.caption,
      b.audience,
      +b.replies,
    );
    if (b.audience === "friends") {
      if (
        !Array.isArray(b.friends) ||
        !b.friends.length ||
        b.friends.length > 100
      )
        fail("Select 1–100 followers.");
      for (const f of b.friends) {
        if (
          !one(
            "SELECT 1 FROM follows WHERE followed=? AND follower=?",
            uid,
            id(f),
          )
        )
          fail("Choose a current follower.");
        run(
          "INSERT OR IGNORE INTO story_friends VALUES(?,?)",
          r.lastInsertRowid,
          f,
        );
      }
    }
    return { id: Number(r.lastInsertRowid) };
  });
  app.get("/api/feed/story-media/:id", (req, res) => {
    const row = one(
      `SELECT s.bytes,s.type FROM stories s WHERE s.id=:id AND ${storyScope}`,
      { ...args(res.locals.uid), id: Number(req.params.id) },
    );
    if (!row?.bytes) return res.sendStatus(404);
    res
      .set("Content-Security-Policy", "sandbox; default-src 'none'")
      .type(row.type)
      .send(Buffer.from(row.bytes));
  });
  endpoint("post", "story-reply", (uid, q, b) => {
    const s = one(
      `SELECT s.author,s.replies FROM stories s WHERE s.id=:id AND ${storyScope}`,
      { ...args(uid), id: id(b.id) },
    );
    if (!s?.replies || s.author === uid || !allowedDM(uid, s.author))
      fail("Replies are unavailable.", 403);
    run(
      "INSERT INTO messages(sender,recipient,body,created) VALUES(?,?,?,?)",
      uid,
      s.author,
      "Story reply: " + body(b.body, 500),
      Date.now(),
    );
  });
  const purge = () =>
    run("DELETE FROM stories WHERE created<=?", Date.now() - 86400000);
  purge();
  setInterval(purge, 3600000).unref();
  return { prefs, hidden, allowedDM };
}
