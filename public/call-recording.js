import { box, button, n, error } from "./social-ui.js";
// No recording bytes go to AfterLink. Capture choice and final download are local.
export function callRecording(c, write) {
  const panel = box("record-controls");
  let state = null,
    closed = false,
    version = 0,
    revision = 0,
    rec = null,
    screen = null,
    ctx = null,
    timeout,
    starting = false;
  const owns = () => state && state.owner !== c.peer;
  async function step(next) {
    const result = await write("recording", { id: c.id, step: next });
    if (!closed) sync(result.recording, result.recordVersion);
  }
  function cleanup() {
    clearTimeout(timeout);
    screen?.getTracks().forEach((t) => t.stop());
    screen = null;
    ctx?.close().catch(() => {});
    ctx = null;
  }
  function stop() {
    if (rec && rec.state !== "inactive") rec.stop();
    cleanup();
  }
  function save(parts, type) {
    if (!parts.some((p) => p.size)) return;
    const blob = new Blob(parts, { type }),
      url = URL.createObjectURL(blob),
      link = n("a");
    link.href = url;
    link.download = `AfterLink-call-${Date.now()}.${type.includes("mp4") ? (type.startsWith("audio") ? "m4a" : "mp4") : "webm"}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function start(withScreen) {
    if (starting || !owns() || state.state !== "allowed") return;
    starting = true;
    const v = version;
    let display;
    try {
      if (withScreen)
        display = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 15, max: 24 },
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
          },
          audio: false,
        });
      if (closed || v !== version) {
        display?.getTracks().forEach((t) => t.stop());
        return;
      }
      screen = display;
      ctx = new AudioContext();
      await ctx.resume();
      if (closed || v !== version) return;
      const dest = ctx.createMediaStreamDestination();
      for (const stream of [c.stream, c.remote.srcObject]) {
        if (!stream?.getAudioTracks().length)
          throw Error("Call audio is not ready.");
        ctx.createMediaStreamSource(stream).connect(dest);
      }
      const output = new MediaStream([
          ...dest.stream.getAudioTracks(),
          ...(screen?.getVideoTracks() || []),
        ]),
        types = withScreen
          ? ["video/webm;codecs=vp8,opus", "video/mp4", "video/webm"]
          : ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
      const type = types.find((t) => MediaRecorder.isTypeSupported(t));
      if (!type) throw Error("This recording format is not supported.");
      const r = new MediaRecorder(output, {
          mimeType: type,
          audioBitsPerSecond: 96000,
          ...(withScreen ? { videoBitsPerSecond: 1500000 } : {}),
        }),
        parts = [];
      let bytes = 0;
      // Re-check server-side consent after the system picker returns and before recording.
      await step("begin");
      if (closed || !owns() || state.state !== "active") return;
      rec = r;
      const finish = () => {
        stop();
        if (!closed && owns()) step("stop").catch(error);
      };
      r.ondataavailable = (e) => {
        parts.push(e.data);
        bytes += e.data.size;
        if (bytes >= 64 * 1024 * 1024 && r.state === "recording") finish();
      };
      r.onstop = () => {
        save(parts, r.mimeType);
        if (rec === r) rec = null;
      };
      r.onerror = () => {
        finish();
        error("Recording interrupted.");
      };
      r.start(1000);
      if (screen) screen.getVideoTracks()[0].onended = finish;
      timeout = setTimeout(finish, 10 * 60 * 1000);
    } catch (e) {
      if (!closed && owns()) await step("stop").catch(() => {});
      if (e.name !== "NotAllowedError") error(e);
    } finally {
      starting = false;
      if (!rec) cleanup();
    }
  }
  function sync(next, rev) {
    if (rev < revision || closed) return;
    revision = rev;
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    version++;
    state = next;
    if (!owns() || state.state !== "active") stop();
    draw();
  }
  function draw() {
    panel.replaceChildren();
    if (!state) {
      if (window.MediaRecorder && window.AudioContext)
        panel.append(button("Request recording", () => step("request")));
      return;
    }
    const mine = owns();
    const text =
      state.state === "requested"
        ? mine
          ? "Waiting for recording consent…"
          : `${c.name} wants to record this call.`
        : state.state === "active"
          ? "Recording this call"
          : "Recording permitted";
    panel.append(n("strong", "", text));
    if (state.state === "requested" && !mine)
      panel.append(button("Allow recording", () => step("allow")));
    if (state.state === "allowed" && mine) {
      panel.append(
        n(
          "small",
          "subtle",
          "Saved on this device. Choose only the screen or tab you want to record.",
        ),
      );
      if (navigator.mediaDevices.getDisplayMedia)
        panel.append(button("Record screen + audio", () => start(true)));
      panel.append(button("Record audio only", () => start(false)));
    }
    panel.append(
      button(
        state.state === "requested" && !mine
          ? "Decline recording"
          : "Stop recording",
        () => {
          stop();
          return step("stop");
        },
      ),
    );
  }
  draw();
  return {
    panel,
    sync,
    close() {
      closed = true;
      version++;
      stop();
    },
  };
}
