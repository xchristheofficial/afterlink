import { box, n } from "./social-ui.js";

// Select playback on this element, never a capture device. Do not enumerate
// devices until asked, or persist/log device IDs (they are origin-specific).
export function outputPicker(media, name) {
  const root = box("call-output"),
    devices = navigator.mediaDevices;
  if (
    typeof media.setSinkId !== "function" ||
    (!devices?.selectAudioOutput && !devices?.enumerateDevices)
  ) {
    root.append(
      n(
        "small",
        "subtle",
        `Use your device’s sound settings to change the ${name} output.`,
      ),
    );
    return root;
  }
  const choose = n("button", "", `Choose ${name} output`),
    reset = n("button", "", "Use system default"),
    select = n("select"),
    status = n("small", "subtle", "Output: system default");
  select.setAttribute("aria-label", `${name} output device`);
  status.setAttribute("role", "status");
  choose.type = reset.type = "button";
  reset.setAttribute("aria-label", `Use system default for ${name}`);
  reset.hidden = select.hidden = true;
  let busy = false;
  const run = async (action) => {
    if (busy) return;
    busy = choose.disabled = reset.disabled = select.disabled = true;
    try {
      await action();
    } catch (e) {
      if (e.name === "AbortError")
        status.textContent = "Selection cancelled. Output unchanged.";
      else if (e.name === "NotAllowedError")
        status.textContent =
          "Speaker access was not granted. Use your device’s sound settings or try again.";
      else
        status.textContent =
          "Could not switch output. Check the device connection and try again.";
      select.value = media.sinkId || "";
    } finally {
      busy = choose.disabled = reset.disabled = select.disabled = false;
    }
  };
  async function apply(id, label) {
    if (!root.isConnected) return;
    await media.setSinkId(id);
    select.hidden = true;
    reset.hidden = !id;
    status.textContent = `Output: ${id ? label || "selected device" : "system default"}`;
  }
  choose.onclick = () =>
    run(async () => {
      // Call the browser picker directly from the user gesture when available.
      if (typeof devices.selectAudioOutput === "function") {
        const d = await devices.selectAudioOutput();
        await apply(d.deviceId, d.label);
      } else {
        const outputs = (await devices.enumerateDevices()).filter(
          (d) =>
            d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default",
        );
        if (!root.isConnected) return;
        select.replaceChildren(
          new Option("System default", ""),
          ...outputs.map(
            (d, i) => new Option(d.label || `Output ${i + 1}`, d.deviceId),
          ),
        );
        select.value = media.sinkId || "";
        select.hidden = !outputs.length;
        status.textContent = outputs.length
          ? "Choose an output for this call."
          : "No alternative outputs available. Check your device’s sound settings.";
      }
    }).then(() => {
      if (!select.hidden) select.focus();
    });
  select.onchange = () =>
    run(() => apply(select.value, select.selectedOptions[0]?.label)).then(
      () => {
        if (select.hidden) choose.focus();
      },
    );
  reset.onclick = () =>
    run(() => apply("", "")).then(() => {
      if (reset.hidden) choose.focus();
    });
  root.append(choose, select, reset, status);
  return root;
}
