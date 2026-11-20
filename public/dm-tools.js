import {
  $,
  api,
  button,
  box,
  n,
  input,
  sheet,
  withIcon,
  error,
} from "./social-ui.js";
let catalog;
const close = () => $("#socialDialog").close();
export async function emojiPicker(choose) {
  const search = input("Search emojis"),
    grid = box("emoji-grid"),
    group = n("select"),
    more = button("More emojis", () => {
      limit += 96;
      render();
    });
  group.setAttribute("aria-label", "Emoji category");
  [
    "All categories",
    "Smileys",
    "People & body",
    "Components",
    "Animals",
    "Food & drink",
    "Travel",
    "Activities",
    "Objects",
    "Symbols",
    "Flags",
  ].forEach((s, i) => group.add(new Option(s, i - 1)));
  let limit = 96;
  sheet("Choose an emoji", search, group, grid, more);
  search.focus();
  const rows = await (catalog ??= fetch("/assets/emoji.json")
    .then((r) => {
      if (!r.ok) throw Error("Could not load emoji catalog.");
      return r.json();
    })
    .catch((e) => {
      catalog = null;
      throw e;
    }));
  function render() {
    const q = search.value.trim().toLowerCase(),
      all = rows.filter(
        ([char, label, g]) =>
          (group.value === "-1" || g === Number(group.value)) &&
          (label.toLowerCase().includes(q) || char === q),
      );
    grid.replaceChildren(
      ...all.slice(0, limit).map(([char, label]) => {
        const b = button(char, async () => {
          close();
          await choose(char);
        });
        b.title = label;
        b.setAttribute("aria-label", label);
        return b;
      }),
    );
    if (!all.length) grid.append(n("p", "", "No matches"));
    more.hidden = all.length <= limit;
  }
  search.oninput = group.onchange = () => {
    limit = 96;
    render();
  };
  render();
}
export function messageMenu(m, sent, reply, refresh) {
  const request = async (action, data = {}) => {
    await api(`/message/${m.id}/action`, { action, ...data });
    close();
    await refresh();
  };
  const trigger = withIcon(
    button("", () => {
      const items = [
        button("Reply", () => {
          close();
          reply(m);
        }),
        button(m.pinned ? "Unpin" : "Pin", () => request("pin")),
        button("React", () =>
          emojiPicker((emoji) => request("react", { emoji })),
        ),
      ];
      if (m.body)
        items.push(
          button("Copy text", async (b) => {
            if (!trigger.isConnected)
              throw Error("Message changed. Reopen its actions.");
            try {
              await navigator.clipboard.writeText(m.body);
              b.textContent = "Copied";
            } catch {
              if (
                !trigger.isConnected ||
                !b.isConnected ||
                !$("#socialDialog").open
              )
                return;
              const field = n("textarea", "manual-copy");
              field.readOnly = true;
              field.setAttribute("aria-label", "Message text");
              field.value = m.body;
              sheet(
                "Copy message",
                n(
                  "p",
                  "subtle",
                  "Clipboard access is unavailable. Use your device’s Copy command on the selected text.",
                ),
                field,
              );
              field.focus();
              field.select();
            }
          }),
        );
      if (!m.onceOnly)
        items.push(
          button("Forward", async () => {
            const q = input("Find a recipient"),
              list = box("people-picker");
            let seq = 0;
            async function find() {
              const v = ++seq,
                { people } = await api(
                  "/people?q=" + encodeURIComponent(q.value),
                );
              if (v !== seq) return;
              list.replaceChildren(
                ...people.map((p) =>
                  button(p.name, () => request("forward", { peer: p.id })),
                ),
              );
              if (!people.length)
                list.append(n("p", "", "No matching members."));
            }
            sheet("Forward to", q, list);
            q.focus();
            q.oninput = () => find().catch(error);
            await find();
          }),
        );
      if (sent)
        items.push(
          button("Unsend", () =>
            sheet(
              "Unsend this message?",
              n(
                "p",
                "",
                "It will be removed from this conversation for both people.",
              ),
              button("Unsend for everyone", () => request("unsend")),
              button("Cancel", close),
            ),
          ),
        );
      sheet("Message actions", box("message-menu", ...items));
    }),
    "more",
    "Message actions",
  );
  return trigger;
}
export function liveMessages(refresh) {
  let source;
  const open = () => {
    if (source || !window.EventSource) return;
    source = new EventSource("/api/feed/live");
    source.addEventListener("call", () =>
      window.dispatchEvent(new Event("dm-call")),
    );
    source.addEventListener("typing", () =>
      window.dispatchEvent(new Event("dm-typing")),
    );
    for (const key of ["chat", "read", "mutation", "open"])
      source.addEventListener(key, () => {
        if (key === "mutation") window.dispatchEvent(new Event("dm-mutation"));
        if (key !== "read") window.dispatchEvent(new Event("dm-chat"));
        window.dispatchEvent(new Event("unread-change"));
        refresh(key === "mutation" || key === "open");
      });
  };
  open();
  addEventListener("pagehide", () => {
    source?.close();
    source = null;
  });
  addEventListener("pageshow", open);
  return () => source?.readyState === 1;
}
