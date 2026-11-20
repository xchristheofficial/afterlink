import { GROUP_LIMIT, INVITE_BATCH } from "./public/group-limits.mjs";
import { createHash } from "node:crypto";
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
  if (
    !all("PRAGMA table_info(linkbacks)").some((c) => c.name === "group_topic")
  )
    db.exec(
      "ALTER TABLE linkbacks ADD COLUMN group_topic TEXT NOT NULL DEFAULT ''",
    );
  function topic(text = "") {
    if (typeof text !== "string" || text.length > 200)
      fail("Keep the group topic to 200 characters or fewer.");
    return text.trim();
  }
  if (
    !all("PRAGMA table_info(lb_members)").some((c) => c.name === "read_through")
  ) {
    db.exec(`ALTER TABLE lb_members ADD COLUMN read_through INTEGER NOT NULL DEFAULT 0;
      UPDATE lb_members SET read_through=coalesce((SELECT max(id) FROM lb_messages WHERE gid=lb_members.gid),0) WHERE joined IS NOT NULL`);
  }
  if (
    !all("PRAGMA table_info(lb_messages)").some(
      (c) => c.name === "client_token",
    )
  )
    db.exec("ALTER TABLE lb_messages ADD COLUMN client_token TEXT");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS lb_send_token ON lb_messages(gid,author,client_token) WHERE client_token IS NOT NULL",
  );
  // Keep the explicit handoff on the membership, so leaving, removal, or a
  // block automatically revokes it. Legacy groups keep oldest-joined succession.
  if (
    !all("PRAGMA table_info(lb_members)").some(
      (c) => c.name === "designated_admin",
    )
  )
    db.exec(
      "ALTER TABLE lb_members ADD COLUMN designated_admin INTEGER NOT NULL DEFAULT 0",
    );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS lb_one_admin ON lb_members(gid) WHERE designated_admin=1",
  );
  // Invitations count as one item, never expose pending groups' message volume.
  const unread = `CASE WHEN m.joined IS NULL THEN 1 ELSE (SELECT count(*) FROM lb_messages x WHERE x.gid=m.gid AND x.id>m.read_through AND x.author<>m.uid AND NOT ${separated("x.author", "m.uid")}) END`;
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
      `SELECT g.*,m.joined,m.invited,m.inviter,${unread} unread FROM linkbacks g JOIN lb_members m ON m.gid=g.id WHERE g.id=? AND m.uid=?`,
      gid,
      uid,
    ) || deny();
  const admin = (gid) =>
    one(
      "SELECT uid FROM lb_members WHERE gid=? AND joined IS NOT NULL ORDER BY designated_admin DESC,joined,uid LIMIT 1",
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
      unread: g.unread,
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
    if (!Array.isArray(ids) || !ids.length || ids.length > INVITE_BATCH)
      fail(`Choose up to ${INVITE_BATCH} people.`);
    const targets = [...new Set(ids.map(id))];
    if (
      one("SELECT count(*) n FROM lb_members WHERE gid=?", gid).n +
        targets.length >
      GROUP_LIMIT
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
        "INSERT INTO lb_members(gid,uid,inviter,invited,joined) VALUES(?,?,?,?,NULL)",
        gid,
        t,
        uid,
        Date.now(),
      );
    }
  }
  const addMessage = (gid, uid, text, token = null) =>
    run(
      "INSERT INTO lb_messages(gid,author,body,created,client_token) VALUES(?,?,?,?,?)",
      gid,
      uid,
      body(text, 1000),
      Date.now(),
      token,
    );
  endpoint("post", "groups", (uid, q, b) => {
    const name = body(b.name, 60),
      now = Date.now(),
      gid = Number(
        run(
          "INSERT INTO linkbacks(group_name,group_topic,updated) VALUES(?,?,?)",
          name,
          topic(b.topic),
          now,
        ).lastInsertRowid,
      );
    run(
      "INSERT INTO lb_members(gid,uid,inviter,invited,joined) VALUES(?,?,NULL,?,?)",
      gid,
      uid,
      now,
      now,
    );
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
    run(
      "INSERT INTO lb_members(gid,uid,inviter,invited,joined) VALUES(?,?,NULL,?,?)",
      gid,
      uid,
      now,
      now,
    );
    invite(gid, uid, b.people);
    if (b.message) addMessage(gid, uid, b.message);
    return { id: gid };
  });
  endpoint("get", "linkbacks", (uid, q) => {
    const filter = q.post ? id(q.post) : null;
    if (filter && !preview(filter, uid)) fail("Post unavailable.", 404);
    const view = q.view ?? "all";
    if (!["all", "unread", "invites"].includes(view))
      fail("Unknown inbox filter.");
    const viewClause =
      view === "invites"
        ? " AND m.joined IS NULL"
        : view === "unread"
          ? ` AND m.joined IS NOT NULL AND (${unread})>0`
          : "";
    return {
      groups: all(
        `SELECT g.*,m.joined,m.invited,m.inviter,${unread} unread FROM lb_members m JOIN linkbacks g ON m.gid=g.id WHERE m.uid=? AND (g.group_name IS NOT NULL)=? AND (? IS NULL OR g.post=?)${viewClause} ORDER BY CASE WHEN m.joined IS NULL THEN m.invited ELSE g.updated END DESC,g.id DESC LIMIT 100`,
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
    const rows = all(
      msgSelect + " AND m.id<:before ORDER BY m.id DESC LIMIT 61",
      { gid, uid, before: q.before ? id(q.before) : Number.MAX_SAFE_INTEGER },
    );
    return {
      ...s,
      ...(g.group_name ? { topic: g.group_topic } : {}),
      uid,
      admin: admin(gid),
      members: all(
        "SELECT p.id,p.name,m.joined FROM lb_members m JOIN feed_profiles p ON p.id=m.uid WHERE gid=? ORDER BY joined IS NULL,joined,p.name",
        gid,
      ),
      more: rows.length > 60,
      messages: rows.slice(0, 60).reverse(),
    };
  });
  function departure(gid, uid) {
    const remaining = one(
      `SELECT p.id,p.name FROM lb_members m JOIN feed_profiles p ON p.id=m.uid WHERE m.gid=? AND m.uid<>? AND m.joined IS NOT NULL ORDER BY m.designated_admin DESC,m.joined,m.uid LIMIT 1`,
      gid,
      uid,
    );
    const cancelled = all(
      `SELECT p.id,p.name FROM lb_members m JOIN feed_profiles p ON p.id=m.uid WHERE gid=? AND joined IS NULL AND (inviter=? OR ?=1) ORDER BY p.id`,
      gid,
      uid,
      Number(!remaining),
    );
    const preview = {
      closes: !remaining,
      nextAdmin: remaining || null,
      cancelled,
    };
    return {
      ...preview,
      token: createHash("sha256")
        .update(JSON.stringify([gid, uid, preview]))
        .digest("hex"),
    };
  }
  endpoint("get", "linkbacks/:gid/leave-preview", (uid, q, b, p) => {
    const gid = id(p.gid);
    if (group(gid, uid).joined === null) deny();
    return departure(gid, uid);
  });
  endpoint("post", "linkbacks/:gid", (uid, q, b, p) => {
    const gid = id(p.gid),
      g = group(gid, uid);
    if (b.action === "read" && g.joined !== null) {
      const through = id(b.through);
      if (!one(msgSelect + " AND m.id=:through", { uid, gid, through })) deny();
      run(
        "UPDATE lb_members SET read_through=max(read_through,?) WHERE gid=? AND uid=?",
        through,
        gid,
        uid,
      );
      return;
    }
    if (b.action === "leave") {
      if (
        b.previewToken !== undefined &&
        b.previewToken !== departure(gid, uid).token
      )
        fail("The group changed. Review leaving again.", 409);
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
    } else if (b.action === "message") {
      const token = b.clientId ?? null;
      if (token !== null) {
        if (typeof token !== "string" || !/^[-a-zA-Z0-9]{16,64}$/.test(token))
          fail("Invalid message token.");
        if (
          one(
            "SELECT id FROM lb_messages WHERE gid=? AND author=? AND client_token=?",
            gid,
            uid,
            token,
          )
        )
          return;
      }
      addMessage(gid, uid, b.message, token);
    } else if (b.action === "pin") {
      const pin = b.message === null ? null : id(b.message);
      if (pin && !one(msgSelect + " AND m.id=:pin", { gid, uid, pin }))
        fail("Message unavailable.");
      run("UPDATE linkbacks SET pin=? WHERE id=?", pin, gid);
    } else {
      if (uid !== admin(gid))
        fail("Only the admin can manage this group.", 403);
      if (b.action === "invite") invite(gid, uid, b.people);
      else if (b.action === "transfer") {
        const member = id(b.member);
        if (
          member === uid ||
          !one(
            "SELECT 1 FROM lb_members WHERE gid=? AND uid=? AND joined IS NOT NULL",
            gid,
            member,
          )
        )
          fail("Choose another joined member.");
        run(
          "UPDATE lb_members SET designated_admin=0 WHERE gid=? AND designated_admin=1",
          gid,
        );
        run(
          "UPDATE lb_members SET designated_admin=1 WHERE gid=? AND uid=?",
          gid,
          member,
        );
      } else if (b.action === "edit" && g.group_name) {
        run(
          "UPDATE linkbacks SET group_name=?,group_topic=? WHERE id=?",
          body(b.name, 60),
          topic(b.topic),
          gid,
        );
      } else if (b.action === "remove" && id(b.member) !== uid)
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
  return (uid) => {
    const counts = { groups: 0, linkbacks: 0 };
    for (const row of all(
      `SELECT g.group_name IS NOT NULL named,sum(${unread}) n FROM lb_members m JOIN linkbacks g ON g.id=m.gid WHERE m.uid=? GROUP BY named`,
      uid,
    ))
      counts[row.named ? "groups" : "linkbacks"] = row.n;
    return counts;
  };
}
