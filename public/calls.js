import { ringOnce, lowDataCalls } from "./call-local-options.js";
import { recordingDownload } from "./recording-download.js";
import { callPreferences } from "./call-preferences.js";
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
    busy = false,
    retryNotice;
  const dialog = n("dialog", "call-panel"),
    title = n("h2"),
    status = n("p", "subtle"),
    timer = n("span", "call-time"),
    portrait = box("call-person"),
    stage = box("call-stage"),
    controls = box("call-controls");
  dialog.setAttribute("aria-label", "AfterLink call");
  const size = n("select"),
    sizeLabel = n("label", "call-size-label", "Call size");
  for (const label of ["Small", "Medium", "Large"])
    size.add(new Option(label, label.toLowerCase()));
  sizeLabel.append(size);
  size.onchange = () => {
    dialog.dataset.size = size.value;
  };
  const corner = n("select"),
    cornerLabel = n("label", "call-corner-label", "Dock position");
  for (const label of ["Bottom right", "Bottom left", "Top left", "Top right"])
    corner.add(new Option(label, label.toLowerCase().replace(" ", "-")));
  cornerLabel.append(corner);
  corner.onchange = () => {
    dialog.dataset.corner = corner.value;
  };
  function dock() {
    // Switch only the dialog mode: keep the same video elements, tracks and RTC session.
    dialog.close();
    dialog.dataset.size = "minimized";
    dialog.show();
    restore.focus();
  }
  const minimize = button("Minimize", dock);
  function expand() {
    if (dialog.dataset.size === "minimized") dialog.close();
    dialog.dataset.size = size.value;
    if (!dialog.open) dialog.showModal();
    size.focus();
  }
  const restore = button("Restore call", expand, "call-restore");
  dialog.append(
    box("call-view-tools", sizeLabel, minimize, cornerLabel, restore),
    title,
    status,
    stage,
    timer,
    controls,
  );
  const downloads = recordingDownload();
  document.body.append(dialog, downloads.root);
  const write = (action, extra) => api("/calls", { action, ...extra });
  function release(c) {
    if (!c) return;
    c.watch?.close();
    c.preferences?.root.remove();
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
    document.body.append(downloads.root);
    dialog.close();
    stage.replaceChildren();
    controls.replaceChildren();
    timer.textContent = "";
  }
  async function end(c, action = "end") {
    if (!c || c !== session) return;
    reset(c);
    if (c.id) await write(action, { id: c.id }).catch(() => {});
  }
  function clearRetry() {
    retryNotice?.remove();
    retryNotice = null;
  }
  async function startOutgoing(peer, name, kind, answerMuted = false) {
    if (session) return expand();
    const c = (session = { peer, name, kind, answerMuted });
    show(c, false);
    await prepare(c, false);
  }
  function connectionFailed(c) {
    if (session !== c) return;
    const { peer, name } = c;
    // A camera-off or mic-only answer must not turn into a camera-on retry.
    const kind = c.stream
      ?.getVideoTracks()
      .some((t) => t.enabled && t.readyState === "live")
      ? "video"
      : "audio";
    const muted = !c.stream
      ?.getAudioTracks()
      .some((t) => t.enabled && t.readyState === "live");
    const ending = end(c); // Releases local capture before awaiting signaling.
    const notice = box("call-notice call-retry"),
      summary = n("strong", "", `Call with ${name} lost its connection.`);
    summary.setAttribute("role", "status");
    const retry = button(`Redial with ${kind}`, () => {
      if (retryNotice !== notice || session) return;
      return startOutgoing(peer, name, kind, muted);
    });
    retry.disabled = true;
    notice.append(
      summary,
      n(
        "small",
        "",
        "Try another network if the problem continues." +
          (muted ? " Your mic will start muted." : ""),
      ),
      box("call-retry-actions", retry, button("Dismiss", clearRetry)),
    );
    retryNotice = notice;
    document.body.append(notice);
    ending.then(() => {
      if (retryNotice === notice) retry.disabled = false;
    });
  }
  dialog.oncancel = (e) => {
    e.preventDefault();
    if (session?.talking) {
      if (dialog.dataset.size !== "minimized") dock();
    } else end(session);
  };
  addEventListener("pagehide", () => {
    clearRetry();
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
  addEventListener("afterlink-session-expired", () => {
    clearRetry();
    if (session) reset(session);
  });
  function show(c, incoming) {
    clearRetry();
    dialog.append(downloads.root);
    size.value = dialog.dataset.size = "medium";
    corner.value = dialog.dataset.corner = "bottom-right";
    title.title = c.name;
    minimize.hidden = true;
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
      () => end(c, incoming ? "decline" : "end"),
      "call-end",
    );
    controls.replaceChildren(hang);
    if (incoming) {
      const muted = n("input"),
        label = n("label", "answer-muted");
      muted.type = "checkbox";
      muted.checked = !!c.answerMuted;
      muted.onchange = () => {
        c.answerMuted = muted.checked;
      };
      label.append(muted, "Start with mic muted");
      controls.append(label);
      const video = c.kind === "video";
      controls.append(
        button(
          video ? "Answer with camera" : "Accept",
          () => prepare(c, true, video),
          "gradient",
        ),
      );
      if (video)
        controls.append(
          button("Answer with mic only", () => prepare(c, true, false)),
        );
    }
    if (!dialog.open) dialog.showModal();
  }
  async function prepare(c, incoming, useCamera = c.kind === "video") {
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
          lowDataCalls() ||
          connection?.saveData ||
          ["slow-2g", "2g", "3g"].includes(connection?.effectiveType);
      const cameraConstraints = {
        width: { ideal: constrained ? 320 : 640, max: 1280 },
        height: { ideal: constrained ? 180 : 360, max: 720 },
        frameRate: {
          ideal: constrained ? 15 : 24,
          max: constrained ? 20 : 30,
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: { ideal: 1 },
        },
        video: useCamera && cameraConstraints,
      });
      if (c !== session) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      // Apply the choice before accepting or attaching any track to WebRTC.
      const mic = stream.getAudioTracks()[0];
      if (c.answerMuted) mic.enabled = false;
      c.stream = stream;
      const result = incoming
        ? await write("accept", { id: c.id, camera: useCamera })
        : await write("start", { peer: c.peer, kind: c.kind });
      if (c !== session) {
        await write("end", { id: c.id || result.id }).catch(() => {});
        return;
      }
      c.id = c.id || result.id;
      c.talking = true;
      minimize.hidden = false;
      const pc = (c.pc = new RTCPeerConnection({
        iceServers: result.iceServers,
        bundlePolicy: "max-bundle",
      }));
      stream.getTracks().forEach((track) => {
        if (track.kind === "audio" && "contentHint" in track)
          track.contentHint = "speech";
        pc.addTrack(track, stream);
      });
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
      c.remote = n("video", "call-remote");
      c.remote.srcObject = new MediaStream();
      c.remote.autoplay = true;
      c.remote.playsInline = true;
      stage.append(c.remote);
      c.local = n("video", "call-local");
      c.local.autoplay = c.local.muted = c.local.playsInline = true;
      c.local.srcObject = stream;
      c.local.hidden = !stream.getVideoTracks().length;
      stage.append(c.local);
      c.preferences = callPreferences(c.remote, c.local, pc);
      controls.after(c.preferences.root);
      pc.ontrack = (e) => {
        if (c !== session) return;
        if (c.watchTransport && !c.watchTransport.isCamera(e.transceiver))
          return;
        if (!c.remote.srcObject.getTracks().includes(e.track))
          c.remote.srcObject.addTrack(e.track);
        c.remote.play().catch(() => {
          if (c === session)
            controls.append(
              button("Play incoming media", () => c.remote.play()),
            );
        });
      };
      status.textContent = incoming ? "Connecting…" : "Ringing…";
      title.textContent = `${c.kind === "video" ? "Video" : "Audio"} call · ${c.name}`;
      const micState = n("span", "dock-mic");
      micState.setAttribute("role", "status");
      const micButton = button("", () => {
        mic.enabled = !mic.enabled;
        paintMic();
      });
      function paintMic() {
        const on = mic.enabled;
        micButton.textContent = on ? "Mute" : "Unmute";
        micButton.setAttribute("aria-pressed", String(!on));
        micState.textContent =
          mic.readyState !== "live" || mic.muted
            ? "Mic unavailable"
            : on
              ? "Mic on"
              : "Mic muted";
      }
      for (const event of ["mute", "unmute", "ended"])
        mic.addEventListener(event, paintMic);
      paintMic();
      c.mode = c.kind;
      c.modeVersion = 0;
      c.remoteCamera = c.kind === "video";
      const feedback = n("span", "call-feedback");
      feedback.setAttribute("role", "status");
      const camera = button("Camera off", () =>
          changeMode(stream.getVideoTracks().length ? "camera-off" : "video"),
        ),
        mode = button("", () =>
          changeMode(c.mode === "video" ? "audio" : "video"),
        );
      function paint() {
        const on = stream.getVideoTracks().length > 0;
        c.preferences.syncCamera();
        camera.hidden = c.mode !== "video";
        camera.textContent = on ? "Camera off" : "Camera on";
        mode.textContent =
          c.mode === "video" ? "Switch to audio" : "Switch to video";
        title.textContent = `${c.mode === "video" ? "Video" : "Audio"} call · ${c.name}`;
        if (c.remoteCamera && pc.connectionState === "connected")
          portrait.remove();
        else if (!stage.contains(portrait)) stage.prepend(portrait);
      }
      function dropCamera() {
        for (const t of stream.getVideoTracks()) {
          t.stop();
          stream.removeTrack(t);
        }
        c.local.hidden = true;
      }
      c.syncMode = (next) => {
        if (next.modeVersion < c.modeVersion) return;
        c.modeVersion = next.modeVersion;
        c.mode = next.mode;
        c.remoteCamera = next.remoteCamera;
        if (!next.localCamera && stream.getVideoTracks().length) {
          dropCamera();
          c.watchTransport
            .cameraSender()
            ?.replaceTrack(null)
            .catch(() => {});
        }
        paint();
      };
      let switching = false;
      async function changeMode(step) {
        if (switching || session !== c) return;
        switching = true;
        feedback.textContent = "";
        const version = c.modeVersion;
        let track;
        try {
          const sender = c.watchTransport.cameraSender();
          if (step === "video") {
            if (!sender)
              throw Error("Reopen Messages on both devices to enable video.");
            track = (
              await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: cameraConstraints,
              })
            ).getVideoTracks()[0];
          } else {
            dropCamera();
            if (sender) await sender.replaceTrack(null);
          }
          if (session !== c) return;
          const next = await write("mode", { id: c.id, step, version });
          if (session !== c || next.modeVersion < c.modeVersion) return;
          if (track) {
            await sender.replaceTrack(track);
            if (session !== c || next.modeVersion < c.modeVersion) return;
            stream.addTrack(track);
            track = null;
            c.watchTransport.resizeCameras(
              dialog.classList.contains("watching"),
            );
          }
          c.syncMode(next);
        } catch (e) {
          feedback.textContent =
            e.name === "NotAllowedError"
              ? "Camera permission was denied. Audio is still connected."
              : e.message;
        } finally {
          track?.stop();
          switching = false;
          if (session === c) paint();
        }
      }
      controls.replaceChildren(
        micState,
        micButton,
        camera,
        mode,
        button("End call", () => end(c), "call-end"),
        feedback,
      );
      mode.hidden = camera.disabled = true;
      paint();
      queueMicrotask(poll);
      pc.onconnectionstatechange = () => {
        if (c !== session) return;
        if (pc.connectionState === "connected") {
          status.textContent = "Connected";
          mode.hidden = camera.disabled = false;
          paint();
          if (!c.clock) {
            tuneSenders(pc, constrained);
            if (c.watchTransport) {
              c.watch = watchTogether(c, dialog, write, constrained);
              stage.before(c.watch.pane);
              controls.after(c.watch.root);
            }
            c.recording = callRecording(c, write, downloads.forCall());
            controls.after(c.recording.panel);
            const start = Date.now();
            const tick = () => {
              c.recording.tick();
              const t = Math.floor((Date.now() - start) / 1000);
              timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
            };
            tick();
            c.clock = setInterval(tick, 1000);
          }
        } else if (pc.connectionState === "failed") {
          connectionFailed(c);
        } else if (pc.connectionState === "disconnected")
          status.textContent = "Reconnecting…";
      };
    } catch (e) {
      if (c !== session) return;
      if (
        incoming &&
        useCamera &&
        !c.stream &&
        [
          "NotAllowedError",
          "NotFoundError",
          "NotReadableError",
          "OverconstrainedError",
        ].includes(e.name)
      ) {
        c.preparing = false;
        show(c, true);
        status.textContent =
          "Couldn’t open the camera and microphone. Try answering with mic only, or check device permissions.";
        return;
      }
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
    let readingStatus = true;
    try {
      const { call, outcome } = await api(
        "/calls" +
          (before?.talking
            ? "?live=" +
              encodeURIComponent(before.id) +
              "&offset=" +
              (before.offset || 0) +
              (before.pc?.remoteDescription ? "&synced=1" : "")
            : ""),
      );
      readingStatus = false;
      if (before !== session || priorId !== session?.id) return;
      if (before?.retrySince) {
        delete before.retrySince;
        status.textContent =
          before.pc.connectionState === "connected"
            ? "Connected"
            : "Reconnecting…";
      }
      if (!call || (session?.id && call.id !== session.id)) {
        if (session?.id) {
          const result = !call ? outcome : null;
          reset(session);
          const notice = n(
            "p",
            "call-notice",
            result === "declined"
              ? "Call declined."
              : result === "unanswered"
                ? "No answer."
                : "Call ended.",
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
          ringOnce();
        }
        return;
      }
      const c = session;
      if (!c.pc || call.state !== "accepted") return;
      c.syncMode?.(call);
      c.watch?.sync(call.presenter, call.watchVersion);
      c.recording?.sync(
        call.recording,
        call.recordVersion,
        call.recordElapsedMs,
      );
      if (c.pc.connectionState !== "connected" && !c.clock) {
        status.textContent = "Connecting…";
        c.connectStart ??= Date.now();
        if (Date.now() - c.connectStart > 35000) return connectionFailed(c);
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
        // Losing one status read need not interrupt an established media path.
        // Never ignore access failures or extend a recording without consent updates.
        if (
          readingStatus &&
          before.pc?.connectionState === "connected" &&
          !before.recording?.needsSync() &&
          (e instanceof TypeError ||
            e.status >= 500 ||
            [408, 429].includes(e.status))
        ) {
          before.retrySince ??= Date.now();
          if (Date.now() - before.retrySince < 12000) {
            status.textContent = "Call controls reconnecting…";
            return;
          }
        }
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
          button("", () =>
            startOutgoing(peer.id, peer.nickname || peer.name, kind),
          ),
          kind === "audio" ? "phone" : "reels",
          `Start ${kind} call`,
        ),
      ),
    );
}
