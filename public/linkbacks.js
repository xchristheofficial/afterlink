import { GROUP_LIMIT, INVITE_BATCH } from "./group-limits.mjs";
import { multiline, retryableComposer } from "./chat-compose.js";
import { threadHistory } from "./thread-history.js";
import {
  $,
  n,
  box,
  a,
  button,
  input,
  avatar,
  ago,
  api,
  empty,
  sheet,
  withIcon,
  tabs,
  error,
} from "./social-ui.js";
const path = (id) => "/linkbacks/" + id;
const close = () => $("#socialDialog").close();
const hint = (t) => n("p", "subtle", t);
const title = (g) =>
  g.groupName ||
  g.post?.body ||
  (g.post ? "Media post" : "Original post unavailable");
function preview(p) {
  if (!p)
    return box(
      "lb-unavailable",
      n("strong", "", "Original post unavailable"),
      hint("The post was deleted or is no longer visible to you."),
    );
  const link = a("/post/" + p.id, "", "lb-preview");
  if (p.media) {
    const e = n(p.type.startsWith("video/") ? "video" : "img");
    e.src = "/api/feed/media/" + p.media;
    if (e.tagName === "VIDEO") {
      e.preload = "metadata";
      e.muted = true;
    } else e.alt = "";
    link.append(e);
  }
  link.append(
    box(
      "lb-copy",
      n("small", "subtle", "Original post · " + p.name),
      n("strong", "", p.body || "View media post"),
    ),
  );
  return link;
}
function pinCard(text) {
  return box(
    "lb-pin",
    n("small", "", "Pinned decision"),
    n("strong", "", text),
  );
}
function card(g) {
  const l = a(g.groupName ? "/groups/" + g.id : path(g.id), "", "lb-card");
  l.append(
    n(
      "small",
      "lb-kicker",
      g.pending
        ? "Invitation from " + (g.from?.name || "a member")
        : `Group ${g.id} · ${g.count} members`,
    ),
    n("strong", "", title(g)),
  );
  if (g.unread) l.append(n("b", "count", g.unread));
  if (g.decision) l.append(n("span", "lb-tag", "Decision: " + g.decision.body));
  if (g.latest)
    l.append(n("span", "subtle", g.latest.name + ": " + g.latest.body));
  if (g.pending) l.append(n("span", "subtle", "Review invitation"));
  return l;
}
function places(joined, pending, selected = 0) {
  return `${joined} joined · ${pending} pending · ${GROUP_LIMIT - joined - pending - selected} of ${GROUP_LIMIT} places free`;
}
async function choosePeople(
  selected,
  excluded,
  submit,
  back,
  joined = 1,
  pending = 0,
) {
  const limit = Math.min(INVITE_BATCH, GROUP_LIMIT - joined - pending),
    capacity = hint("");
  capacity.setAttribute("role", "status");
  const search = input("Search members…"),
    chips = box("lb-chips"),
    rows = box("lb-people"),
    send = button("", () => submit([...selected.keys()]), "gradient");
  let version = 0,
    people = [];
  const draw = () => {
    chips.replaceChildren(
      ...[...selected].map(([id, p]) =>
        button(p.name + " ×", () => {
          selected.delete(id);
          draw();
        }),
      ),
    );
    rows.replaceChildren();
    for (const p of people.filter((p) => !excluded.has(p.id))) {
      const check = n("input");
      check.type = "checkbox";
      check.checked = selected.has(p.id);
      check.disabled = !check.checked && selected.size >= limit;
      check.onchange = () => {
        if (check.checked) selected.set(p.id, p);
        else selected.delete(p.id);
        draw();
      };
      const l = n("label", "lb-person");
      l.append(avatar(p.id), n("span", "", p.name), check);
      rows.append(l);
    }
    if (!rows.childElementCount) rows.append(hint("No matching members."));
    send.textContent = `Send invites (${selected.size})`;
    send.disabled = !selected.size || selected.size > limit;
    capacity.textContent = places(joined, pending, selected.size);
  };
  async function find() {
    const v = ++version;
    const r = await api("/people?q=" + encodeURIComponent(search.value));
    if (v === version) {
      people = r.people;
      draw();
    }
  }
  sheet(
    "Choose people",
    ...(back ? [button("Back", back)] : []),
    search,
    capacity,
    chips,
    rows,
    send,
    hint("People can accept or decline."),
  );
  draw();
  search.oninput = () => find().catch(error);
  await find();
}
function groupTopic(value = "") {
  const field = n("textarea", "lb-topic-field");
  field.maxLength = 200;
  field.rows = 2;
  field.value = value;
  field.placeholder = "What is this group for?";
  const label = n("label", "lb-field", "Group topic (optional)");
  label.append(field);
  return { field, label };
}
function createGroup() {
  const name = input("Group name", 60),
    topic = groupTopic(),
    selected = new Map();
  function start() {
    sheet(
      "Create a group",
      hint("Choose a name and invite people to a private group chat."),
      name,
      topic.label,
      hint("Only joined members can see the topic."),
      button(
        "Choose people",
        () => {
          if (!name.value.trim()) throw Error("Give your group a name.");
          return choosePeople(
            selected,
            new Set(),
            async (people) => {
              const r = await api("/groups", {
                name: name.value.trim(),
                topic: topic.field.value,
                people,
              });
              location.assign("/groups/" + r.id);
            },
            start,
          );
        },
        "gradient",
      ),
    );
    name.focus();
  }
  start();
}
export function startLinkback(p) {
  const first = input("First message (optional)", 1000),
    selected = new Map();
  function start() {
    sheet(
      "Start a Linkback",
      hint("A private conversation about this post."),
      preview(p),
      first,
      button(
        "Choose people",
        () =>
          choosePeople(
            selected,
            new Set(),
            async (people) => {
              const r = await api("/linkbacks", {
                post: p.id,
                people,
                message: first.value.trim(),
              });
              location.assign(path(r.id));
            },
            start,
          ),
        "gradient",
      ),
    );
  }
  start();
}
export async function yourLinkbacks(p) {
  const r = await api("/linkbacks?post=" + p.id);
  sheet(
    "Your Linkbacks",
    hint("Only your invitations and groups for this post appear here."),
    ...r.groups.map(card),
    ...(!r.groups.length ? [hint("No Linkbacks for this post yet.")] : []),
    button("Start a Linkback", () => startLinkback(p), "gradient"),
  );
}
export function postMenu(p) {
  return withIcon(
    button("", () =>
      sheet(
        "Post options",
        button("Start a Linkback", () => startLinkback(p), "gradient"),
        button("Your Linkbacks", () => yourLinkbacks(p)),
      ),
    ),
    "more",
    "Post options",
  );
}
export function inboxTabs(active) {
  const nav = n("nav", "lb-tabs");
  nav.setAttribute("aria-label", "Inbox views");
  for (const [label, url] of [
    ["Chats", "/messages"],
    ["Groups", "/groups"],
    ["Linkbacks", "/linkbacks"],
  ]) {
    const link = a(url, label);
    if (label === active) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  return nav;
}
function poll(task, live = false) {
  let busy = false;
  const tick = async () => {
    if (document.hidden || busy) return;
    busy = true;
    try {
      await task();
    } catch (e) {
      error(e);
    } finally {
      busy = false;
    }
  };
  let src;
  function connect() {
    if (live && !src && window.EventSource) {
      src = new EventSource("/api/feed/live");
      src.addEventListener("group", tick);
      src.onopen = tick;
    }
  }
  connect();
  window.addEventListener("pageshow", connect);
  const timer = setInterval(tick, 4500);
  window.addEventListener("pagehide", (e) => {
    src?.close();
    src = null;
    if (!e.persisted) clearInterval(timer);
  });
  document.addEventListener("visibilitychange", tick);
}
export async function linkbacks(root, gid, named = false) {
  const label = named ? "Groups" : "Linkbacks",
    base = named ? "/groups" : "/linkbacks",
    sync = (task) => poll(task, named);
  const layout = box("lb-layout"),
    side = box("lb-side"),
    main = box("lb-main");
  root.append(layout);
  layout.append(side, main);
  layout.classList.toggle("lb-open", !!gid);
  const search = input(`Search ${label}…`),
    list = box("lb-list");
  let view = "all",
    request = 0,
    groups = null;
  const views = {
    All: "all",
    "Unread chats": "unread",
    Invitations: "invites",
  };
  const filters = tabs(Object.keys(views), "All", (key) => {
    if (view === views[key]) return;
    view = views[key];
    groups = null;
    list.replaceChildren(hint("Loading…"));
    inbox().catch(error);
  });
  filters.classList.add("lb-filters");
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "Inbox filters");
  side.append(
    inboxTabs(label),
    n("h1", "", label),
    ...(named ? [button("Create group", createGroup, "gradient")] : []),
    search,
    filters,
    list,
  );
  function listGroups() {
    const q = search.value.toLowerCase().trim(),
      found = (groups || []).filter((g) =>
        [
          title(g),
          g.from?.name,
          g.latest?.body,
          g.decision?.body,
          "Group " + g.id,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    list.replaceChildren(
      ...found.map((g) => {
        const l = card(g);
        if (g.id === gid) l.setAttribute("aria-current", "page");
        return l;
      }),
    );
    if (!found.length)
      list.append(
        hint(
          q
            ? `No matching ${label.toLowerCase()}.`
            : view === "invites"
              ? "No pending invitations."
              : view === "unread"
                ? "No unread conversations."
                : named
                  ? "Create a group or wait for an invitation."
                  : "Start a Linkback from a post to invite people here.",
        ),
      );
  }
  search.oninput = listGroups;
  async function inbox() {
    const v = ++request;
    const next = (
      await api(
        `/linkbacks?kind=${named ? "groups" : "linkbacks"}&view=${view}`,
      )
    ).groups;
    if (v !== request) return;
    if (JSON.stringify(next) === JSON.stringify(groups)) return;
    groups = next;
    listGroups();
  }
  await inbox();
  if (!gid) {
    sync(inbox);
    main.append(
      empty(
        named ? "Choose a group" : "Choose a Linkback",
        "Your conversations and invitations appear in the inbox.",
        ...(named ? [] : [a("/search", "Explore posts", "gradient")]),
      ),
    );
    return;
  }
  const url = path(gid),
    act = (action, b = {}) => api(url, { action, ...b });
  let g = await api(url);
  if (!!g.groupName !== named) {
    location.replace((g.groupName ? "/groups/" : "/linkbacks/") + gid);
    return;
  }
  const back = a(base, "All " + label, "lb-back");
  if (g.pending) {
    sync(async () => {
      await inbox();
      // The open invitation may not appear in the selected inbox filter.
      try {
        const current = await api(url);
        if (!current.pending || JSON.stringify(current) !== JSON.stringify(g))
          location.reload();
      } catch (e) {
        if ([403, 404].includes(e.status)) location.replace(base);
        else throw e;
      }
    });
    main.append(
      back,
      n("h1", "", named ? "Group invitation" : "Linkback invitation"),
      box(
        "lb-invite",
        avatar(g.from.id),
        n("h2", "", g.from.name + " invited you"),
        named ? n("strong", "", g.groupName) : preview(g.post),
        hint("Accept to join the private conversation."),
        box(
          "lb-actions",
          button("Decline", async () => {
            await act("leave");
            location.replace(base);
          }),
          button(
            "Accept",
            async () => {
              await act("accept");
              location.reload();
            },
            "gradient",
          ),
        ),
      ),
    );
    return;
  }
  const heading = box(
      "lb-heading",
      back,
      n("h1", "", g.groupName || "Linkback"),
      button("Details", details),
    ),
    meta = hint(""),
    topicText = n("p", "lb-topic"),
    source = box("lb-source"),
    decision = box("lb-decision"),
    log = box("lb-log"),
    draft = n("textarea"),
    form = n("form", "lb-compose"),
    send = n("button", "gradient", "Send");
  const composeField = multiline(
    draft,
    form,
    send,
    named ? "Message this group…" : "Message this Linkback…",
  );
  const reader = threadHistory(log, async (through) => {
    await act("read", { through });
    window.dispatchEvent(new Event("unread-change"));
    await inbox();
  });
  draft.required = true;
  form.append(composeField, send);
  main.append(
    heading,
    meta,
    topicText,
    source,
    decision,
    box(
      "lb-subheading",
      n("h2", "lb-kicker", "Conversation"),
      n("small", "subtle", "Select a message to pin a decision."),
    ),
    reader.element,
    form,
  );
  const older = button("Earlier messages", async () => {
    const batch = await api(url + "?before=" + history[0].id);
    hasOlder = batch.more;
    history = [...batch.messages, ...history];
    renderLog(false, true);
  });
  let history = [],
    hasOlder = false;
  function renderLog(end, prepend = false) {
    const height = log.scrollHeight,
      top = log.scrollTop;
    log.replaceChildren();
    if (hasOlder) log.append(older);
    for (const m of history) {
      const bubble = button(
        m.body,
        () =>
          sheet(
            "Message options",
            n("blockquote", "", m.body),
            hint("Decision preview"),
            pinCard(m.body),
            button(
              "Pin as decision",
              async () => {
                await act("pin", { message: m.id });
                close();
                await refresh();
              },
              "gradient",
            ),
          ),
        "lb-bubble",
      );
      bubble.title = "Message options";
      log.append(
        box(
          "lb-message" + (m.author === g.uid ? " lb-mine" : ""),
          bubble,
          n("small", "subtle", m.name + " · " + ago(m.created)),
        ),
      );
    }
    if (!history.length)
      log.append(hint("No messages yet. Start the conversation below."));
    log.scrollTop = end
      ? log.scrollHeight
      : top + (prepend ? Math.max(0, log.scrollHeight - height) : 0);
  }
  function paint(previous) {
    if (named) heading.querySelector("h1").textContent = g.groupName;
    topicText.hidden = !g.topic;
    topicText.textContent = g.topic || "";
    meta.textContent = `Private group ${g.id} · ${g.count} ${g.count === 1 ? "member" : "members"}`;
    if (!named && JSON.stringify(previous?.post) !== JSON.stringify(g.post)) {
      source.replaceChildren(preview(g.post));
      if (!g.post)
        source.append(hint("Your conversation and decision remain here."));
    }
    if (JSON.stringify(previous?.decision) !== JSON.stringify(g.decision))
      decision.replaceChildren(
        ...(g.decision
          ? [
              pinCard(g.decision.body),
              button("Unpin", async () => {
                await act("pin", { message: null });
                await refresh();
              }),
            ]
          : []),
      );
    if (JSON.stringify(previous?.messages) !== JSON.stringify(g.messages)) {
      const end = !previous || reader.atLatest();
      history = g.messages;
      hasOlder = g.more;
      renderLog(end);
    }
  }
  let revision = 0;
  async function refresh() {
    const r = ++revision;
    try {
      const next = await api(url);
      if (r !== revision) return;
      if (next.pending) {
        close();
        main.replaceChildren();
        location.reload();
        return;
      }
      const prev = g;
      g = next;
      paint(prev);
      reader.updateCursor(g.latest?.id || 0, g.unread);
      if (
        $("#socialDialog").open &&
        JSON.stringify([
          prev.post,
          prev.members,
          prev.admin,
          prev.groupName,
          prev.topic,
        ]) !==
          JSON.stringify([g.post, g.members, g.admin, g.groupName, g.topic])
      )
        close();
    } catch (e) {
      if (e.status === 404 || e.status === 403) {
        close();
        location.replace(base);
      } else throw e;
    }
  }
  function editGroup() {
    const name = input("Group name", 60),
      topic = groupTopic(g.topic);
    name.value = g.groupName;
    sheet(
      "Edit group",
      name,
      topic.label,
      hint(
        "The name appears on invitations. Only joined members can see the topic.",
      ),
      button(
        "Save group details",
        async () => {
          if (!name.value.trim()) throw Error("Give your group a name.");
          await act("edit", {
            name: name.value.trim(),
            topic: topic.field.value,
          });
          close();
          await Promise.all([refresh(), inbox()]);
        },
        "gradient",
      ),
      button("Cancel", details),
    );
    name.focus();
  }
  function confirmTransfer(member) {
    sheet(
      "Transfer admin role?",
      hint(
        `${member.name} will manage this group. You will remain a member and lose admin controls.`,
      ),
      button(
        "Confirm transfer",
        async () => {
          await act("transfer", { member: member.id });
          close();
          await refresh();
        },
        "gradient",
      ),
      button("Cancel", details),
    );
  }
  async function reviewLeave(opener) {
    const impact = await api(url + "/leave-preview");
    if (!opener.isConnected || !$("#socialDialog").open) return;
    const summary = impact.closes
      ? "You are the last joined member. Leaving closes this group."
      : g.admin === g.uid
        ? `${impact.nextAdmin.name} will become admin.`
        : `${impact.nextAdmin.name} will remain admin.`;
    sheet(
      "Review leaving",
      hint(summary),
      n("strong", "", `Invitations cancelled: ${impact.cancelled.length}`),
      ...impact.cancelled.map((p) => n("p", "", p.name)),
      button(
        "Confirm leave",
        async () => {
          await act("leave", { previewToken: impact.token });
          location.replace(base);
        },
        "danger",
      ),
      button("Stay in group", details),
    );
  }
  function details() {
    const owner = g.admin === g.uid,
      rows = box("lb-people"),
      search = input("Find a member or invitee");
    function roster() {
      rows.replaceChildren();
      const term = search.value.trim().toLowerCase();
      for (const pending of [false, true]) {
        const members = g.members.filter(
          (p) =>
            (p.joined === null) === pending &&
            p.name.toLowerCase().includes(term),
        );
        if (!members.length) continue;
        rows.append(n("h3", "", pending ? "Pending invitations" : "Members"));
        for (const p of members) {
          const l = box(
            "lb-person",
            avatar(p.id),
            n("span", "", p.name + (p.id === g.admin ? " · Admin" : "")),
          );
          if (owner && p.id !== g.uid) {
            if (!pending)
              l.append(button("Make admin", () => confirmTransfer(p)));
            if (pending)
              l.append(
                button("Resend", async (b) => {
                  await act("resend", { member: p.id });
                  b.textContent = "Resent";
                }),
              );
            l.append(
              button(pending ? "Cancel" : "Remove", async () => {
                await act("remove", { member: p.id });
                await refresh();
                details();
              }),
            );
          }
          rows.append(l);
        }
      }
      if (!rows.childElementCount)
        rows.append(hint("No matching members or invitees."));
    }
    search.oninput = roster;
    roster();
    sheet(
      named ? "Group details" : "Linkback details",
      named ? n("strong", "", g.groupName) : preview(g.post),
      ...(g.topic ? [n("p", "lb-topic", g.topic)] : []),
      ...(owner && named ? [button("Edit group", editGroup)] : []),
      hint(places(g.count, g.members.length - g.count)),
      search,
      rows,
      ...(owner
        ? [
            button(
              "Invite more people",
              () =>
                choosePeople(
                  new Map(),
                  new Set(g.members.map((p) => p.id)),
                  async (people) => {
                    await act("invite", { people });
                    await refresh();
                    details();
                  },
                  details,
                  g.count,
                  g.members.length - g.count,
                ),
              "gradient",
            ),
          ]
        : []),
      button("Copy group link", async (b) => {
        await navigator.clipboard.writeText(location.origin + base + "/" + gid);
        b.textContent = "Copied";
      }),
      hint("A link only works for invited people and members."),
      button(named ? "Leave group" : "Leave Linkback", reviewLeave, "danger"),
    );
  }
  retryableComposer(
    form,
    draft,
    send,
    ({ text, clientId }) => act("message", { message: text, clientId }),
    async () => {
      await refresh();
      log.scrollTop = log.scrollHeight;
      await inbox();
    },
    error,
  );
  paint(null);
  reader.updateCursor(g.latest?.id || 0, g.unread);
  sync(async () => {
    await refresh();
    await inbox();
  });
}
