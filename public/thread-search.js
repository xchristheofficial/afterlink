import { api, box, button, input, n, sheet } from "./social-ui.js";

export function searchThread(member, anchor) {
  const peer = member.id,
    title = member.nickname || member.name,
    root = box("thread-finder"),
    field = input("Search text or captions", 100),
    form = n("form", "finder-form"),
    submit = n("button", "gradient", "Search"),
    notice = n("p", "subtle"),
    rows = box("finder-rows"),
    detail = box("finder-context");
  const filters = n("details", "finder-filters"),
    summary = n("summary", "", "Filters"),
    sender = n("select"),
    from = n("input"),
    through = n("input");
  sender.add(new Option("Anyone", "any"));
  sender.add(new Option("You", "me"));
  sender.add(new Option(title, "partner"));
  from.type = through.type = "date";
  function labeled(label, control) {
    const el = n("label", "", label);
    el.append(control);
    return el;
  }
  const clear = button("Clear filters", () => {
    sender.value = "any";
    from.value = through.value = "";
    changed();
  });
  filters.append(
    summary,
    box(
      "finder-filter-fields",
      labeled("Sent by", sender),
      labeled("From date", from),
      labeled("Through date", through),
      clear,
    ),
  );
  // Convert inclusive local calendar dates into [start, end) instants. A day
  // spanning a clock change need not be 24 hours long.
  function boundary(value, following = false) {
    if (!value) return undefined;
    const d = new Date(value + "T00:00:00");
    if (following) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const dialog = document.querySelector("#socialDialog");
  let version = 0,
    term = "",
    before,
    query,
    selected;
  const current = (v) => v === version && root.isConnected && dialog.open;
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  function stamp(m) {
    return n(
      "small",
      "subtle",
      `${m.sender === peer ? title : "You"} · ${date.format(m.created)}`,
    );
  }
  function snippet(body) {
    const text = n("span"),
      offset = body.toLowerCase().indexOf(term.toLowerCase());
    if (!term || offset < 0) {
      text.textContent = body;
      return text;
    }
    const start = Math.max(0, offset - 32),
      end = offset + term.length;
    text.append(
      (start ? "…" : "") + body.slice(start, offset),
      n("mark", "", body.slice(offset, end)),
      body.slice(end, end + 90) + (body.length > end + 90 ? "…" : ""),
    );
    return text;
  }
  const more = button("More results", () => find(true));
  async function find(append) {
    const v = ++version;
    if (!append) {
      term = field.value.trim();
      before = undefined;
      rows.replaceChildren();
      query = {
        term,
        from: sender.value,
        startMs: boundary(from.value),
        endMs: boundary(through.value, true),
      };
      if (!term && sender.value === "any" && !from.value && !through.value) {
        notice.textContent = "Enter search text or choose a filter.";
        return;
      }
      if (query.startMs >= query.endMs) {
        notice.textContent = "The end date must not precede the start date.";
        return;
      }
    }
    more.hidden = true;
    notice.textContent = "Searching…";
    try {
      const d = await api(`/thread/${peer}/search`, { ...query, before });
      if (!current(v)) return;
      for (const m of d.messages) {
        const item = button("", () => context(m.id, item), "finder-result");
        item.append(stamp(m), snippet(m.body));
        rows.append(item);
        before = m.id;
      }
      more.hidden = !d.more;
      const count = rows.childElementCount;
      notice.textContent = count
        ? `${count}${d.more ? "+" : ""} ${count === 1 ? "match" : "matches"} · newest first`
        : "No matches in this conversation.";
    } catch (e) {
      if (current(v)) {
        notice.textContent = e.message;
        more.hidden = !append;
      }
    }
  }
  function back() {
    ++version;
    detail.replaceChildren();
    detail.hidden = true;
    form.hidden = rows.hidden = false;
    more.hidden = !more.dataset.restore;
    notice.textContent = notice.dataset.results || "";
    if (selected?.isConnected) selected.focus();
    else field.focus();
  }
  async function context(id, item) {
    selected = item;
    const v = ++version;
    notice.dataset.results = notice.textContent;
    more.dataset.restore = more.hidden ? "" : "1";
    form.hidden = rows.hidden = more.hidden = true;
    notice.textContent = "Loading nearby messages…";
    detail.hidden = false;
    detail.replaceChildren(button("Back to search", back));
    try {
      const d = await api(`/thread/${peer}/context/${id}`);
      if (!current(v)) return;
      notice.textContent = "Conversation context";
      for (const m of d.messages) {
        const row = box(
          "finder-line",
          stamp(m),
          n("p", "", m.body || "Attachment"),
        );
        if (m.id === id) {
          row.classList.add("finder-selected");
          row.prepend(n("strong", "", "Selected message"));
          row.tabIndex = -1;
        }
        detail.append(row);
      }
      detail.querySelector(".finder-selected")?.focus();
    } catch (e) {
      if (current(v)) notice.textContent = e.message;
    }
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    find(false);
  };
  field.type = "search";
  field.autocomplete = "off";
  function changed() {
    const count =
      Number(sender.value !== "any") +
      Number(!!from.value) +
      Number(!!through.value);
    summary.textContent = count ? `Filters (${count})` : "Filters";
    ++version;
    rows.replaceChildren();
    more.hidden = true;
    notice.textContent = "";
  }
  field.oninput = changed;
  sender.onchange = from.oninput = through.oninput = changed;
  notice.setAttribute("role", "status");
  more.hidden = detail.hidden = true;
  form.append(box("finder-query", field, submit), filters);
  root.append(form, notice, rows, more, detail);
  sheet(`Search chat · ${title}`, root);
  // A mutation may unsend an item already shown in this snapshot.
  function invalidate() {
    if (!root.isConnected || !dialog.open) return;
    ++version;
    selected = null;
    rows.replaceChildren();
    detail.replaceChildren();
    detail.hidden = more.hidden = true;
    form.hidden = rows.hidden = false;
    notice.textContent =
      "Conversation updated. Search again for the latest results.";
  }
  window.addEventListener("dm-mutation", invalidate);
  dialog.addEventListener(
    "close",
    () => {
      window.removeEventListener("dm-mutation", invalidate);
      ++version;
    },
    { once: true },
  );
  if (anchor) context(anchor);
  else field.focus();
}
