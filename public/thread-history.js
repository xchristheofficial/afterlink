import { box, button } from "./social-ui.js";

// Keep the scroll position, jump control and read cursor in agreement. Only
// acknowledge a batch after the latest end of the conversation is visible.
export function threadHistory(log, acknowledge) {
  const atLatest = () =>
    log.scrollHeight - log.clientHeight - log.scrollTop <= 6;
  let delivered = 0,
    confirmed = 0,
    sending = false;
  const jump = button(
    "Jump to latest ↓",
    () => {
      log.scrollTop = log.scrollHeight;
      log.focus({ preventScroll: true });
      refresh();
    },
    "thread-jump",
  );
  jump.hidden = true;
  log.tabIndex = 0;
  log.setAttribute("role", "region");
  log.setAttribute("aria-label", "Conversation history");
  const element = box("thread-history", log, jump);
  function refresh() {
    const bottom = atLatest();
    jump.hidden = bottom;
    const label = delivered > confirmed ? "New messages ↓" : "Jump to latest ↓";
    if (jump.textContent !== label) jump.textContent = label;
    if (
      !bottom ||
      document.hidden ||
      document.querySelector("dialog:modal") ||
      sending ||
      delivered <= confirmed
    )
      return;
    const through = delivered;
    sending = true;
    acknowledge(through)
      .then(() => {
        confirmed = Math.max(confirmed, through);
        sending = false;
        refresh(); // Messages may have arrived while the request was in flight.
      })
      .catch(() => {
        sending = false;
      }); // Reconcile on the next refresh instead of retrying in a loop.
  }
  log.addEventListener("scroll", refresh, { passive: true });
  document.addEventListener("visibilitychange", refresh);
  document.addEventListener("close", refresh, true);
  const observer = new ResizeObserver(refresh);
  observer.observe(log);
  window.addEventListener("pagehide", (e) => {
    if (!e.persisted) observer.disconnect();
  });
  return {
    element,
    atLatest,
    updateCursor(latest, unread) {
      if (unread) delivered = Math.max(delivered, latest);
      else confirmed = Math.max(confirmed, latest);
      refresh();
    },
    update(messages, peer) {
      for (const m of messages) {
        if (m.sender !== peer) continue;
        if (m.seen) confirmed = Math.max(confirmed, m.id);
        else delivered = Math.max(delivered, m.id);
      }
      refresh();
    },
  };
}
