import { separated } from "./visibility.mjs";
import express from "express";

// Used for every path to a post, including saved items, votes, and direct media URLs.
export const visiblePost = (p, viewer) =>
  `(NOT ${separated(`${p}.author`, viewer)} AND (${p}.author=${viewer} OR EXISTS(SELECT 1 FROM follows WHERE followed=${p}.author AND follower=${viewer}) OR (${p}.audience='everyone' AND NOT EXISTS(SELECT 1 FROM profile_settings WHERE user_id=${p}.author AND private=1))))`;
const MAX = 8 * 1024 * 1024;
export function mediaType(b) {
  if (b.subarray(0, 3).toString("hex") === "ffd8ff") return "image/jpeg";
  if (b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a")
    return "image/png";
  if (/^GIF8[79]a$/.test(b.toString("ascii", 0, 6))) return "image/gif";
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (
    b.toString("ascii", 4, 8) === "ftyp" &&
    /^(isom|iso[2-9]|mp4[12]|avc1|M4V )$/.test(b.toString("ascii", 8, 12))
  )
    return "video/mp4";
  if (
    b.subarray(0, 4).toString("hex") === "1a45dfa3" &&
    b.subarray(0, 256).includes("webm")
  )
    return "video/webm";
  return "";
}
function parse(input, draft) {
  const {
    body = "",
    audience = "everyone",
    feeling = "",
    location = "",
    poll = [],
    media = [],
  } = input || {};
  if (
    typeof body !== "string" ||
    body.length > 500 ||
    !["everyone", "followers"].includes(audience) ||
    typeof feeling !== "string" ||
    feeling.length > 40 ||
    typeof location !== "string" ||
    location.length > 100
  )
    throw Error(
      "Check the text, location and audience. Posts allow 500 characters.",
    );
  if (
    !Array.isArray(poll) ||
    poll.length > 4 ||
    poll.some((x) => typeof x !== "string" || x.length > 80)
  )
    throw Error("Use up to four poll options of 80 characters each.");
  const choices = poll.map((x) => x.trim());
  if (
    !draft &&
    choices.length &&
    (!body.trim() ||
      choices.length < 2 ||
      choices.includes("") ||
      new Set(choices.map((x) => x.toLowerCase())).size !== choices.length)
  )
    throw Error("Write a poll question and at least two different answers.");
  if (!Array.isArray(media) || media.length > 10)
    throw Error("Choose up to ten photos or one video.");
  let size = 0;
  const files = media.map((m) => {
    if (!m || typeof m.data !== "string" || typeof m.type !== "string")
      throw Error("Invalid attachment.");
    const bytes = Buffer.from(m.data, "base64");
    size += bytes.length;
    if (size > MAX || !bytes.length || mediaType(bytes) !== m.type || !m.type)
      throw Error(
        "Use JPG, PNG, WebP, GIF, MP4 or WebM files, up to 8 MB combined.",
      );
    if (m.type.startsWith("video/") && media.length !== 1)
      throw Error("A video must be the only attachment.");
    return { type: m.type, bytes };
  });
  if (!draft && !body.trim() && !files.length)
    throw Error("Write something or attach a file before publishing.");
  return {
    body: body.trim(),
    audience,
    details: {
      feeling: feeling.trim(),
      location: location.trim(),
      poll: choices,
    },
    files,
    size,
  };
}
export function installComposer(app, db, limit, mention) {
  const cols = db.prepare("PRAGMA table_info(posts)").all();
  if (!cols.some((c) => c.name === "audience"))
    db.exec(
      "ALTER TABLE posts ADD COLUMN audience TEXT NOT NULL DEFAULT 'everyone'",
    );
  if (!cols.some((c) => c.name === "details"))
    db.exec("ALTER TABLE posts ADD COLUMN details TEXT NOT NULL DEFAULT '{}'");
  // Shared post URLs must never point to a new post after an author deletes their account.
  db.exec(`CREATE TABLE IF NOT EXISTS post_ids(slot INTEGER PRIMARY KEY CHECK(slot=1),last_id INTEGER NOT NULL);
  INSERT OR IGNORE INTO post_ids SELECT 1,coalesce(max(id),0) FROM posts;
  CREATE TRIGGER IF NOT EXISTS remember_post_id AFTER INSERT ON posts BEGIN UPDATE post_ids SET last_id=max(last_id,new.id) WHERE slot=1; END;
  CREATE TABLE IF NOT EXISTS post_media(id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,type TEXT NOT NULL,bytes BLOB NOT NULL);
  CREATE INDEX IF NOT EXISTS post_media_post ON post_media(post_id);
  CREATE TABLE IF NOT EXISTS post_votes(post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,choice INTEGER NOT NULL,PRIMARY KEY(post_id,user_id));
  CREATE TABLE IF NOT EXISTS post_drafts(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,payload TEXT NOT NULL);`);
  function voteData(id, uid) {
    return {
      votes: db
        .prepare(
          "SELECT choice,count(*) AS n FROM post_votes WHERE post_id=? GROUP BY choice",
        )
        .all(id),
      choice:
        db
          .prepare(
            "SELECT choice FROM post_votes WHERE post_id=? AND user_id=?",
          )
          .get(id, uid)?.choice ?? null,
    };
  }
  function enrich(posts, uid) {
    return posts.map(({ details, ...p }) => {
      const extra = JSON.parse(details);
      return {
        ...p,
        ...extra,
        ...(extra.poll?.length ? voteData(p.id, uid) : {}),
        media: db
          .prepare("SELECT id,type FROM post_media WHERE post_id=? ORDER BY id")
          .all(p.id),
      };
    });
  }
  app.get("/api/feed/draft", (req, res) =>
    res.json({
      draft: JSON.parse(
        db
          .prepare("SELECT payload FROM post_drafts WHERE user_id=?")
          .get(res.locals.uid)?.payload || "null",
      ),
    }),
  );
  app.post("/api/feed/discard-draft", limit, (req, res) => {
    db.prepare("DELETE FROM post_drafts WHERE user_id=?").run(res.locals.uid);
    res.json({ ok: true });
  });
  app.post(
    ["/api/feed/posts", "/api/feed/draft"],
    limit,
    express.json({ limit: "11mb" }),
    (req, res) => {
      const draft = req.path.endsWith("/draft"),
        uid = res.locals.uid;
      let p;
      try {
        p = parse(req.body, draft);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      if (draft) {
        const payload = {
          body: p.body,
          audience: p.audience,
          ...p.details,
          media: p.files.map((f) => ({
            type: f.type,
            data: f.bytes.toString("base64"),
          })),
        };
        db.prepare("INSERT OR REPLACE INTO post_drafts VALUES(?,?)").run(
          uid,
          JSON.stringify(payload),
        );
        return res.json({ ok: true });
      }
      if (
        p.size &&
        p.size +
          db
            .prepare(
              "SELECT coalesce(sum(length(bytes)),0) AS used FROM post_media WHERE post_id IN (SELECT id FROM posts WHERE author=?)",
            )
            .get(uid).used >
          128 * 1024 * 1024
      )
        return res.status(413).json({ error: "Your media storage is full." });
      db.exec("BEGIN");
      try {
        const { lastInsertRowid: id } = db
          .prepare(
            "INSERT INTO posts(id,author,body,created,audience,details) VALUES((SELECT last_id+1 FROM post_ids WHERE slot=1),?,?,?,?,?)",
          )
          .run(uid, p.body, Date.now(), p.audience, JSON.stringify(p.details));
        for (const f of p.files)
          db.prepare(
            "INSERT INTO post_media(post_id,type,bytes) VALUES(?,?,?)",
          ).run(id, f.type, f.bytes);
        mention(Number(id), uid, p.body);
        if (req.body.fromDraft === true)
          db.prepare("DELETE FROM post_drafts WHERE user_id=?").run(uid);
        db.exec("COMMIT");
        res.status(201).json({ ok: true, id: Number(id) });
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  );
  app.post("/api/feed/vote", limit, (req, res) => {
    const { id, choice } = req.body || {},
      uid = res.locals.uid;
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(choice))
      return res.status(400).json({ error: "Select a poll option." });
    const p = db
      .prepare(
        `SELECT details FROM posts p WHERE id=? AND ${visiblePost("p", ":uid")}`,
      )
      .get({ uid }, id);
    if (!p || !JSON.parse(p.details).poll?.[choice])
      return res.status(404).json({ error: "Poll option unavailable." });
    db.prepare("INSERT OR REPLACE INTO post_votes VALUES(?,?,?)").run(
      id,
      uid,
      choice,
    );
    res.json(voteData(id, uid));
  });
  app.get("/api/feed/media/:id", (req, res) => {
    const id = Number(req.params.id),
      uid = res.locals.uid;
    const meta =
      Number.isSafeInteger(id) &&
      db
        .prepare(
          `SELECT p.author,p.audience,m.type,length(m.bytes) AS size FROM post_media m JOIN posts p ON p.id=m.post_id WHERE m.id=? AND ${visiblePost("p", ":uid")}`,
        )
        .get({ uid }, id);
    if (!meta) return res.sendStatus(404);
    if (req.query.download === "1") {
      if (
        meta.author !== uid &&
        (meta.audience !== "everyone" ||
          db
            .prepare("SELECT private FROM profile_settings WHERE user_id=?")
            .get(meta.author)?.private ||
          !db
            .prepare(
              "SELECT 1 FROM preferences WHERE owner=? AND json_extract(data,'$.downloads')=1",
            )
            .get(meta.author))
      )
        return res.sendStatus(403);
      res.attachment("AfterLink-" + id + "." + meta.type.split("/")[1]);
    }
    let start = 0,
      end = meta.size - 1;
    res.set("Accept-Ranges", "bytes");
    if (req.headers.range) {
      const range = req.range(meta.size);
      if (!Array.isArray(range) || range.type !== "bytes" || range.length !== 1)
        return res.set("Content-Range", `bytes */${meta.size}`).sendStatus(416);
      ({ start, end } = range[0]);
      res
        .status(206)
        .set("Content-Range", `bytes ${start}-${end}/${meta.size}`);
    }
    res
      .set("Content-Security-Policy", "default-src 'none'; sandbox")
      .type(meta.type)
      .send(
        Buffer.from(
          db
            .prepare(
              "SELECT substr(bytes,?,?) AS part FROM post_media WHERE id=?",
            )
            .get(start + 1, end - start + 1, id).part,
        ),
      );
  });
  return enrich;
}
