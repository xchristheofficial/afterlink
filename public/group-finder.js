import { n, button, box, sheet, input, api } from "./social-ui.js";
export async function groupFinder(url, uid, anchor) {
  const root = box("thread-finder"),
    rows = box("finder-rows"),
    status = n("p", "subtle"),
    field = input("Search group messages"),
    more = button("Search earlier messages", () => run(true));
  let before,
    seq = 0;
  more.hidden = true;
  status.setAttribute("role", "status");
  const current = (v) =>
    seq === v &&
    root.isConnected &&
    document.querySelector("#socialDialog").open;
  async function run(append) {
    const v = ++seq;
    if (!append) {
      rows.replaceChildren();
      before = null;
    }
    more.hidden = true;
    const term = field.value.trim().toLocaleLowerCase();
    if (!anchor && !term) {
      status.textContent = "Enter words to find.";
      return;
    }
    status.textContent = "Checking conversation…";
    try {
      const cursor = anchor ? anchor + 1 : before;
      const d = await api(url + (cursor ? "?before=" + cursor : ""));
      if (!current(v)) return;
      if (d.pending || d.uid !== uid) throw Error("Conversation unavailable.");
      let matches;
      if (anchor) {
        if (
          d.decision?.id !== anchor ||
          !d.messages.some((m) => m.id === anchor)
        )
          throw Error("This decision changed or is no longer visible.");
        matches = d.messages.slice(-5);
      } else {
        matches = [...d.messages]
          .reverse()
          .filter((m) => m.body.toLocaleLowerCase().includes(term));
        before = d.messages[0]?.id;
        more.hidden = !before || !d.more;
      }
      for (const m of matches) {
        rows.append(
          box(
            "finder-line",
            n(
              "strong",
              "",
              m.id === anchor ? "Pinned decision · " + m.name : m.name,
            ),
            n("p", "", m.body),
            n("small", "subtle", new Date(m.created).toLocaleString()),
          ),
        );
      }
      status.textContent = anchor
        ? "Conversation leading up to the decision"
        : `${rows.childElementCount} ${rows.childElementCount === 1 ? "match" : "matches"} in checked messages.`;
    } catch (e) {
      if (current(v)) {
        rows.replaceChildren();
        status.textContent = e.message;
      }
    }
  }
  field.oninput = () => {
    ++seq;
    rows.replaceChildren();
    more.hidden = true;
    status.textContent = "";
  };
  const form = n("form", "finder-query");
  form.append(field, n("button", "", "Search"));
  form.onsubmit = (e) => {
    e.preventDefault();
    run(false);
  };
  if (!anchor) root.append(form);
  root.append(status, rows, more);
  sheet(anchor ? "Decision in context" : "Search group history", root);
  if (anchor) await run(false);
  else field.focus();
}
