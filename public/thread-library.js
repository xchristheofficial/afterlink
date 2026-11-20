import { api, button, n, box, sheet } from "./social-ui.js";
import { searchThread } from "./thread-search.js";
import { mediaBubble } from "./chat-media.js";
const key = (viewer, peer) => `afterlink.dmMarks.${viewer}.${peer}`;
function marks(viewer, peer) {
  try {
    const ids = JSON.parse(localStorage.getItem(key(viewer, peer)) || "[]");
    return Array.isArray(ids) ? ids.filter(Number.isSafeInteger) : [];
  } catch {
    return [];
  }
}
export function markButton(viewer, peer, id) {
  const old = marks(viewer, peer).includes(id);
  return button(
    old ? "Remove private bookmark" : "Bookmark on this device",
    () => {
      const ids = marks(viewer, peer).filter((i) => i !== id);
      if (!old) ids.unshift(id);
      localStorage.setItem(
        key(viewer, peer),
        JSON.stringify(ids.slice(0, 100)),
      );
      document.querySelector("#socialDialog").close();
    },
  );
}
export function threadLibrary(member, viewer) {
  const peer = member.id,
    root = box("thread-library"),
    out = box("finder-rows"),
    status = n("p", "subtle"),
    day = n("input"),
    dayLabel = n("label", "", "Conversation date");
  day.type = "date";
  dayLabel.append(day);
  status.setAttribute("role", "status");
  let seq = 0,
    before;
  const live = (v) =>
    v === seq &&
    root.isConnected &&
    document.querySelector("#socialDialog").open;
  async function batch(cursor) {
    const d = await api(
      "/thread/" + peer + (cursor ? "?before=" + cursor : ""),
    );
    if (d.viewer !== viewer) throw Error("Account changed. Reopen Messages.");
    return d;
  }
  const more = button("Check earlier attachments", () => photos(true));
  more.hidden = true;
  function start() {
    ++seq;
    out.replaceChildren();
    status.textContent = "";
    more.hidden = true;
    return seq;
  }
  async function photos(append) {
    const v = append ? ++seq : start();
    more.hidden = true;
    try {
      const d = await batch(append ? before : null);
      if (!live(v)) return;
      for (const m of [...d.messages].reverse()) {
        if (
          m.removed ||
          m.onceOnly ||
          !(m.mediaType?.startsWith("image/") || m.hasPhoto)
        )
          continue;
        out.append(
          box(
            "finder-line",
            mediaBubble(m, m.sender !== peer),
            n(
              "small",
              "subtle",
              m.body || new Date(m.created).toLocaleDateString(),
            ),
          ),
        );
      }
      before = d.messages[0]?.id;
      more.hidden = !d.more || !before;
      status.textContent = out.childElementCount
        ? `${out.childElementCount} kept images`
        : "No kept images in the checked messages.";
    } catch (e) {
      if (live(v)) {
        out.replaceChildren();
        status.textContent = e.message;
      }
    }
  }
  async function jump() {
    const v = start();
    if (!day.value) {
      status.textContent = "Choose a calendar date.";
      day.focus();
      return;
    }
    const from = new Date(day.value + "T00:00:00"),
      end = new Date(from);
    end.setDate(end.getDate() + 1);
    let d = await batch(),
      lo = 1,
      hi = d.messages.at(-1)?.id || 0;
    // Probe ID ranges, not every page between today and the chosen day. Each
    // result comes from the same permission-checked conversation endpoint.
    while (live(v)) {
      const found = d.messages.find(
        (m) => !m.removed && m.created >= from && m.created < end,
      );
      if (found) {
        searchThread(member, found.id);
        return;
      }
      if (!hi || lo > hi) break;
      const mid = lo + Math.floor((hi - lo) / 2);
      d = await batch(mid + 1);
      const last = d.messages.at(-1);
      if (!last || last.created < from) lo = mid + 1;
      else if (d.messages[0].created >= end) hi = d.messages[0].id - 1;
      else hi = mid - 1;
    }
    if (live(v)) status.textContent = "No available messages on that date.";
  }
  function bookmarks() {
    start();
    const ids = marks(viewer, peer);
    status.textContent = ids.length
      ? "Device bookmarks · open to check current access"
      : "No bookmarks on this device.";
    for (const id of ids)
      out.append(
        box(
          "view-controls",
          button("Open message " + id, async () => {
            const v = seq;
            await batch();
            if (live(v)) searchThread(member, id);
          }),
          button("Forget " + id, () => {
            localStorage.setItem(
              key(viewer, peer),
              JSON.stringify(marks(viewer, peer).filter((x) => x !== id)),
            );
            bookmarks();
          }),
        ),
      );
  }
  root.append(
    box(
      "view-controls",
      button("Kept photos and GIFs", () => photos(false)),
      button("Private bookmarks", bookmarks),
    ),
    box("view-controls", dayLabel, button("Jump to date", jump)),
    status,
    out,
    more,
  );
  sheet("Conversation library", root);
  function invalidate() {
    if (root.isConnected) {
      start();
      status.textContent = "Conversation updated. Choose a view again.";
    }
  }
  window.addEventListener("dm-mutation", invalidate);
  document.querySelector("#socialDialog").addEventListener(
    "close",
    () => {
      ++seq;
      window.removeEventListener("dm-mutation", invalidate);
    },
    { once: true },
  );
}
