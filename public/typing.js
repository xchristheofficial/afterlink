import { api, n } from "./social-ui.js";
export function typingIndicator(field, peer) {
  const label = n("small", "dm-typing");
  label.setAttribute("role", "status");
  const path = "/typing/" + peer;
  let last = 0,
    seq = 0,
    timer;
  function stop() {
    if (last) {
      last = 0;
      api(path, { active: false }).catch(() => {});
    }
  }
  field.addEventListener("input", () => {
    if (!field.value.trim()) return stop();
    if (Date.now() - last >= 2300) {
      last = Date.now();
      api(path, { active: true }).catch(() => {});
    }
  });
  field.addEventListener("blur", stop);
  async function sync() {
    const v = ++seq;
    try {
      const { remaining } = await api(path);
      if (v !== seq) return;
      clearTimeout(timer);
      label.textContent = remaining ? "Typing…" : "";
      if (remaining)
        timer = setTimeout(() => (label.textContent = ""), remaining);
    } catch {
      if (v === seq) label.textContent = "";
    }
  }
  window.addEventListener("dm-typing", sync);
  return {
    label,
    close() {
      seq++;
      clearTimeout(timer);
      window.removeEventListener("dm-typing", sync);
    },
  };
}
