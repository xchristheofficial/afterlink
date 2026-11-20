import { readFileSync } from "node:fs";
import { separated, muted } from "./visibility.mjs";
const emojis = new Set(
  JSON.parse(
    readFileSync(new URL("./public/assets/emoji.json", import.meta.url)),
  ).map((row) => row[0]),
);
export function installMessageActions(
  db,
  {
    endpoint,
    run,
    one,
    all,
    id,
    fail,
    person,
    hidden,
    allowedDM,
    checkQuota,
    wake,
  },
) {
  const cols = new Set(all("PRAGMA table_info(messages)").map((c) => c.name));
  for (const [col, def] of Object.entries({
    client_token: "TEXT",
    removed: "INTEGER DEFAULT 0",
    reply_to: "INTEGER REFERENCES messages(id) ON DELETE SET NULL",
    pinned: "INTEGER DEFAULT 0",
    forwarded: "INTEGER DEFAULT 0",
  }))
    if (!cols.has(col))
      db.exec(`ALTER TABLE messages ADD COLUMN ${col} ${def}`);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS dm_token ON messages(sender,recipient,client_token) WHERE client_token IS NOT NULL;CREATE TABLE IF NOT EXISTS dm_reactions(message INTEGER REFERENCES messages(id) ON DELETE CASCADE,owner INTEGER REFERENCES users(id) ON DELETE CASCADE,emoji TEXT NOT NULL,PRIMARY KEY(message,owner));CREATE TABLE IF NOT EXISTS member_notes(owner INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL);`,
  );
  endpoint("get", "notes", (uid) => ({
    mine: uid,
    notes: all(
      `SELECT p.id,p.name,n.body FROM feed_profiles p LEFT JOIN member_notes n ON n.owner=p.id WHERE p.id=:uid OR (n.owner IS NOT NULL AND EXISTS(SELECT 1 FROM follows WHERE follower=:uid AND followed=p.id) AND NOT ${separated(":uid", "p.id")} AND NOT ${muted(":uid", "p.id")}) ORDER BY p.id=:uid DESC,n.rowid DESC LIMIT 100`,
      { uid },
    ),
  }));
  endpoint("post", "notes", (uid, q, b) => {
    if (typeof b.body !== "string" || b.body.length > 80)
      fail("Keep your note under 81 characters.");
    const text = b.body.trim();
    if (!text) run("DELETE FROM member_notes WHERE owner=?", uid);
    else run("INSERT OR REPLACE INTO member_notes VALUES(?,?)", uid, text);
  });
  const select = `SELECT m.id,m.client_token clientToken,m.body,m.created,m.sender,m.seen,m.removed,m.forwarded,m.pinned,m.reply_to,r.body replyBody,r.removed replyRemoved,exists(SELECT 1 FROM message_photos WHERE message=m.id) hasPhoto,d.type mediaType,d.once_only onceOnly,d.opened,(SELECT json_group_array(emoji) FROM dm_reactions WHERE message=m.id) reactions FROM messages m LEFT JOIN dm_media d ON d.message=m.id LEFT JOIN messages r ON r.id=m.reply_to`;
  function target(uid, key) {
    const m = one(
      "SELECT * FROM messages WHERE id=? AND (sender=? OR recipient=?)",
      id(key),
      uid,
      uid,
    );
    if (!m || hidden(m.sender, m.recipient) || m.removed)
      fail("Message unavailable.", 404);
    return m;
  }
  endpoint("post", "message/:id/action", (uid, q, b, p) => {
    const m = target(uid, p.id),
      peer = m.sender === uid ? m.recipient : m.sender,
      key = m.id;
    if (b.action === "unsend") {
      if (m.sender !== uid) fail("Only the sender can unsend.", 403);
      for (const t of ["message_photos", "dm_media", "dm_reactions"])
        run(`DELETE FROM ${t} WHERE message=?`, key);
      run(
        "UPDATE messages SET body='',removed=1,pinned=0,reply_to=NULL,forwarded=0,seen=1 WHERE id=?",
        key,
      );
    } else if (b.action === "forward") {
      const dest = id(b.peer);
      person(dest, uid);
      if (dest === uid || !allowedDM(uid, dest))
        fail("Cannot forward to this member.", 403);
      const media = one(
          "SELECT once_only,length(bytes) size FROM dm_media WHERE message=?",
          key,
        ),
        photo = one(
          "SELECT length(bytes) size FROM message_photos WHERE message=?",
          key,
        );
      if (media?.once_only) fail("View-once media cannot be forwarded.", 403);
      if (media || photo) checkQuota(uid, (media || photo).size);
      const row = run(
        "INSERT INTO messages(sender,recipient,body,created,forwarded) VALUES(?,?,?,?,1)",
        uid,
        dest,
        m.body,
        Date.now(),
      ).lastInsertRowid;
      if (media)
        run(
          "INSERT INTO dm_media(message,type,bytes,once_only) SELECT ?,type,bytes,0 FROM dm_media WHERE message=?",
          row,
          key,
        );
      if (photo)
        run(
          "INSERT INTO message_photos SELECT ?,bytes FROM message_photos WHERE message=?",
          row,
          key,
        );
      wake("chat", uid, dest);
      return;
    } else if (!allowedDM(uid, peer)) fail("Conversation unavailable.", 403);
    else if (b.action === "pin") {
      if (!m.pinned)
        run(
          "UPDATE messages SET pinned=0 WHERE pinned=1 AND ((sender=? AND recipient=?) OR (sender=? AND recipient=?))",
          uid,
          peer,
          peer,
          uid,
        );
      run("UPDATE messages SET pinned=? WHERE id=?", m.pinned ? 0 : 1, key);
    } else if (b.action === "react") {
      if (!emojis.has(b.emoji)) fail("Choose an emoji.");
      const prev = one(
        "SELECT emoji FROM dm_reactions WHERE message=? AND owner=?",
        key,
        uid,
      );
      if (prev?.emoji === b.emoji)
        run("DELETE FROM dm_reactions WHERE message=? AND owner=?", key, uid);
      else
        run(
          "INSERT OR REPLACE INTO dm_reactions VALUES(?,?,?)",
          key,
          uid,
          b.emoji,
        );
    } else fail("Unknown action.");
    wake("mutation", uid, peer);
  });
  return { select, target };
}
