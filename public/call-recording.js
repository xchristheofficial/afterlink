import {
  recordingProgress,
  RECORDING_MS,
  RECORDING_BYTES,
} from "./recording-progress.js";
import { box, button, n, error } from "./social-ui.js";
// No recording bytes go to AfterLink. Capture choice and final download are local.
export function callRecording(c, write, offerDownload) {
  const panel = box("record-controls"),
    clock = n("span", "record-clock"),
    warning = n("small", "record-limit");
  clock.setAttribute("role", "timer");
  clock.setAttribute("aria-label", "Elapsed recording time");
  warning.setAttribute("role", "status");
  let base = 0,
    bytes = 0;
  function tick() {
    if (state?.state !== "active" || closed) return;
    const progress = recordingProgress(performance.now() - base, bytes);
    clock.textContent = progress.time;
    const message = owns() ? progress.warning : "";
    if (warning.textContent !== message) warning.textContent = message;
  }
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
    if (!closed)
      sync(result.recording, result.recordVersion, result.recordElapsedMs);
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
      bytes = 0;
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
        tick();
        if (bytes >= RECORDING_BYTES && r.state === "recording") finish();
      };
      r.onstop = () => {
        offerDownload(new Blob(parts, { type: r.mimeType }));
        if (rec === r) rec = null;
      };
      r.onerror = () => {
        finish();
        error("Recording interrupted.");
      };
      r.start(1000);
      if (screen) screen.getVideoTracks()[0].onended = finish;
      timeout = setTimeout(finish, RECORDING_MS);
    } catch (e) {
      if (!closed && owns()) await step("stop").catch(() => {});
      if (e.name !== "NotAllowedError") error(e);
    } finally {
      starting = false;
      if (!rec) cleanup();
    }
  }
  function sync(next, rev, elapsed = 0) {
    if (rev < revision || closed) return;
    revision = rev;
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    version++;
    if (next?.state === "active") base = performance.now() - elapsed;
    state = next;
    if (!owns() || state.state !== "active") stop();
    draw();
  }
  const scope =
    "Records both call microphones. The recorder can also include the picture from a screen or tab they choose. Shared-tab and system sound are not mixed in. The file stays on the recorder’s device. Either person can stop it.";
  function review() {
    if (state || closed) return;
    panel.replaceChildren(
      n("strong", "", "Before requesting recording"),
      n("small", "subtle", scope),
      button("Ask for consent", () => step("request")),
      button("Cancel", draw),
    );
  }
  function draw() {
    panel.replaceChildren();
    if (!state) {
      if (window.MediaRecorder && window.AudioContext)
        panel.append(button("Request recording", review));
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
    if (state.state === "active") {
      panel.append(clock, warning);
      tick();
    }
    if (state.state === "requested" && !mine)
      panel.append(
        n("small", "subtle", scope),
        button("Allow recording", () => step("allow")),
      );
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
    tick,
    needsSync: () => !!state || starting,
    close() {
      closed = true;
      version++;
      stop();
    },
  };
}
