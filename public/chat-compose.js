import { box, n } from "./social-ui.js";
// Keep a submission key until the server confirms it. A retry after a lost
// response reuses the key; a different draft is a new message.
export function retryableComposer(form, field, send, deliver, after, report) {
  let pending;
  field.addEventListener("input", () => {
    if (field.value.trim() !== pending?.text) send.textContent = "Send";
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const original = field.value,
      text = original.trim();
    if (!text || send.disabled) return;
    if (pending?.text !== text)
      pending = { text, clientId: crypto.randomUUID() };
    send.disabled = true;
    try {
      await deliver(pending);
      pending = null;
      if (field.value === original) {
        field.value = "";
        field.dispatchEvent(new Event("input"));
      }
      send.textContent = "Send";
      await after();
    } catch (e) {
      if (pending?.text === field.value.trim()) send.textContent = "Retry send";
      report(e);
    } finally {
      send.disabled = false;
    }
  };
}
export function multiline(field, form, send, label) {
  field.id = "conversation-composer";
  field.rows = 1;
  field.maxLength = 1000;
  field.placeholder = label;
  field.setAttribute("aria-label", label);
  field.enterKeyHint = "send";
  field.title = "Enter to send · Shift+Enter for a new line";
  field.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229)
      return;
    e.preventDefault();
    if (!e.repeat && !send.disabled) form.requestSubmit(send);
  });
  const vp = window.visualViewport;
  if (vp) {
    let frame;
    function fit() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (document.activeElement !== field || vp.scale !== 1) return;
        const bottom = vp.offsetTop + vp.height,
          rect = field.getBoundingClientRect();
        document.body.style.setProperty(
          "--composer-inset",
          `${Math.max(0, innerHeight - bottom)}px`,
        );
        if (rect.bottom > bottom - 8)
          window.scrollBy({
            top: rect.bottom - bottom + 12,
            behavior: "instant",
          });
      });
    }
    field.addEventListener("focus", () => {
      vp.addEventListener("resize", fit);
      fit();
    });
    field.addEventListener("blur", () => {
      document.body.style.removeProperty("--composer-inset");
      vp.removeEventListener("resize", fit);
      cancelAnimationFrame(frame);
    });
  }
  const count = n("small", "composer-limit");
  count.id = "remaining-" + crypto.randomUUID();
  field.setAttribute("aria-describedby", count.id);
  const update = () => {
    const left = Math.max(0, field.maxLength - field.value.length);
    count.hidden = left > 100;
    count.textContent = count.hidden
      ? ""
      : `${left} ${left === 1 ? "character" : "characters"} left`;
  };
  field.addEventListener("input", update);
  update();
  return box("compose-field", field, count);
}
