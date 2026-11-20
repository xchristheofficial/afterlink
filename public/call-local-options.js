import { button, n, sheet } from "./social-ui.js";
import { check } from "./view-controls.js";
let sound,
  low = false;
try {
  low = localStorage.getItem("afterlink.lowDataCalls") === "true";
} catch {}
export const lowDataCalls = () => low;
export function ringOnce() {
  if (sound?.state !== "running") return;
  try {
    const osc = sound.createOscillator(),
      vol = sound.createGain(),
      t = sound.currentTime;
    osc.connect(vol);
    vol.connect(sound.destination);
    osc.frequency.value = 660;
    vol.gain.setValueAtTime(0, t);
    vol.gain.linearRampToValueAtTime(0.055, t + 0.03);
    vol.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.start(t);
    osc.stop(t + 0.46);
    osc.onended = () => {
      osc.disconnect();
      vol.disconnect();
    };
  } catch {}
}
export function localCallOptions() {
  const notice = n("p", "subtle"),
    data = check("Use less call data", () => {
      low = data.field.checked;
      try {
        localStorage.setItem("afterlink.lowDataCalls", String(low));
      } catch {}
    }),
    ring = button("", async (b) => {
      if (sound) {
        await sound.close().catch(() => {});
        sound = null;
      } else {
        try {
          sound = new AudioContext();
          await sound.resume();
          ringOnce();
        } catch {
          sound = null;
          notice.textContent =
            "Sound is unavailable. Incoming calls will still appear on screen.";
        }
      }
      paint();
    });
  function paint() {
    ring.textContent = sound
      ? "Silence incoming calls"
      : "Enable incoming call sound";
    ring.setAttribute("aria-pressed", String(!!sound));
  }
  paint();
  data.field.checked = low;
  sheet(
    "Local call options",
    data.root,
    n(
      "small",
      "subtle",
      "Uses lower video resolution and bitrate on your next call, including tab sharing.",
    ),
    ring,
    n(
      "small",
      "subtle",
      "Plays one short tone for an incoming call while this Messages page is open.",
    ),
    notice,
  );
}
