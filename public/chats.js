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
  left.append(
    box(
      "list-heading",
      n("h1", "", "Messages"),
      button("New Message", compose, "gradient"),
    ),
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
          name(t),
          n(
            "span",
            "preview",
            (t.outgoing ? "You: " : "") + (t.body || "Photo"),
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
    let photo,
      processing = false;
    const attach = n("input");
    attach.type = "file";
    attach.accept = "image/jpeg,image/png,image/webp";
    attach.hidden = true;
    const pick = withIcon(
      button("", () => attach.click()),
      "photo",
      "Attach photo",
    );
    pick.setAttribute("aria-label", "Attach photo");
    const attachment = box("attachment");
    attachment.hidden = true;
    function clearPhoto() {
      photo = undefined;
      attachment.hidden = true;
      msg.required = true;
      attach.value = "";
    }
    attach.onchange = async () => {
      const f = attach.files[0];
      if (!f) return;
      processing = true;
      send.disabled = true;
      try {
        if (
          f.size > 8 * 1024 * 1024 ||
          !["image/jpeg", "image/png", "image/webp"].includes(f.type)
        )
          throw Error("Choose a JPG, PNG or WebP under 8 MB.");
        const bmp = await createImageBitmap(f),
          canvas = n("canvas"),
          scale = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
        canvas.width = Math.max(1, Math.round(bmp.width * scale));
        canvas.height = Math.max(1, Math.round(bmp.height * scale));
        canvas
          .getContext("2d")
          .drawImage(bmp, 0, 0, canvas.width, canvas.height);
        bmp.close();
        const url = canvas.toDataURL("image/jpeg", 0.65);
        if (url.length > 230000) throw Error("Choose a smaller photo.");
        photo = url.split(",")[1];
        msg.required = false;
        const preview = n("img");
        preview.alt = "Selected photo";
        preview.src = url;
        attachment.replaceChildren(preview, button("Remove photo", clearPhoto));
        attachment.hidden = false;
      } catch (e) {
        error(e);
      } finally {
        processing = false;
        send.disabled = false;
      }
    };
    msg.required = true;
    bar.append(
      attach,
      pick,
      withIcon(
        button("", () => {
          msg.setRangeText("😊", msg.selectionStart, msg.selectionEnd, "end");
          msg.focus();
        }),
        "smile",
        "Add emoji",
      ),
      msg,
      send,
    );
    const header = box("thread-head");
    right.append(header, log, attachment, bar);
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
    function draw(d, prepend) {
      if (!ready) {
        header.append(
          withIcon(a("/messages", "", "back-chat"), "back", "Back to messages"),
          avatar(peer),
          box(
            "summary",
            profile(d.member),
            n(
              "small",
              "subtle chat-status",
              d.member.username ? "@" + d.member.username : "Member",
            ),
          ),
          withIcon(
            a("/profile/" + peer, "", "info-link"),
            "info",
            "Member profile",
          ),
        );
        ready = true;
      }
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
            new Date(m.created).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }) + (sent ? (m.seen ? " · Read" : " · Sent") : "");
        if (nodes.has(m.id)) {
          nodes.get(m.id).textContent = stamp;
          continue;
        }
        const time = n("small", "", stamp);
        nodes.set(m.id, time);
        const bubble = box(
          "bubble" + (sent ? " mine" : ""),
          n("p", "", m.body),
          time,
        );
        if (m.hasPhoto) {
          const img = n("img", "message-photo");
          img.alt = "Photo in conversation";
          img.src = "/api/feed/message-photo/" + m.id;
          bubble.prepend(img);
        }
        frag.append(bubble);
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
      if (prepend || d.messages[0]?.id === oldest) {
        hasOlder = d.more;
        older.hidden = !hasOlder;
      }
      if (atEnd && !prepend) log.scrollTop = log.scrollHeight;
    }
    update = async () => {
      if (pending) return;
      pending = true;
      try {
        const d = await api("/thread/" + peer);
        draw(d, false);
        if (
          !document.hidden &&
          d.messages.some((m) => m.sender === peer && !m.seen)
        )
          await api(`/thread/${peer}/read`, { through: latest });
      } finally {
        pending = false;
      }
    };
    bar.onsubmit = async (e) => {
      e.preventDefault();
      if (processing || send.disabled || (!msg.value.trim() && !photo)) return;
      send.disabled = true;
      const text = msg.value;
      try {
        await api("/thread/" + peer, { body: text, photo });
        clearPhoto();
        if (text === msg.value) msg.value = "";
        await update();
        await inbox();
        log.scrollTop = log.scrollHeight;
        msg.focus();
      } catch (e) {
        error(e);
      } finally {
        send.disabled = false;
      }
    };
  }
  await update();
  await inbox();
  let polling = false;
  const timer = setInterval(async () => {
    if (document.hidden || polling) return;
    polling = true;
    try {
      await update();
      await inbox();
    } catch (e) {
      error(e);
    } finally {
      polling = false;
    }
  }, 4500);
  window.addEventListener("pagehide", () => clearInterval(timer), {
    once: true,
  });
}
