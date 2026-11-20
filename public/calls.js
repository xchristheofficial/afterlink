import { watchTogether, watchTransport } from "./watch-together.js";
import { callRecording } from "./call-recording.js";
import { api, avatar, box, button, n, withIcon, error } from "./social-ui.js";

// Let WebRTC's congestion controller adapt continuously; prefer intelligible speech
// over video resolution. Optional sender hints must never prevent a call.
function tuneSenders(pc, constrained) {
  for (const sender of pc.getSenders()) {
    const p = sender.getParameters();
    if (!p.encodings?.length || !sender.track) continue;
    const video = sender.track.kind === "video";
    for (const e of p.encodings) {
      e.priority = video ? "low" : "high";
      if (video) e.maxBitrate = constrained ? 300000 : 1200000;
    }
    if (video) p.degradationPreference = "maintain-framerate";
    sender.setParameters(p).catch(() => {});
  }
}
// One controller per Messages document. Capture starts only after Start/Accept.
export function callControls() {
  let session = null,
    busy = false;
  const dialog = n("dialog", "call-panel"),
    title = n("h2"),
    status = n("p", "subtle"),
    timer = n("span", "call-time"),
    portrait = box("call-person"),
    stage = box("call-stage"),
    controls = box("call-controls");
  dialog.setAttribute("aria-label", "AfterLink call");
  dialog.append(title, status, stage, timer, controls);
  document.body.append(dialog);
  const write = (action, extra) => api("/calls", { action, ...extra });
  function release(c) {
    if (!c) return;
    c.watch?.close();
    c.recording?.close();
    clearTimeout(c.iceTimer);
    clearInterval(c.clock);
    c.pc?.close();
    c.stream?.getTracks().forEach((t) => t.stop());
    if (c.remote) c.remote.srcObject = null;
    if (c.local) c.local.srcObject = null;
  }
  function reset(c) {
    if (session !== c) return;
    session = null;
    release(c);
    c.recording?.panel.remove();
    dialog.close();
    stage.replaceChildren();
    controls.replaceChildren();
    timer.textContent = "";
  }
  async function end(c) {
    if (!c || c !== session) return;
    reset(c);
    if (c.id) await write("end", { id: c.id }).catch(() => {});
  }
  dialog.oncancel = (e) => {
    e.preventDefault();
    end(session);
  };
  addEventListener("pagehide", () => {
    const c = session;
    if (!c) return;
    reset(c);
    if (c.id && (c.talking || c.preparing))
      fetch("/api/feed/calls", {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          "X-AfterLink-Request": "1",
        },
        body: JSON.stringify({ action: "end", id: c.id }),
      }).catch(() => {});
  });
  function show(c, incoming) {
    title.textContent = incoming
      ? "Incoming call"
      : c.kind === "video"
        ? "Video call"
        : "Audio call";
    status.textContent = incoming
      ? `AfterLink ${c.kind} call`
      : "Requesting device access…";
    portrait.replaceChildren(avatar(c.peer), n("strong", "", c.name));
    stage.replaceChildren(portrait);
    const hang = button(
      incoming ? "Decline" : "End call",
      () => end(c),
      "call-end",
    );
    controls.replaceChildren(hang);
    if (incoming)
      controls.append(button("Accept", () => prepare(c, true), "gradient"));
    if (!dialog.open) dialog.showModal();
  }
  async function prepare(c, incoming) {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      await end(c);
      error("Calling requires a supported browser and HTTPS.");
      return;
    }
    c.preparing = true;
    controls.replaceChildren(button("Cancel", () => end(c)));
    status.textContent = "Requesting device access…";
    try {
      const connection = navigator.connection,
        constrained =
          connection?.saveData ||
          ["slow-2g", "2g", "3g"].includes(connection?.effectiveType);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: { ideal: 1 },
        },
        video: c.kind === "video" && {
          width: { ideal: constrained ? 320 : 640, max: 1280 },
          height: { ideal: constrained ? 180 : 360, max: 720 },
          frameRate: {
            ideal: constrained ? 15 : 24,
            max: constrained ? 20 : 30,
          },
        },
      });
      if (c !== session) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      c.stream = stream;
      const result = incoming
        ? await write("accept", { id: c.id })
        : await write("start", { peer: c.peer, kind: c.kind });
      if (c !== session) {
        await write("end", { id: c.id || result.id }).catch(() => {});
        return;
      }
      c.id = c.id || result.id;
      c.talking = true;
      const pc = (c.pc = new RTCPeerConnection({
        iceServers: result.iceServers,
        bundlePolicy: "max-bundle",
      }));
      stream.getTracks().forEach((track) => {
        if (track.kind === "audio" && "contentHint" in track)
          track.contentHint = "speech";
        pc.addTrack(track, stream);
      });
      if (c.kind === "video")
        c.watchTransport = watchTransport(pc, !incoming, constrained);
      const batch = [];
      c.offset = 0;
      pc.onicecandidate = ({ candidate }) => {
        if (!candidate || session !== c) return;
        batch.push(candidate.toJSON());
        if (!c.iceTimer)
          c.iceTimer = setTimeout(() => {
            c.iceTimer = null;
            if (session === c)
              write("ice", { id: c.id, items: batch.splice(0) }).catch((e) => {
                if (session === c) error(e);
              });
          }, 70);
      };
      c.remote = n(c.kind === "video" ? "video" : "audio", "call-remote");
      c.remote.autoplay = true;
      c.remote.playsInline = true;
      stage.append(c.remote);
      if (c.kind === "video") {
        c.local = n("video", "call-local");
        c.local.autoplay = c.local.muted = c.local.playsInline = true;
        c.local.srcObject = stream;
        stage.append(c.local);
      }
      pc.ontrack = (e) => {
        if (c !== session) return;
        if (c.watchTransport && !c.watchTransport.isCamera(e.transceiver))
          return;
        c.remote.srcObject = e.streams[0];
        c.remote.play().catch(() => {
          if (c === session)
            controls.append(
              button("Play incoming media", () => c.remote.play()),
            );
        });
      };
      status.textContent = incoming ? "Connecting…" : "Ringing…";
      title.textContent = `${c.kind === "video" ? "Video" : "Audio"} call · ${c.name}`;
      const toggle = (kind, on, off) =>
        button(off, (b) => {
          const t = stream.getTracks().find((t) => t.kind === kind);
          t.enabled = !t.enabled;
          b.textContent = t.enabled ? off : on;
          b.setAttribute("aria-pressed", String(!t.enabled));
        });
      controls.replaceChildren(
        toggle("audio", "Unmute", "Mute"),
        ...(c.kind === "video"
          ? [toggle("video", "Camera on", "Camera off")]
          : []),
        button("End call", () => end(c), "call-end"),
      );
      queueMicrotask(poll);
      pc.onconnectionstatechange = () => {
        if (c !== session) return;
        if (pc.connectionState === "connected") {
          status.textContent = "Connected";
          if (c.kind === "video") portrait.remove();
          if (!c.clock) {
            tuneSenders(pc, constrained);
            if (c.watchTransport) {
              c.watch = watchTogether(c, dialog, write, constrained);
              stage.before(c.watch.pane);
              controls.after(c.watch.root);
            }
            c.recording = callRecording(c, write);
            controls.after(c.recording.panel);
            const start = Date.now();
            const tick = () => {
              const t = Math.floor((Date.now() - start) / 1000);
              timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
            };
            tick();
            c.clock = setInterval(tick, 1000);
          }
        } else if (pc.connectionState === "failed") {
          end(c);
          error(
            "The call could not connect. Check network access or the server’s TURN configuration.",
          );
        } else if (pc.connectionState === "disconnected")
          status.textContent = "Reconnecting…";
      };
    } catch (e) {
      if (incoming && !c.talking && e.status === 409) reset(c);
      else await end(c);
      error(
        e.name === "NotAllowedError"
          ? "Microphone or camera permission was denied."
          : e,
      );
    }
  }
  async function signal(c, desc) {
    await c.pc.setLocalDescription(desc);
    if (session === c) await write("signal", { id: c.id, sdp: desc.sdp });
  }
  let queued = false;
  async function poll() {
    if (busy) {
      queued = true;
      return;
    }
    busy = true;
    const before = session,
      priorId = before?.id;
    try {
      const { call } = await api(
        "/calls" +
          (before?.talking
            ? "?live=" +
              encodeURIComponent(before.id) +
              "&offset=" +
              (before.offset || 0) +
              (before.pc?.remoteDescription ? "&synced=1" : "")
            : ""),
      );
      if (before !== session || priorId !== session?.id) return;
      if (!call || (session?.id && call.id !== session.id)) {
        if (session?.id) {
          const connected = !!session.clock;
          reset(session);
          const notice = n(
            "p",
            "call-notice",
            connected ? "Call ended." : "Call ended or was not answered.",
          );
          notice.setAttribute("role", "status");
          document.body.append(notice);
          setTimeout(() => notice.remove(), 3500);
        }
        return;
      }
      if (
        session &&
        !session.talking &&
        !session.preparing &&
        call.state === "accepted"
      ) {
        reset(session);
        return;
      }
      if (!session) {
        if (!call.caller && call.state === "ringing") {
          session = { ...call };
          show(session, true);
        }
        return;
      }
      const c = session;
      if (!c.pc || call.state !== "accepted") return;
      c.watch?.sync(call.presenter, call.watchVersion);
      c.recording?.sync(call.recording, call.recordVersion);
      if (c.pc.connectionState !== "connected" && !c.clock) {
        status.textContent = "Connecting…";
        c.connectStart ??= Date.now();
        if (Date.now() - c.connectStart > 35000)
          throw Error(
            "Could not establish a media connection. Try another network.",
          );
      }
      if (call.caller && !c.pc.localDescription)
        await signal(c, await c.pc.createOffer());
      if (call.remote && !c.pc.remoteDescription) {
        await c.pc.setRemoteDescription(call.remote);
        if (!call.caller) {
          c.watchTransport?.answer();
          await signal(c, await c.pc.createAnswer());
        }
      }
      if (c.pc.remoteDescription)
        for (const ice of call.candidates) {
          await c.pc.addIceCandidate(ice);
          c.offset++;
        }
    } catch (e) {
      if (before && before === session) {
        await end(before);
        error(e);
      }
    } finally {
      busy = false;
      if (queued) {
        queued = false;
        queueMicrotask(poll);
      }
    }
  }
  window.addEventListener("dm-call", poll);
  const interval = setInterval(poll, 5000);
  poll();
  addEventListener("pagehide", (e) => {
    if (!e.persisted) clearInterval(interval);
  });
  return (peer) =>
    box(
      "dm-call-actions",
      ...["audio", "video"].map((kind) =>
        withIcon(
          button("", async () => {
            if (session) {
              dialog.showModal();
              return;
            }
            const c = (session = {
              peer: peer.id,
              name: peer.nickname || peer.name,
              kind,
            });
            show(c, false);
            await prepare(c, false);
          }),
          kind === "audio" ? "phone" : "reels",
          `Start ${kind} call`,
        ),
      ),
    );
}
