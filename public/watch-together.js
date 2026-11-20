import { retryableComposer } from "./chat-compose.js";
import { typingIndicator } from "./typing.js";
import { api, box, button, input, n } from "./social-ui.js";

// The presentation is separate from camera/mic. Reserve streamless m-lines in
// the first offer so switching presenters never interrupts either face or voice.
export function watchTransport(pc, caller, constrained) {
  // First audio/video lanes are reserved for mic/camera, even on an audio start.
  // The answerer discovers the same lanes from the offer. No camera capture is
  // necessary to negotiate an empty video sender.
  if (caller && !pc.getSenders().some((s) => s.track?.kind === "video"))
    pc.addTransceiver("video", { direction: "sendrecv" });
  const primary = (kind) =>
    pc.getTransceivers().find((t) => t.receiver.track.kind === kind);
  const isCamera = (t) => t === primary(t.receiver.track.kind);
  if (caller)
    for (const kind of ["video", "audio"])
      pc.addTransceiver(kind, { direction: "sendrecv" });
  const slots = () => pc.getTransceivers().filter((t) => !isCamera(t));
  return {
    isCamera,
    cameraSender: () => primary("video")?.sender,
    answer() {
      for (const t of pc.getTransceivers()) t.direction = "sendrecv";
    },
    remote: () => new MediaStream(slots().map((t) => t.receiver.track)),
    async send(stream) {
      const lanes = slots();
      if (
        stream &&
        !lanes.some(
          (t) =>
            t.receiver.track.kind === "video" &&
            t.currentDirection === "sendrecv",
        )
      )
        throw Error("Both people need to reopen Messages to share a website.");
      await Promise.all(
        lanes.map(async (t) => {
          const track =
            stream
              ?.getTracks()
              .find((track) => track.kind === t.receiver.track.kind) || null;
          await t.sender.replaceTrack(track);
          if (track?.kind === "video") {
            const p = t.sender.getParameters();
            for (const e of p.encodings || []) {
              e.maxBitrate = constrained ? 400000 : 1500000;
              e.priority = "medium";
            }
            p.degradationPreference = "balanced";
            await t.sender.setParameters(p).catch(() => {});
          }
        }),
      );
    },
    resizeCameras(watching) {
      const sender = primary("video")?.sender;
      if (!sender?.track) return;
      const p = sender.getParameters();
      for (const e of p.encodings || []) {
        e.scaleResolutionDownBy = watching ? 1.5 : 1;
        e.maxFramerate = watching ? 15 : constrained ? 15 : 24;
        e.maxBitrate = watching
          ? constrained
            ? 120000
            : 350000
          : constrained
            ? 300000
            : 1200000;
      }
      sender.setParameters(p).catch(() => {});
    },
  };
}
export function watchTogether(c, dialog, write, constrained) {
  const root = box("watch-tools"),
    pane = box("watch-pane"),
    hint = n(
      "p",
      "subtle",
      "Open the website in another tab, then choose that tab to share. Enable tab audio in the picker to share sound. If your browser offers “Share this tab instead”, use it to switch without stopping.",
    ),
    url = input("Website address (optional)", 2048),
    setup = box("watch-setup"),
    label = n("strong"),
    notice = n("p", "watch-notice"),
    video = n("video", "watch-video"),
    field = input("Message your watch partner…", 1000),
    log = box("watch-log"),
    form = n("form", "watch-compose"),
    chat = box("watch-chat", n("strong", "", "Conversation"), log, form),
    chatToggle = n("button", "watch-view-toggle"),
    newMessages = n("span", "watch-new"),
    heading = box("watch-heading", label, chatToggle, newMessages),
    content = box("watch-content", heading, video, chat),
    send = n("button", "gradient", "Send");
  let presenter = null,
    revision = 0,
    stream = null,
    closed = false,
    opening = false,
    version = 0,
    last = "",
    latestId = null,
    collapsed = false,
    chatTimer;
  chat.id = "watch-chat-" + c.id;
  chatToggle.type = "button";
  chatToggle.setAttribute("aria-controls", chat.id);
  newMessages.setAttribute("role", "status");
  function setExpandedVideo(expand) {
    collapsed = expand;
    content.classList.toggle("watch-expanded", expand);
    chat.hidden = expand;
    chatToggle.setAttribute("aria-expanded", String(!expand));
    chatToggle.textContent = expand ? "Show conversation" : "Expand shared tab";
    if (!expand) newMessages.textContent = "";
  }
  setExpandedVideo(false);
  chatToggle.onclick = () => {
    setExpandedVideo(!collapsed);
    if (!collapsed) {
      log.scrollTop = log.scrollHeight;
      field.focus();
    }
  };
  const typing = typingIndicator(field, c.peer);
  chat.firstChild.append(typing.label);
  notice.setAttribute("role", "status");
  url.type = "url";
  video.autoplay = video.playsInline = true;
  const listenToTab = c.preferences.tabAudio(video);
  log.setAttribute("role", "log");
  field.required = true;
  form.append(field, send);
  const open = button("Open website", () => {
    try {
      let x = url.value.trim();
      if (!x || (/^[a-z][a-z0-9+.-]*:\/\//i.test(x) && !/^https?:/i.test(x)))
        throw Error();
      if (!/^https?:\/\//i.test(x)) x = "https://" + x;
      const u = new URL(x);
      if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
        throw Error();
      window.open(u.href, "_blank", "noopener,noreferrer");
      notice.textContent = "Return here and choose Share a tab.";
    } catch {
      notice.textContent = "Enter a valid website address.";
    }
  });
  const choose = button("Share a tab", start, "gradient"),
    toggle = button("Watch together", () => {
      setup.hidden = !setup.hidden;
      notice.textContent = "";
      if (!setup.hidden) url.focus();
    }),
    stop = button("Stop sharing", () => finish());
  setup.append(
    n("strong", "", "Watch a website together"),
    hint,
    box("watch-url", url, open),
    choose,
  );
  if (!navigator.mediaDevices.getDisplayMedia) {
    choose.disabled = true;
    hint.textContent =
      "This browser can watch a shared tab but cannot present one. Try a desktop browser to present.";
  }
  const pip = button("Float partner’s camera", async () => {
    try {
      if (document.pictureInPictureElement === c.remote)
        await document.exitPictureInPicture();
      else await c.remote.requestPictureInPicture();
    } catch {
      notice.textContent = "Picture-in-picture is unavailable here.";
    }
  });
  const sound = n("small", "watch-sound");
  sound.setAttribute("role", "status");
  const soundButton = button("", () => {
    const tracks = liveTabAudio();
    const on = !tracks.some((t) => t.enabled);
    for (const t of tracks) t.enabled = on;
    paintSound();
  });
  function liveTabAudio() {
    return (stream?.getAudioTracks() || []).filter(
      (t) => t.readyState === "live",
    );
  }
  function paintSound() {
    const mine = !!presenter && presenter !== c.peer && !!stream;
    const tracks = liveTabAudio();
    sound.hidden = !mine;
    soundButton.hidden = !mine || !tracks.length;
    const paused = tracks.length && !tracks.some((t) => t.enabled);
    sound.textContent = !mine
      ? ""
      : !tracks.length
        ? "No tab audio captured"
        : paused
          ? "Tab sound paused"
          : tracks.every((t) => t.muted)
            ? "Tab audio temporarily unavailable"
            : "Tab audio included";
    soundButton.textContent = paused ? "Resume tab sound" : "Pause tab sound";
  }
  const playTab = button("Play shared tab", () => playShared());
  async function playShared() {
    const source = video.srcObject;
    if (!source) return;
    try {
      await video.play();
      if (source === video.srcObject) playTab.hidden = true;
    } catch {
      if (!closed && source === video.srcObject && presenter === c.peer)
        playTab.hidden = false;
    }
  }
  playTab.hidden = true;
  paintSound();
  root.append(
    box("watch-actions", toggle, stop, pip, soundButton, playTab),
    sound,
    setup,
    notice,
  );
  pip.hidden = true;
  pane.append(content);
  stop.hidden = setup.hidden = pane.hidden = true;
  async function refresh() {
    if (closed || !presenter) return;
    const seq = ++version;
    try {
      const d = await api("/thread/" + c.peer);
      if (closed || seq !== version || !presenter) return;
      // Use message IDs, not rendered text: a repeated message is new, but a
      // refresh, receipt, or unsend on an older message is not. This indicator
      // is local to the watch layout; it does not change DM read receipts.
      if (
        collapsed &&
        latestId !== null &&
        !newMessages.textContent &&
        d.messages.some(
          (m) => m.id > latestId && m.sender === c.peer && !m.removed,
        )
      )
        newMessages.textContent = "New messages";
      latestId = Math.max(latestId ?? 0, ...d.messages.map((m) => m.id));
      const items = d.messages
        .slice(-30)
        .map((m) => [
          m.sender === c.peer ? c.name : "You",
          m.removed
            ? "Message unsent"
            : m.body ||
              (m.onceOnly
                ? "View-once attachment"
                : m.mediaType?.startsWith("audio/")
                  ? "Voice note"
                  : "Attachment"),
        ]);
      const key = JSON.stringify(items);
      if (last !== key) {
        const bottom =
          !last || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
        last = key;
        log.replaceChildren(
          ...items.map(([who, text]) =>
            box("watch-line", n("b", "", who + ": "), n("span", "", text)),
          ),
        );
        if (bottom) log.scrollTop = log.scrollHeight;
      }
    } catch (e) {
      if (!closed) notice.textContent = e.message;
    }
  }
  retryableComposer(
    form,
    field,
    send,
    ({ text, clientId }) => api("/thread/" + c.peer, { body: text, clientId }),
    async () => {
      await refresh();
      field.focus();
    },
    (e) => {
      notice.textContent = e.message;
    },
  );
  function release() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    paintSound();
  }
  function sync(owner, rev) {
    if (closed || rev < revision) return;
    revision = rev;
    pip.hidden =
      !owner ||
      !c.remoteCamera ||
      !document.pictureInPictureEnabled ||
      !c.remote.requestPictureInPicture;
    if (owner === presenter) return;
    presenter = owner;
    setExpandedVideo(false);
    latestId = null;
    paintSound();
    playTab.hidden = true;
    c.watchTransport.resizeCameras(!!owner);
    const mine = owner && owner !== c.peer;
    listenToTab(owner === c.peer);
    dialog.classList.toggle("watching", !!owner);
    pane.hidden = !owner;
    toggle.hidden = !!owner;
    stop.hidden = !mine;
    setup.hidden = true;
    notice.textContent = "";
    clearInterval(chatTimer);
    if (!owner) {
      if (document.pictureInPictureElement === c.remote)
        document.exitPictureInPicture().catch(() => {});
      video.pause();
      video.srcObject = null;
      release();
      version++;
      last = "";
      log.replaceChildren();
      return;
    }
    label.textContent = mine
      ? "You are sharing a tab"
      : `${c.name} is sharing a tab`;
    video.srcObject = mine ? stream : c.watchTransport.remote();
    playShared();
    refresh();
    chatTimer = setInterval(refresh, 6000);
  }
  async function finish() {
    release();
    video.srcObject = null;
    try {
      await c.watchTransport.send(null);
    } finally {
      if (!closed && presenter && presenter !== c.peer) {
        try {
          const r = await write("watch", { id: c.id, step: "stop" });
          sync(r.presenter, r.watchVersion);
        } catch (e) {
          notice.textContent = e.message;
        }
      }
    }
  }
  async function start() {
    if (closed || opening || presenter) return;
    opening = true;
    let selected,
      claimed = false;
    try {
      selected = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "browser",
          width: { ideal: constrained ? 640 : 1280, max: 1280 },
          height: { ideal: constrained ? 360 : 720, max: 720 },
          frameRate: { ideal: constrained ? 12 : 24, max: 30 },
        },
        audio: true,
        surfaceSwitching: "include",
        selfBrowserSurface: "exclude",
        systemAudio: "exclude",
      });
      const track = selected.getVideoTracks()[0];
      if (
        !track ||
        track.readyState !== "live" ||
        (track.getSettings().displaySurface &&
          track.getSettings().displaySurface !== "browser")
      )
        throw Error("Choose a browser tab rather than an entire screen.");
      if (closed || presenter) return;
      stream = selected;
      for (const audio of stream.getAudioTracks())
        for (const event of ["mute", "unmute", "ended"])
          audio.addEventListener(event, paintSound);
      stream.addEventListener("removetrack", paintSound);

      const r = await write("watch", { id: c.id, step: "start" });
      claimed = true;
      if (closed || !r.presenter) return;
      sync(r.presenter, r.watchVersion);
      await c.watchTransport.send(selected);
      track.onended = () => finish().catch(() => {});
      if (track.readyState === "ended") await finish();
    } catch (e) {
      if (claimed && !closed) await finish();
      notice.textContent =
        e.name === "NotAllowedError" ? "No tab was shared." : e.message;
    } finally {
      opening = false;
      if (!claimed || closed || selected !== stream) {
        selected?.getTracks().forEach((t) => t.stop());
        if (stream === selected) stream = null;
      }
    }
  }
  window.addEventListener("dm-chat", refresh);
  return {
    root,
    pane,
    sync,
    close() {
      closed = true;
      typing.close();
      version++;
      clearInterval(chatTimer);
      window.removeEventListener("dm-chat", refresh);
      release();
      video.srcObject = null;
      dialog.classList.remove("watching");
      pane.remove();
      root.remove();
    },
  };
}
