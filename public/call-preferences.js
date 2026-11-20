import { outputPicker } from "./call-output.js";
import { connectionEstimate } from "./call-quality.mjs";
import { box, n, button } from "./social-ui.js";

// Playback controls act on the media element, never on the WebRTC tracks:
// muting a voice locally must not mute a recording or the other person's mic.
function playback(media, name) {
  const row = box("call-level"),
    label = n("label", "", name),
    slider = n("input"),
    value = n("span", "call-level-value");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  slider.setAttribute("aria-label", name);
  value.setAttribute("aria-hidden", "true");
  // Some mobile browsers only expose hardware volume. Offer a real mute
  // switch there rather than a slider that moves without changing the sound.
  let adjustable = false;
  const original = media.volume;
  try {
    media.volume = 0.5;
    adjustable = media.volume === 0.5;
    media.volume = original;
  } catch {}
  if (!adjustable) {
    slider.type = "checkbox";
    slider.setAttribute("aria-label", `Mute ${name.toLowerCase()}`);
    label.textContent = `Mute ${name.toLowerCase()}`;
  }
  function sync() {
    if (adjustable) {
      const percent = Math.round((media.muted ? 0 : media.volume) * 100);
      slider.value = String(percent);
      value.textContent = `${percent}%`;
      slider.setAttribute("aria-valuetext", value.textContent);
    } else slider.checked = media.muted;
  }
  slider.oninput = () => {
    if (adjustable) {
      media.volume = Number(slider.value) / 100;
      media.muted = media.volume === 0;
    } else media.muted = slider.checked;
    sync();
  };
  label.append(slider);
  row.append(label, value);
  media.addEventListener("volumechange", sync);
  sync();
  return row;
}

export function callPreferences(remote, local, pc) {
  const root = n("details", "call-preferences"),
    summary = n("summary", "", "My call settings"),
    body = box("call-preferences-body"),
    preview = n("input"),
    previewLabel = n("label", "call-preview-option"),
    note = n(
      "small",
      "subtle",
      "These settings affect only you. Hiding your preview keeps your camera on.",
    );
  preview.type = "checkbox";
  preview.checked = true;
  function syncCamera() {
    const on = local.srcObject
      ?.getVideoTracks()
      .some((t) => t.readyState === "live");
    preview.disabled = !on;
    local.hidden = !on || !preview.checked;
  }
  preview.onchange = syncCamera;
  previewLabel.append(preview, "Show my camera preview");
  body.append(
    playback(remote, "Partner volume"),
    outputPicker(remote, "partner voice"),
    previewLabel,
    note,
  );
  const quality = n("small", "call-quality");
  quality.setAttribute("role", "status");
  const check = button("Check connection", async () => {
    if (pc.connectionState !== "connected") {
      quality.textContent = "Connect the call first, then check again.";
      return;
    }
    quality.textContent = "Measuring call connection…";
    try {
      const first = await pc.getStats();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (!root.isConnected || pc.connectionState !== "connected") {
        quality.textContent =
          "Call connection changed. Try again when connected.";
        return;
      }
      const { rating, delay, loss, path } = connectionEstimate(
        first,
        await pc.getStats(),
      );
      quality.textContent = [
        "Connection estimate: " + rating,
        delay === null ? "Delay unavailable" : `${delay} ms round trip`,
        loss === null
          ? "Audio loss unavailable"
          : `${loss.toFixed(1)}% incoming audio loss`,
        path,
      ]
        .filter(Boolean)
        .join(" · ");
    } catch {
      quality.textContent =
        "Connection measurements are unavailable in this browser.";
    }
  });
  body.append(box("call-quality-check", check, quality));
  root.append(summary, body);
  syncCamera();
  return {
    root,
    syncCamera,
    tabAudio(video) {
      const level = box(
        "call-tab-playback",
        playback(video, "Shared tab volume"),
        outputPicker(video, "shared tab"),
      );
      level.hidden = true;
      previewLabel.before(level);
      // Keep the viewer's mute choice when presenters swap. Never replay the
      // presenter's own capture alongside the original tab.
      let wasViewer = false,
        viewerMuted = false;
      return (viewer) => {
        if (wasViewer) viewerMuted = video.muted;
        wasViewer = viewer;
        level.hidden = !viewer;
        video.controls = viewer;
        video.muted = !viewer || viewerMuted;
      };
    },
  };
}
