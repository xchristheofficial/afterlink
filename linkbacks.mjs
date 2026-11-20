import { visiblePost } from "./composer.mjs";
import { separated } from "./visibility.mjs";

export function installLinkbacks(
  db,
  { one, all, run, id, body, fail, endpoint, allowedDM, wake },
) {
  db.exec(`CREATE TABLE IF NOT EXISTS linkbacks(id INTEGER PRIMARY KEY AUTOINCREMENT,post INTEGER REFERENCES posts(id) ON DELETE SET NULL,updated INTEGER NOT NULL,pin INTEGER REFERENCES lb_messages(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS lb_members(gid INTEGER NOT NULL REFERENCES linkbacks(id) ON DELETE CASCADE,uid INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,inviter INTEGER REFERENCES users(id) ON DELETE SET NULL,invited INTEGER NOT NULL,joined INTEGER,PRIMARY KEY(gid,uid));
    CREATE INDEX IF NOT EXISTS lb_inbox ON lb_members(uid,gid);
    CREATE TABLE IF NOT EXISTS lb_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,gid INTEGER NOT NULL REFERENCES linkbacks(id) ON DELETE CASCADE,author INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS lb_history ON lb_messages(gid,id);
    CREATE TRIGGER IF NOT EXISTS lb_cleanup AFTER DELETE ON lb_members BEGIN
      DELETE FROM linkbacks WHERE id=old.gid AND NOT EXISTS(SELECT 1 FROM lb_members WHERE gid=old.gid AND joined IS NOT NULL);
      DELETE FROM lb_members WHERE gid=old.gid AND inviter=old.uid AND joined IS NULL;
    END;
    CREATE TRIGGER IF NOT EXISTS lb_block AFTER INSERT ON restrictions WHEN new.kind='block' BEGIN
      DELETE FROM lb_members WHERE uid=new.owner AND gid IN(SELECT gid FROM lb_members WHERE uid=new.target);
    END;`);
  if (!all("PRAGMA table_info(linkbacks)").some((c) => c.name === "group_name"))
    db.exec("ALTER TABLE linkbacks ADD COLUMN group_name TEXT");
  function changed(gid, ...extra) {
    wake(
      "group",
      ...extra,
      ...all("SELECT uid FROM lb_members WHERE gid=?", gid).map((m) => m.uid),
    );
  }
  const deny = () => fail("Linkback unavailable.", 404);
  const group = (gid, uid) =>
    one(
      `SELECT g.*,m.joined,m.invited,m.inviter FROM linkbacks g JOIN lb_members m ON m.gid=g.id WHERE g.id=? AND m.uid=?`,
      gid,
      uid,
    ) || deny();
  const admin = (gid) =>
    one(
      "SELECT uid FROM lb_members WHERE gid=? AND joined IS NOT NULL ORDER BY joined,uid LIMIT 1",
      gid,
    )?.uid;
  // Never store a copy of the post: even pending invitations must obey its current audience.
  const preview = (pid, uid) =>
    (pid &&
      one(
        `SELECT p.id,p.body,a.name,(SELECT id FROM post_media WHERE post_id=p.id ORDER BY id LIMIT 1) media,(SELECT type FROM post_media WHERE post_id=p.id ORDER BY id LIMIT 1) type FROM posts p JOIN feed_profiles a ON a.id=p.author WHERE p.id=:pid AND ${visiblePost("p", ":uid")}`,
        { pid, uid },
      )) ||
    null;
  const msgSelect = `SELECT m.id,m.body,m.created,m.author,p.name FROM lb_messages m JOIN feed_profiles p ON p.id=m.author WHERE m.gid=:gid AND NOT ${separated("m.author", ":uid")}`;
  function summary(g, uid) {
    const shared = {
      id: g.id,
      groupName: g.group_name,
      post: preview(g.post, uid),
      pending: g.joined === null,
      updated: g.joined === null ? g.invited : g.updated,
    };
    if (shared.pending)
      return {
        ...shared,
        invited: g.invited,
        from: one("SELECT id,name FROM feed_profiles WHERE id=?", g.inviter),
      };
    const a = { gid: g.id, uid };
    return {
      ...shared,
      count: one(
        "SELECT count(*) n FROM lb_members WHERE gid=? AND joined IS NOT NULL",
        g.id,
      ).n,
      latest: one(msgSelect + " ORDER BY m.id DESC LIMIT 1", a) || null,
      decision: g.pin
        ? one(msgSelect + " AND m.id=:pin", { ...a, pin: g.pin }) || null
        : null,
    };
  }
  function invite(gid, uid, ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 20)
      fail("Choose up to 20 people.");
    const targets = [...new Set(ids.map(id))];
    if (
      one("SELECT count(*) n FROM lb_members WHERE gid=?", gid).n +
        targets.length >
      30
    )
      fail("This Linkback is full.");
    for (const t of targets) {
      if (
        !one("SELECT id FROM users WHERE id=?", t) ||
        !allowedDM(uid, t) ||
        one(
          `SELECT 1 FROM lb_members m WHERE gid=:gid AND (uid=:t OR ${separated("m.uid", ":t")})`,
          { gid, t },
        )
      )
        fail("One of these members cannot be invited.", 403);
      run(
        "INSERT INTO lb_members VALUES(?,?,?,?,NULL)",
        gid,
        t,
        uid,
        Date.now(),
      );
    }
  }
  const addMessage = (gid, uid, text) =>
    run(
      "INSERT INTO lb_messages(gid,author,body,created) VALUES(?,?,?,?)",
      gid,
      uid,
      body(text, 1000),
      Date.now(),
    );
  endpoint("post", "groups", (uid, q, b) => {
    const name = body(b.name, 60),
      now = Date.now(),
      gid = Number(
        run("INSERT INTO linkbacks(group_name,updated) VALUES(?,?)", name, now)
          .lastInsertRowid,
      );
    run("INSERT INTO lb_members VALUES(?,?,NULL,?,?)", gid, uid, now, now);
    invite(gid, uid, b.people);
    changed(gid);
    return { id: gid };
  });
  endpoint("post", "linkbacks", (uid, q, b) => {
    const pid = id(b.post);
    if (!preview(pid, uid)) fail("Post unavailable.", 404);
    const now = Date.now(),
      gid = Number(
        run("INSERT INTO linkbacks(post,updated) VALUES(?,?)", pid, now)
          .lastInsertRowid,
      );
    run("INSERT INTO lb_members VALUES(?,?,NULL,?,?)", gid, uid, now, now);
    invite(gid, uid, b.people);
    if (b.message) addMessage(gid, uid, b.message);
    return { id: gid };
  });
  endpoint("get", "linkbacks", (uid, q) => {
    const filter = q.post ? id(q.post) : null;
    if (filter && !preview(filter, uid)) fail("Post unavailable.", 404);
    return {
      groups: all(
        `SELECT g.*,m.joined,m.invited,m.inviter FROM lb_members m JOIN linkbacks g ON m.gid=g.id WHERE m.uid=? AND (g.group_name IS NOT NULL)=? AND (? IS NULL OR g.post=?) ORDER BY CASE WHEN m.joined IS NULL THEN m.invited ELSE g.updated END DESC,g.id DESC LIMIT 100`,
        uid,
        q.kind === "groups" ? 1 : 0,
        filter,
        filter,
      ).map((g) => summary(g, uid)),
    };
  });
  endpoint("get", "linkbacks/:gid", (uid, q, b, p) => {
    const gid = id(p.gid),
      g = group(gid, uid),
      s = summary(g, uid);
    if (s.pending) return s;
    return {
      ...s,
      uid,
      admin: admin(gid),
      members: all(
        "SELECT p.id,p.name,m.joined FROM lb_members m JOIN feed_profiles p ON p.id=m.uid WHERE gid=? ORDER BY joined IS NULL,joined,p.name",
        gid,
      ),
      messages: all(
        msgSelect + " AND m.id<:before ORDER BY m.id DESC LIMIT 60",
        { gid, uid, before: q.before ? id(q.before) : Number.MAX_SAFE_INTEGER },
      ).reverse(),
    };
  });
  endpoint("post", "linkbacks/:gid", (uid, q, b, p) => {
    const gid = id(p.gid),
      g = group(gid, uid);
    if (b.action === "leave") {
      run("DELETE FROM lb_members WHERE gid=? AND uid=?", gid, uid);
      if (g.group_name) changed(gid, uid);
      return;
    }
    if (g.joined === null) {
      if (b.action !== "accept" || !g.inviter || !allowedDM(g.inviter, uid))
        fail("Invitation unavailable.", 403);
      run(
        "UPDATE lb_members SET joined=? WHERE gid=? AND uid=?",
        Math.max(
          Date.now(),
          1 + one("SELECT max(joined) n FROM lb_members WHERE gid=?", gid).n,
        ),
        gid,
        uid,
      );
    } else if (b.action === "message") addMessage(gid, uid, b.message);
    else if (b.action === "pin") {
      const pin = b.message === null ? null : id(b.message);
      if (pin && !one(msgSelect + " AND m.id=:pin", { gid, uid, pin }))
        fail("Message unavailable.");
      run("UPDATE linkbacks SET pin=? WHERE id=?", pin, gid);
    } else {
      if (uid !== admin(gid))
        fail("Only the admin can manage invitations and members.", 403);
      if (b.action === "invite") invite(gid, uid, b.people);
      else if (b.action === "remove" && id(b.member) !== uid)
        run("DELETE FROM lb_members WHERE gid=? AND uid=?", gid, b.member);
      else if (b.action === "resend" && allowedDM(uid, id(b.member)))
        run(
          "UPDATE lb_members SET inviter=?,invited=? WHERE gid=? AND uid=? AND joined IS NULL",
          uid,
          Date.now(),
          gid,
          b.member,
        );
      else fail("Invalid action.");
    }
    run("UPDATE linkbacks SET updated=? WHERE id=?", Date.now(), gid);
    if (g.group_name)
      changed(gid, ...(b.action === "remove" ? [b.member] : []));
  });
}
