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
  left.append(
    inboxTabs("Chats"),
    box(
      "list-heading",
      n("h1", "", "Messages"),
      button("New Message", compose, "gradient"),
    ),
    noteHost,
    search,
    list,
  );
  let version = 0,
    listKey = "";
  async function inbox() {
    const v = ++version,
      { threads } = await api("/inbox?q=" + encodeURIComponent(search.value));
    if (v !== version || JSON.stringify(threads) === listKey) return;
    listKey = JSON.stringify(threads);
    list.replaceChildren();
    for (const t of threads) {
      const row = a(
        "/messages/" + t.id,
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
          n("small", "", ago(t.created)),
          ...(t.unread ? [n("b", "count", t.unread)] : []),
        ),
      );
      list.append(row);
    }
    if (!threads.length)
      list.append(
        empty(
          search.value ? "No matching chats" : "No conversations yet",
          search.value
            ? "Try another name or message."
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
      msg = input("Message…", 1000),
      send = n("button", "gradient", "Send");
    const draft = attachmentComposer(msg, send),
      { file: attach, pick, preview: attachment } = draft;
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
            msg.focus();
          }),
        ),
        "smile",
        "Add emoji",
      ),
      msg,
      send,
    );
    const header = box("thread-head");
    const replyBar = box("reply-strip"),
      pinBar = box("reply-strip");
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
    right.append(header, pinBar, log, replyBar, attachment, bar);
    let latest = 0,
      oldest = Infinity,
      hasOlder = false,
      ready = false,
      pending = false;
    const nodes = new Map();
    const older = button(
      "Load earlier messages",
      async () => {
        const d = await api(`/thread/${peer}?before=${oldest}`),
          h = log.scrollHeight;
        draw(d, true);
        log.scrollTop += log.scrollHeight - h;
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
    let identity;
    const contact = button(
      "",
      () => {
        const field = input("Nickname", 40);
        field.value = identity.nickname || "";
        sheet(
          "Conversation details",
          profile(identity),
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
      if (d.member) {
        if (!identity) identity = {};
        Object.assign(identity, d.member);
        contact.replaceChildren(
          name({ ...identity, name: identity.nickname || identity.name }),
        );
      }
      if (!ready) {
        header.append(
          withIcon(a("/messages", "", "back-chat"), "back", "Back to messages"),
          avatar(peer),
          box(
            "summary",
            contact,
            n(
              "small",
              "subtle chat-status",
              d.member.username ? "@" + d.member.username : "Member",
            ),
          ),
          callActions(identity),
        );
        ready = true;
      }
      if ("pin" in d) {
        pinBar.hidden = !d.pin;
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
        atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 70;
      for (const m of d.messages) {
        const sent = m.sender !== peer,
          stamp =
            dates.format(m.created) +
            (sent ? (m.seen ? " · Read" : " · Sent") : "");
        if (sent && m.clientToken) {
          outstanding.get(m.clientToken)?.remove();
          outstanding.delete(m.clientToken);
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
          if (m.reply_to)
            bubble.prepend(
              n(
                "blockquote",
                "reply-quote",
                m.replyRemoved ? "Message unsent" : m.replyBody || "Attachment",
              ),
            );
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
        latest = Math.max(latest, m.id);
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
      if (atEnd && !prepend) log.scrollTop = log.scrollHeight;
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
        const d = await api("/thread/" + peer);
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
        if (
          !document.hidden &&
          d.messages.some((m) => m.sender === peer && !m.seen)
        )
          await api(`/thread/${peer}/read`, { through: latest });
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
      clearReply();
      if (media) draft.clear();
      msg.focus();
      const payload = {
        clientId: crypto.randomUUID(),
        body: text,
        ...(media ? { media } : {}),
        ...(replyId ? { replyTo: replyId } : {}),
      };
      outstanding.set(payload.clientId, temp);
      async function deliver() {
        try {
          const { message } = await api("/thread/" + peer, payload);
          temp.remove();
          draw({ messages: [message] }, false);
          inbox().catch(error);
        } catch (e) {
          temp.replaceChildren(
            n("p", "", text || "Attachment"),
            n("small", "", "Not confirmed · " + e.message),
            button("Retry", deliver),
            button("Dismiss", () => {
              temp.remove();
              outstanding.delete(payload.clientId);
            }),
          );
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
