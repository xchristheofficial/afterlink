import { mediaType } from "./composer.mjs";
import { separated } from "./visibility.mjs";
const max = 4 * 1024 * 1024;
export function installDmMedia(
  app,
  db,
  { endpoint, id, fail, one, run, wake },
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS dm_media(message INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,type TEXT NOT NULL,once_only INTEGER NOT NULL,opened INTEGER,bytes BLOB)`,
  );
  const access = `FROM dm_media d JOIN messages m ON m.id=d.message WHERE m.id=:id AND NOT ${separated("m.sender", "m.recipient")}`;
  app.get("/api/feed/message-media/:id", (req, res) => {
    const row = one(
      `SELECT d.type,d.bytes ${access} AND d.once_only=0 AND (m.sender=:uid OR m.recipient=:uid)`,
      { id: Number(req.params.id), uid: res.locals.uid },
    );
    if (!row) return res.sendStatus(404);
    res
      .set("Content-Security-Policy", "default-src 'none'; sandbox")
      .type(row.type)
      .send(Buffer.from(row.bytes));
  });
  endpoint("post", "message-media/:id/open", (uid, q, b, p) => {
    const key = id(p.id),
      row = one(
        `SELECT d.type,d.bytes,m.sender ${access} AND d.once_only=1 AND d.opened IS NULL AND m.recipient=:uid`,
        { id: key, uid },
      );
    if (!row) fail("Media unavailable or already opened.", 404);
    // The endpoint transaction consumes the payload before responding, including competing tabs.
    run(
      "UPDATE dm_media SET opened=?,bytes=NULL WHERE message=?",
      Date.now(),
      key,
    );
    wake("read", row.sender, uid);
    return { type: row.type, data: Buffer.from(row.bytes).toString("base64") };
  });
  function checkQuota(uid, size) {
    const used = one(
      `SELECT (SELECT coalesce(sum(length(bytes)),0) FROM dm_media JOIN messages ON message=id WHERE sender=:uid)+(SELECT coalesce(sum(length(bytes)),0) FROM message_photos JOIN messages ON message=id WHERE sender=:uid) n`,
      { uid },
    ).n;
    if (used + size > 64 * 1024 * 1024)
      fail("Message media storage is full.", 413);
  }
  function parseMedia(m, uid) {
    if (
      !m ||
      typeof m.data !== "string" ||
      typeof m.once !== "boolean" ||
      m.data.length > 4 * Math.ceil(max / 3) ||
      !m.data.length
    )
      fail("Choose media under 4 MB.");
    const bytes = Buffer.from(m.data, "base64"),
      detected = mediaType(bytes);
    const audio =
      (m.type === "audio/webm" && detected === "video/webm") ||
      (m.type === "audio/mp4" &&
        bytes.toString("ascii", 4, 8) === "ftyp" &&
        ["M4A ", "isom", "iso5", "mp42"].includes(
          bytes.toString("ascii", 8, 12),
        )) ||
      (m.type === "audio/ogg" &&
        bytes.toString("ascii", 0, 4) === "OggS" &&
        bytes.subarray(0, 256).includes("OpusHead"));
    if (
      !bytes.length ||
      bytes.length > max ||
      !(
        audio ||
        (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
          detected,
        ) &&
          detected === m.type)
      ) ||
      (audio && m.once)
    )
      fail("Unsupported message attachment.");
    checkQuota(uid, bytes.length);
    return { type: m.type, bytes, once: +m.once };
  }
  return { parseMedia, checkQuota };
}
