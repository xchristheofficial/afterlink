import { randomUUID, createHmac } from "node:crypto";
// Only rendezvous data lives here. Calls expire and are never recorded.
export function installCalls({
  endpoint,
  id,
  fail,
  person,
  allowedDM,
  wake,
  nickname,
}) {
  const active = new Map();
  const sweep = () => {
    const now = Date.now();
    for (const [key, c] of active) {
      if (
        c.state === "ringing"
          ? now - c.start > 45000
          : Math.min(c.pulseA, c.pulseB) < now - 45000
      )
        active.delete(key);
    }
  };
  setInterval(sweep, 15000).unref();
  function ice(uid) {
    const servers = [];
    if (process.env.CALL_STUN_URL)
      servers.push({ urls: process.env.CALL_STUN_URL });
    if (process.env.CALL_TURN_URL && process.env.CALL_TURN_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + 3600}:${uid}`;
      servers.push({
        urls: process.env.CALL_TURN_URL,
        username,
        credential: createHmac("sha1", process.env.CALL_TURN_SECRET)
          .update(username)
          .digest("base64"),
      });
    }
    return servers;
  }
  const current = (uid) => {
    let c;
    for (const entry of active.values()) {
      if (entry.a === uid || entry.b === uid) {
        c = entry;
        break;
      }
    }
    if (c && !allowedDM(c.a, c.b)) {
      active.delete(c.id);
      return null;
    }
    return c;
  };
  endpoint("get", "calls", (uid, q) => {
    const c = current(uid);
    if (!c) return { call: null };
    const caller = c.a === uid,
      peer = caller ? c.b : c.a;
    if (q.live === c.id) c[caller ? "pulseA" : "pulseB"] = Date.now();
    return {
      call: {
        id: c.id,
        kind: c.kind,
        state: c.state,
        recording: c.recording || null,
        recordVersion: c.recordVersion || 0,
        candidates:
          q.live === c.id
            ? (c[caller ? "iceB" : "iceA"] || []).slice(
                Math.max(0, Number(q.offset) || 0),
              )
            : [],
        caller,
        peer,
        name: nickname(uid, peer) || person(peer, uid).name,
        presenter: c.presenter || null,
        watchVersion: c.watchVersion || 0,
        ...(c.state === "accepted" && q.live === c.id && q.synced !== "1"
          ? { remote: caller ? c.answer : c.offer }
          : {}),
      },
    };
  });
  endpoint("post", "calls", (uid, q, b) => {
    sweep();
    if (b.action === "start") {
      const peer = id(b.peer);
      person(peer, uid);
      if (peer === uid || !allowedDM(uid, peer))
        fail("Calls are unavailable.", 403);
      if (!["video", "audio"].includes(b.kind)) fail("Invalid call type.");
      if (current(uid) || current(peer)) fail("Member is busy.", 409);
      const key = randomUUID(),
        now = Date.now();
      active.set(key, {
        id: key,
        a: uid,
        b: peer,
        state: "ringing",
        kind: b.kind,
        start: now,
        pulseA: now,
        pulseB: now,
      });
      wake("call", peer);
      return { id: key, iceServers: ice(uid) };
    }
    const c = current(uid);
    if (!c || c.id !== b.id) fail("Call has ended.", 404);
    const peer = uid === c.a ? c.b : c.a;
    if (b.action === "end") {
      wake("call", peer);
      active.delete(c.id);
      return;
    }
    if (b.action === "accept" && c.b === uid && c.state === "ringing") {
      c.state = "accepted";
      wake("call", peer);
      c.pulseA = c.pulseB = Date.now();
      return { iceServers: ice(uid) };
    }
    if (c.kind === "video" && c.state === "accepted" && b.action === "watch") {
      if (b.step === "start" && !c.presenter) c.presenter = uid;
      else if (b.step === "stop" && c.presenter === uid) c.presenter = null;
      else fail("Another member is presenting, or sharing has ended.", 409);
      c.watchVersion = (c.watchVersion || 0) + 1;
      wake("call", peer);
      return { presenter: c.presenter, watchVersion: c.watchVersion };
    }
    if (c.state === "accepted" && b.action === "recording") {
      const r = c.recording;
      if (b.step === "request" && !r)
        c.recording = { owner: uid, state: "requested" };
      else if (
        b.step === "allow" &&
        r?.owner === peer &&
        r.state === "requested"
      )
        r.state = "allowed";
      else if (b.step === "begin" && r?.owner === uid && r.state === "allowed")
        r.state = "active";
      else if (b.step === "stop" && r) c.recording = null;
      else fail("Recording request has changed.", 409);
      c.recordVersion = (c.recordVersion || 0) + 1;
      wake("call", peer);
      return { recording: c.recording || null, recordVersion: c.recordVersion };
    }
    if (c.state === "accepted" && b.action === "ice") {
      const list = (c[uid === c.a ? "iceA" : "iceB"] ??= []);
      if (
        !Array.isArray(b.items) ||
        list.length + b.items.length > 64 ||
        b.items.some(
          (x) =>
            !x ||
            typeof x.candidate !== "string" ||
            x.candidate.length > 2048 ||
            typeof x.sdpMid !== "string" ||
            x.sdpMid.length > 32,
        )
      )
        fail("Invalid ICE candidates.");
      list.push(
        ...b.items.map(({ candidate, sdpMid }) => ({ candidate, sdpMid })),
      );
      wake("call", peer);
      return;
    }
    if (b.action === "signal" && c.state === "accepted") {
      const caller = c.a === uid,
        k = caller ? "offer" : "answer";
      if (
        c[k] ||
        (!caller && !c.offer) ||
        typeof b.sdp !== "string" ||
        b.sdp.length > 64000 ||
        !b.sdp.startsWith("v=0") ||
        !/^m=audio /m.test(b.sdp) ||
        /^m=application /m.test(b.sdp) ||
        (c.kind === "audio" && /^m=video /m.test(b.sdp))
      )
        fail("Invalid call negotiation.", 409);
      c[k] = { type: k, sdp: b.sdp };
      wake("call", peer);
      return;
    }
    fail("Call action unavailable.", 409);
  });
}
