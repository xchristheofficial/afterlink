import { multiline } from "./chat-compose.js";
import { searchThread } from "./thread-search.js";
import { threadHistory } from "./thread-history.js";
import { typingIndicator } from "./typing.js";
import { emojiPicker, messageMenu, liveMessages } from "./dm-tools.js";
import { notes } from "./notes.js";
import { attachmentComposer, mediaBubble } from "./chat-media.js";
import { callControls } from "./calls.js";
import { inboxTabs } from "./linkbacks.js";
import {
  $,
  n,
  box,
  a,
  button,
  input,
  avatar,
  name,
  ago,
  error,
  api,
  empty,
  sheet,
  profile,
  withIcon,
  tabs,
  icon,
} from "./social-ui.js";
export async function messages(root, peer) {
  const left = box("chat-list"),
    right = box("chat-right"),
    layout = box("inbox-layout", left, right);
  root.append(layout);
  const callActions = callControls();
  const search = input("Search conversations…"),
    list = box("conversations"),
    filter = new URLSearchParams(location.search).get("q") || "";
  search.value = filter;
  function compose() {
    const q = input("Find a member by name or username"),
      people = box("people-picker");
    let version = 0;
    async function find() {
      const v = ++version;
      const { people: items } = await api(
        "/people?q=" + encodeURIComponent(q.value),
      );
      if (v !== version) return;
      people.replaceChildren(
        ...items.map((p) => {
          const row = a("/messages/" + p.id, "", "picker-row");
          row.append(
            avatar(p.id),
            name(p),
            n("small", "", p.username ? "@" + p.username : ""),
          );
          return row;
        }),
      );
      if (!items.length) people.append(n("p", "", "No matching members yet."));
    }
    q.oninput = () => find().catch(error);
    sheet("New message", q, people);
    q.focus();
    return find();
  }
  const noteHost = box("inbox-notes");
  notes(noteHost).catch(error);
  let unreadOnly =
    new URLSearchParams(location.search).get("view") === "unread";
  const viewParam = () => (unreadOnly ? "?view=unread" : "");
  const filters = tabs(
    ["All chats", "Unread"],
    unreadOnly ? "Unread" : "All chats",
    (key) => {
      unreadOnly = key === "Unread";
      const url = new URL(location.href);
      if (unreadOnly) url.searchParams.set("view", "unread");
      else url.searchParams.delete("view");
      history.replaceState(history.state, "", url);
      listKey = null;
      inbox().catch(error);
    },
  );
  left.append(
    inboxTabs("Chats"),
    box(
      "list-heading",
      n("h1", "", "Messages"),
      button("New Message", compose, "gradient"),
    ),
    noteHost,
    filters,
    search,
    list,
  );
  let version = 0,
    listKey = "";
  async function inbox() {
    const v = ++version,
      { threads } = await api(
        "/inbox?q=" +
          encodeURIComponent(search.value) +
          (unreadOnly ? "&view=unread" : ""),
      );
    if (v !== version || JSON.stringify(threads) === listKey) return;
    listKey = JSON.stringify(threads);
    list.replaceChildren();
    for (const t of threads) {
      const row = a(
        "/messages/" + t.id + viewParam(),
        "",
        "thread-row" + (t.id === peer ? " current" : ""),
      );
      row.append(
        avatar(t.id),
        box(
          "summary",
          name({ ...t, name: t.nickname || t.name }),
          n(
            "span",
            "preview",
            (t.outgoing ? "You: " : "") +
              (t.removed
                ? "Message unsent"
                : t.body ||
                  (t.mediaType?.startsWith("audio/")
                    ? "Voice note"
                    : t.mediaType === "image/gif"
                      ? "GIF"
                      : "Photo")),
          ),
        ),
        box(
          "stamp",
          ...(t.pinnedChat
            ? [n("small", "private-chat-pin", "Pinned chat")]
            : []),
          n("small", "", ago(t.created)),
          ...(t.unread ? [n("b", "count", t.unread)] : []),
        ),
      );
      list.append(row);
    }
    if (!threads.length)
      list.append(
        empty(
          search.value
            ? "No matching chats"
            : unreadOnly
              ? "No unread chats"
              : "No conversations yet",
          search.value
            ? "Try another name or message."
            : unreadOnly
              ? "You’re caught up."
              : "Start a conversation with another AfterLink member.",
        ),
      );
  }
  search.oninput = () => inbox().catch(error);
  let update = async () => {};
  if (!peer) {
    right.append(
      box(
        "select-chat",
        box("chat-prompt-mark", icon("messages")),
        n("h2", "", "Select a conversation"),
        n("p", "", "Choose a chat to start messaging"),
      ),
    );
  } else {
    const log = box("chat-log"),
      bar = n("form", "send-bar"),
      msg = n("textarea"),
      send = n("button", "gradient", "Send");
    const draft = attachmentComposer(msg, send, right),
      { file: attach, pick, preview: attachment } = draft;
    const composeField = multiline(msg, bar, send, "Message…");
    msg.required = true;
    bar.append(
      attach,
      pick,
      withIcon(
        button("", () =>
          emojiPicker((char) => {
            if (
              msg.value.length +
                char.length -
                (msg.selectionEnd - msg.selectionStart) >
              1000
            )
              return;
            msg.setRangeText(char, msg.selectionStart, msg.selectionEnd, "end");
            msg.dispatchEvent(new Event("input"));
            msg.focus();
          }),
        ),
        "smile",
        "Add emoji",
      ),
      composeField,
      send,
    );
    const header = box("thread-head");
    const replyBar = box("reply-strip"),
      pinBar = button(
        "",
        () => searchThread(identity, Number(pinBar.dataset.anchor)),
        "reply-strip",
      );
    replyBar.hidden = pinBar.hidden = true;
    let replyTo = null;
    function reply(m) {
      replyTo = m.id;
      replyBar.replaceChildren(
        n("span", "", "Replying to: " + (m.body || "Attachment")),
        button("Cancel reply", clearReply),
      );
      replyBar.hidden = false;
      msg.focus();
    }
    function clearReply() {
      replyTo = null;
      replyBar.hidden = true;
    }
    const typing = typingIndicator(msg, peer);
    const historyView = threadHistory(log, async (through) => {
      await api(`/thread/${peer}/read`, { through });
      window.dispatchEvent(new Event("unread-change"));
      inbox().catch(error);
    });
    right.append(
      header,
      pinBar,
      historyView.element,
      replyBar,
      attachment,
      bar,
    );
    let oldest = Infinity,
      hasOlder = false,
      ready = false,
      pending = false;
    const nodes = new Map();
    const older = button(
      "Load earlier messages",
      async () => {
        const d = await api(`/thread/${peer}?before=${oldest}`),
          h = log.scrollHeight,
          top = log.scrollTop;
        draw(d, true);
        log.scrollTop = top + log.scrollHeight - h;
      },
      "older",
    );
    log.append(older);
    older.hidden = true;
    const dates = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const outstanding = new Map();
    let identity,
      viewer,
      firstUnread = null;
    const divider = n("div", "dm-unread-divider");
    divider.setAttribute("role", "separator");
    const retryQueue = new Map();
    async function recover() {
      if (!navigator.onLine || document.hidden) return;
      for (const [key, retry] of [...retryQueue]) {
        if (retryQueue.get(key) !== retry) continue;
        retryQueue.delete(key);
        if (outstanding.has(key)) await retry();
      }
    }
    window.addEventListener("online", recover);
    const contact = button(
      "",
      () => {
        const field = input("Nickname", 40);
        field.value = identity.nickname || "";
        sheet(
          "Conversation details",
          profile(identity),
          ...(nodes.size
            ? [
                button(
                  identity.pinnedChat
                    ? "Unpin chat from inbox"
                    : "Pin chat to inbox",
                  async () => {
                    await api("/inbox-pin/" + peer, {
                      pinned: !identity.pinnedChat,
                    });
                    $("#socialDialog").close();
                    await Promise.all([inbox(), update()]);
                  },
                ),
              ]
            : []),
          n(
            "p",
            "subtle",
            "Only you see this nickname. Leave it blank to use the profile name.",
          ),
          field,
          button(
            "Save nickname",
            async () => {
              await api("/nickname/" + peer, { nickname: field.value });
              $("#socialDialog").close();
              await Promise.all([update(), inbox()]);
            },
            "gradient",
          ),
        );
        field.focus();
      },
      "contact-name",
    );
    contact.setAttribute("aria-label", "Conversation details");
    contact.title = "Conversation details";
    function draw(d, prepend) {
      if (viewer && d.viewer && viewer !== d.viewer) {
        location.reload();
        return;
      }
      if (d.viewer) viewer = d.viewer;
      const opening = "firstUnread" in d;
      if (opening) firstUnread = d.firstUnread;
      if (d.member) {
        if (!identity) identity = {};
        Object.assign(identity, d.member);
        contact.replaceChildren(
          name({ ...identity, name: identity.nickname || identity.name }),
        );
      }
      if (!ready) {
        const tools = callActions(identity);
        tools.prepend(
          withIcon(
            button("", () => searchThread(identity)),
            "search",
            "Search this chat",
          ),
        );
        header.append(
          withIcon(
            a("/messages" + viewParam(), "", "back-chat"),
            "back",
            "Back to messages",
          ),
          avatar(peer),
          box(
            "summary",
            contact,
            typing.label,
            n(
              "small",
              "subtle chat-status",
              d.member.username ? "@" + d.member.username : "Member",
            ),
          ),
          tools,
        );
        ready = true;
      }
      if ("pin" in d) {
        pinBar.hidden = !d.pin;
        if (d.pin) pinBar.dataset.anchor = d.pin.id;
        pinBar.textContent = d.pin
          ? "Pinned · " + (d.pin.body || "Attachment")
          : "";
      }
      if ("active" in d)
        header.querySelector(".chat-status").textContent = d.active
          ? "Active recently"
          : d.member.username
            ? "@" + d.member.username
            : "Member";
      const frag = document.createDocumentFragment(),
        atEnd = historyView.atLatest();
      for (const m of d.messages) {
        const sent = m.sender !== peer,
          stamp =
            dates.format(m.created) +
            (sent ? (m.seen ? " · Read" : " · Sent") : "");
        if (sent && m.clientToken) {
          outstanding.get(m.clientToken)?.remove();
          outstanding.delete(m.clientToken);
          retryQueue.delete(m.clientToken);
        }
        const signature = JSON.stringify([
          m.removed,
          m.pinned,
          m.reactions,
          m.replyRemoved,
        ]);
        let existing = nodes.get(m.id)?.parentNode;
        if (existing?.dataset.meta === signature) {
          const time = nodes.get(m.id);
          if (time.textContent !== stamp) time.textContent = stamp;
          const once = time.parentNode.querySelector(".dm-once");
          if (once && m.opened && !once.dataset.opened)
            once.replaceWith(mediaBubble(m, sent));
          continue;
        }
        const time = n("small", "", stamp);
        nodes.set(m.id, time);
        const bubble = box(
          "bubble" + (sent ? " mine" : ""),
          n("p", "", m.body),
          time,
        );
        bubble.dataset.meta = signature;
        if (m.removed) bubble.querySelector("p").textContent = "Message unsent";
        else {
          if (m.forwarded) bubble.prepend(n("small", "", "Forwarded"));
          if (m.reply_to) {
            const quote = m.replyRemoved
              ? n("blockquote", "reply-quote", "Message unsent")
              : button(
                  m.replyBody || "Attachment",
                  () => searchThread(identity, m.reply_to),
                  "reply-quote",
                );
            if (!m.replyRemoved)
              quote.title = "See original message in context";
            bubble.prepend(quote);
          }
          if (m.pinned) bubble.prepend(n("small", "", "Pinned"));
          const reactions = JSON.parse(m.reactions || "[]");
          if (reactions.length)
            bubble.append(n("span", "reaction-badge", reactions.join(" ")));
          bubble.append(messageMenu(m, sent, reply, () => update(true)));
        }
        const attachment = mediaBubble(m, sent);
        if (attachment) bubble.prepend(attachment);
        if (existing) existing.replaceWith(bubble);
        else frag.append(bubble);
        oldest = Math.min(oldest, m.id);
      }
      if (prepend) older.after(frag);
      else log.append(frag);
      if (
        !d.messages.length &&
        !nodes.size &&
        !log.querySelector(".empty-state")
      )
        log.append(
          empty(
            "Start the conversation",
            "Your first message will appear here.",
          ),
        );
      if (nodes.size) log.querySelector(".empty-state")?.remove();
      if ("more" in d && (prepend || d.messages[0]?.id === oldest)) {
        hasOlder = d.more;
        older.hidden = !hasOlder;
      }
      if (firstUnread) {
        const anchor = nodes.get(firstUnread)?.parentNode;
        if (anchor) {
          divider.textContent = "First unread";
          if (anchor.previousElementSibling !== divider) anchor.before(divider);
        } else if (oldest > firstUnread) {
          divider.textContent = "Unread messages continue above";
          if (older.nextElementSibling !== divider) older.after(divider);
        }
      }
      if (opening && firstUnread && divider.isConnected)
        log.scrollTop +=
          divider.getBoundingClientRect().top - log.getBoundingClientRect().top;
      else if (atEnd && !prepend) log.scrollTop = log.scrollHeight;
    }
    let again = false,
      syncEarlier = false;
    update = async (history = false) => {
      syncEarlier ||= history;
      if (pending) {
        again = true;
        return;
      }
      pending = true;
      try {
        const d = await api("/thread/" + peer + (ready ? "" : "?opening=1"));
        if (viewer && d.viewer !== viewer) {
          retryQueue.clear();
          location.reload();
          return;
        }
        draw(d, false);
        // A mutation may affect a pinned message or quote outside the latest page.
        if (syncEarlier) {
          syncEarlier = false;
          let before = d.messages[0]?.id;
          while (before > oldest) {
            const past = await api(`/thread/${peer}?before=${before}`);
            if (!past.messages.length) break;
            draw(
              {
                ...past,
                messages: past.messages.filter((m) => nodes.has(m.id)),
              },
              false,
            );
            before = past.messages[0].id;
          }
        }
        historyView.update(d.messages, peer);
        if (d.viewer === viewer) recover();
      } finally {
        pending = false;
        if (again) {
          again = false;
          update().catch(error);
        }
      }
    };
    bar.onsubmit = async (e) => {
      e.preventDefault();
      if (draft.working || send.disabled || (!msg.value.trim() && !draft.media))
        return;
      if (!ready) return;
      const text = msg.value,
        media = draft.media,
        replyId = replyTo;
      const temp = box(
        "bubble mine pending",
        n("p", "", text || "Attachment"),
        n("small", "", "Sending…"),
      );
      log.append(temp);
      log.scrollTop = log.scrollHeight;
      msg.value = "";
      msg.dispatchEvent(new Event("input"));
      clearReply();
      if (media) draft.clear();
      msg.focus();
      const payload = {
        expectedSender: viewer,
        clientId: crypto.randomUUID(),
        body: text,
        ...(media ? { media } : {}),
        ...(replyId ? { replyTo: replyId } : {}),
      };
      outstanding.set(payload.clientId, temp);
      let delivering = false,
        autoAttempts = 0;
      async function deliver() {
        if (delivering || !outstanding.has(payload.clientId)) return;
        delivering = true;
        retryQueue.delete(payload.clientId);
        try {
          const { message } = await api("/thread/" + peer, payload);
          temp.remove();
          draw({ messages: [message] }, false);
          inbox().catch(error);
        } catch (e) {
          if (!outstanding.has(payload.clientId)) return;
          const transient =
            e instanceof TypeError || e.status === 408 || e.status >= 500;
          if (transient && autoAttempts < 2)
            retryQueue.set(payload.clientId, () => {
              autoAttempts++;
              return deliver();
            });
          temp.replaceChildren(
            n("p", "", text || "Attachment"),
            n(
              "small",
              "",
              retryQueue.has(payload.clientId)
                ? "Not confirmed · Will retry when connected"
                : "Not confirmed · " + e.message,
            ),
            button("Retry", deliver),
            button("Dismiss", () => {
              temp.remove();
              outstanding.delete(payload.clientId);
              retryQueue.delete(payload.clientId);
            }),
          );
        } finally {
          delivering = false;
        }
      }
      await deliver();
    };
  }
  const refresh = (history = false) =>
    Promise.all([update(history), inbox()]).catch(error);
  const connected = liveMessages(refresh);
  await refresh();
  let last = Date.now();
  const timer = setInterval(() => {
    if (document.hidden) return;
    if (connected() && Date.now() - last < 15000) return;
    last = Date.now();
    refresh(!connected());
  }, 3500);
  // A cached document is frozen (including its timers). Keep its poller for
  // Back/Forward restores; only tear it down on a non-cached departure.
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) clearInterval(timer);
  });
}
