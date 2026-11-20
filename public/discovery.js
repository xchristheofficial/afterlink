import { choice, check, toolbox } from "./view-controls.js";
import { postMenu } from "./linkbacks.js";
import {
  n,
  box,
  a,
  button,
  avatar,
  profile,
  ago,
  api,
  empty,
  follow,
  share,
  media,
  tabs,
  icon,
  withIcon,
} from "./social-ui.js";
export async function search(root, q) {
  const groups = box("result-groups"),
    [people, posts, reels] = await Promise.all([
      api("/people?q=" + encodeURIComponent(q)),
      api("/discover?q=" + encodeURIComponent(q)),
      api("/discover?kind=reels&q=" + encodeURIComponent(q)),
    ]);
  function show(filter) {
    groups.replaceChildren();
    for (const [title, items, more] of [
      ["People", people.people, false],
      ["Posts", posts.posts, posts.more],
      ["Reels", reels.posts, reels.more],
    ]) {
      if (filter !== "All" && filter !== title) continue;
      const cards = box("result-cards"),
        head = n("h2", "", title);
      head.append(
        n(
          "small",
          "",
          `${items.length}${more ? "+" : ""} ${items.length === 1 ? "result" : "results"}`,
        ),
      );
      groups.append(head, cards);
      for (const p of items) {
        if (title === "People") {
          cards.append(box("person-card", avatar(p.id), profile(p), follow(p)));
        } else {
          const reel = title === "Reels",
            link = a(
              reel ? "/reels?id=" + p.id : "/post/" + p.id,
              "",
              "result-card",
            );
          const hero = box("result-preview");
          if (p.media.length) {
            const m = media(p.media[0]);
            if (m.tagName === "VIDEO") {
              m.controls = false;
              m.muted = true;
            }
            hero.append(m);
          } else hero.append(n("p", "", p.body));
          if (reel)
            hero.append(
              box("play-icon", icon("play")),
              n("small", "view-count", p.views + " views"),
            );
          link.append(
            hero,
            n("strong", "", p.body || "Post by " + p.name),
            n("small", "subtle", p.name + " · " + ago(p.created)),
          );
          cards.append(link);
        }
      }
      if (!items.length) {
        cards.append(
          n(
            "p",
            "no-results",
            q
              ? "No matches for “" + q + "”."
              : "No " + title.toLowerCase() + " to show yet.",
          ),
        );
      }
    }
  }
  const filters = ["All", "People", "Posts", "Reels"];
  const initial =
    filters.find(
      (f) =>
        f.toLowerCase() === new URLSearchParams(location.search).get("filter"),
    ) || "All";
  const keep = n("input");
  keep.type = "hidden";
  keep.name = "filter";
  document.querySelector("#socialSearch").append(keep);
  function filterBy(filter) {
    keep.value = filter.toLowerCase();
    keep.disabled = filter === "All";
    const url = new URL(location.href);
    if (keep.disabled) url.searchParams.delete("filter");
    else url.searchParams.set("filter", keep.value);
    if (url.href !== location.href)
      history.replaceState(history.state, "", url);
    show(filter);
  }
  root.append(tabs(filters, initial, filterBy), groups);
  filterBy(initial);
}

export async function notifications(root, q) {
  let items = (await api("/notices")).notices,
    selected = "All";
  const groups = box("notice-groups");
  const following = n("input"),
    audience = n("label", "notice-audience");
  following.type = "checkbox";
  following.onchange = render;
  audience.append(following, "Only people I follow");
  const unread = check("Unread only", render),
    period = choice(
      "Time period",
      [
        ["all", "Any time"],
        ["1", "Last 24 hours"],
        ["7", "Last 7 days"],
        ["30", "Last 30 days"],
      ],
      render,
    ),
    summary = n("small", "subtle");
  summary.setAttribute("role", "status");
  let visible = [];
  const scoped = button("Mark shown as read", async () => {
    const targets = visible.filter((i) => !i.seen);
    try {
      for (const i of targets) {
        await api("/notices/read", { id: i.id });
        i.seen = 1;
      }
    } finally {
      window.dispatchEvent(new Event("unread-change"));
      render();
    }
  });
  const refresh = button("Refresh notifications", async () => {
    items = (await api("/notices")).notices;
    render();
  });
  const mark = button(
    "Mark all as read",
    async () => {
      await api("/notices/read", { all: true });
      window.dispatchEvent(new Event("unread-change"));
      items.forEach((i) => (i.seen = 1));
      render();
    },
    "mark-all",
  );
  root.append(
    box("notice-title", n("h1", "", "Notifications"), mark),
    tabs(["All", "Follows", "Mentions", "Activity"], "All", (v) => {
      selected = v;
      render();
    }),
    audience,
    toolbox("Notification tools", unread.root, period.root, refresh, scoped),
    summary,
    groups,
  );
  const labels = {
    message: "sent you a message",
    reel: "published a reel",
    follow: "started following you",
    mention: "mentioned you",
    comment: "commented on your post",
    reply: "replied to your comment",
    like: "liked your post",
  };
  function render() {
    groups.replaceChildren();
    mark.hidden =
      selected !== "All" ||
      !!q ||
      unread.field.checked ||
      period.field.value !== "all" ||
      following.checked ||
      !items.some((i) => !i.seen);
    const filtered = items.filter(
      (i) =>
        (!unread.field.checked || !i.seen) &&
        (period.field.value === "all" ||
          i.created >= Date.now() - Number(period.field.value) * 86400000) &&
        (!following.checked || i.following) &&
        (selected === "All" ||
          (selected === "Follows"
            ? i.kind === "follow"
            : selected === "Mentions"
              ? i.kind === "mention"
              : !["follow", "mention"].includes(i.kind))) &&
        (i.name + " " + labels[i.kind]).toLowerCase().includes(q.toLowerCase()),
    );
    visible = filtered;
    const pending = visible.filter((i) => !i.seen).length;
    scoped.hidden = !pending;
    summary.textContent = `${visible.length} shown · ${pending} unread`;
    if (!filtered.length) {
      groups.append(
        empty(
          "No notifications here yet",
          following.checked
            ? "Turn off the following filter to see other activity."
            : "New activity from other members will appear here.",
        ),
      );
      return;
    }
    for (const seen of [false, true]) {
      const list = filtered.filter((i) => !!i.seen === seen);
      if (!list.length) continue;
      groups.append(n("h2", "subtle", seen ? "Earlier" : "New"));
      for (const i of list) {
        const view = a(
          i.kind === "message"
            ? "/messages/" + i.actor
            : i.post_id
              ? "/post/" + i.post_id
              : "/profile/" + i.actor,
          "",
          "notice-link",
        );
        view.append(
          avatar(i.actor),
          n("strong", "", i.name + " " + labels[i.kind]),
        );
        view.onclick = async (e) => {
          e.preventDefault();
          try {
            await api("/notices/read", { id: i.id });
            window.dispatchEvent(new Event("unread-change"));
          } finally {
            location.assign(view.href);
          }
        };
        const row = box("notice" + (seen ? "" : " unread"), view);
        if (i.kind === "follow" && !i.following && !i.private)
          row.append(
            button(
              "Follow Back",
              async () => {
                await api("/follow", { id: i.actor, on: true });
                await api("/notices/read", { id: i.id });
                window.dispatchEvent(new Event("unread-change"));
                for (const notice of items)
                  if (notice.actor === i.actor) notice.following = 1;
                i.seen = 1;
                render();
              },
              "outline",
            ),
          );
        if (!seen)
          row.append(
            button("Mark read", async () => {
              await api("/notices/read", { id: i.id });
              i.seen = 1;
              window.dispatchEvent(new Event("unread-change"));
              render();
            }),
          );
        row.append(n("small", "subtle", ago(i.created)));
        groups.append(row);
      }
    }
  }
  render();
}

export async function reels(root, q, id) {
  const list = box("reel-list", n("small", "eyebrow", "REELS FEED")),
    center = box("reel-center"),
    actions = box("reel-actions");
  root.append(list, center, actions);
  let rows = (await api("/discover?kind=reels&q=" + encodeURIComponent(q)))
    .posts;
  if (id && !rows.some((r) => r.id === id)) {
    const { post } = await api("/post/" + id);
    if (!post.media.some((m) => m.type.startsWith("video/")))
      throw Error("This post is not a reel.");
    rows.unshift(post);
  }
  if (!rows.length) {
    center.append(
      empty(
        q ? "No matching reels" : "No reels yet",
        q
          ? "Try a different search."
          : "Publish a video to start the Reels feed.",
        a("/create?tool=video", "Create a video post", "gradient"),
      ),
    );
    return;
  }
  let version = 0;
  let currentPlayer,
    rate = 1,
    loop = false,
    mute = null,
    theater = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) currentPlayer?.pause();
  });
  async function select(p) {
    const v = ++version;
    for (const b of list.querySelectorAll("button"))
      b.setAttribute("aria-pressed", String(b.dataset.id == p.id));
    const { post, author, own } = await api("/post/" + p.id);
    if (v !== version) return;
    history.replaceState(
      null,
      "",
      "/reels?" + new URLSearchParams({ id: p.id, ...(q ? { q } : {}) }),
    );
    const player = media(post.media.find((m) => m.type.startsWith("video/")));
    player.addEventListener(
      "playing",
      () => api("/reel/view", { post: p.id }).catch(() => {}),
      { once: true },
    );
    player.setAttribute("aria-label", post.body || "Video by " + author.name);
    const caption = box(
      "reel-caption",
      box(
        "reel-author",
        avatar(author.id),
        profile(author),
        ...(!own ? [follow(author)] : []),
      ),
      postComposer.caption(post.body),
      n("small", "subtle", post.views + " views"),
    );
    if (!own)
      caption.append(
        a(
          "/safety?id=" + author.id + "&post=" + p.id,
          "Report or Block",
          "moderate",
        ),
      );
    caption.append(
      postMenu({
        id: post.id,
        body: post.body,
        name: author.name,
        media: post.media[0]?.id,
        type: post.media[0]?.type,
      }),
    );
    const overlay = withIcon(
      button("", () => player.play(), "big-play"),
      "play",
      "Play reel",
    );
    player.addEventListener("play", () => (overlay.hidden = true));
    player.addEventListener("pause", () => (overlay.hidden = false));
    currentPlayer?.pause();
    currentPlayer = player;
    player.loop = loop;
    player.defaultPlaybackRate = player.playbackRate = rate;
    if (mute !== null) player.muted = mute;
    const speed = choice(
      "Reel speed",
      [0.75, 1, 1.25, 1.5, 2].map((x) => [x, x + "×"]),
      () => {
        rate = Number(speed.field.value);
        player.defaultPlaybackRate = player.playbackRate = rate;
      },
    );
    speed.field.value = String(rate);
    const repeat = check("Loop this reel", () => {
      player.loop = loop = repeat.field.checked;
    });
    repeat.field.checked = loop;
    const silent = check("Mute reel sound", () => {
      player.muted = mute = silent.field.checked;
    });
    silent.field.checked = player.muted;
    player.addEventListener("volumechange", () => {
      if (currentPlayer === player) silent.field.checked = mute = player.muted;
    });
    const wide = check("Focus on player", () => {
      theater = wide.field.checked;
      root.classList.toggle("reel-focus", theater);
      list.hidden = theater;
    });
    wide.field.checked = theater;
    const idx = rows.findIndex((x) => x.id === p.id),
      prev = button("Previous reel", () => select(rows[idx - 1])),
      next = button("Next reel", () => select(rows[idx + 1]));
    prev.disabled = idx === 0;
    next.disabled = idx === rows.length - 1;
    center.replaceChildren(
      box("player", player, overlay),
      box("view-controls", prev, next),
      toolbox(
        "Playback settings",
        speed.root,
        repeat.root,
        silent.root,
        wide.root,
      ),
      caption,
    );
    const heart = button("", async () => {
      await api("/heart", { post: p.id, on: !post.liked });
      post.liked = !post.liked;
      post.likes += post.liked ? 1 : -1;
      paint();
    });
    const save = button("", async () => {
      await api("/save", { id: p.id, on: !post.saved });
      post.saved = !post.saved;
      post.saves += post.saved ? 1 : -1;
      paint();
    });
    function paint() {
      heart.replaceChildren(icon("heart"), n("span", "", post.likes));
      heart.setAttribute("aria-label", `Like reel, ${post.likes} likes`);
      heart.setAttribute("aria-pressed", String(!!post.liked));
      save.replaceChildren(icon("save"), n("span", "", post.saves));
      save.setAttribute(
        "aria-label",
        `${post.saved ? "Unsave" : "Save"} reel, ${post.saves} saves`,
      );
      save.setAttribute("aria-pressed", String(!!post.saved));
    }
    paint();
    const comments = a("/post/" + p.id + "#comments", "", "round-action");
    comments.append(icon("messages"), n("span", "", post.comments));
    comments.setAttribute("aria-label", post.comments + " comments");
    const shares = n("span", "", post.shares),
      send = button("", async () => {
        if (await share(p.id))
          shares.textContent = (await api("/share", { post: p.id })).shares;
      });
    send.setAttribute("aria-label", "Share reel");
    send.title = "Members who shared or copied a link";
    send.append(icon("share"), shares);
    actions.replaceChildren(heart, comments, send, save);
  }
  for (const p of rows) {
    const b = button("", () => select(p));
    b.dataset.id = p.id;
    const thumbnail = media(p.media[0]);
    thumbnail.controls = false;
    thumbnail.muted = true;
    thumbnail.preload = "metadata";
    thumbnail.src += "#t=0.1";
    b.append(
      box("reel-thumb", thumbnail),
      n("strong", "", p.body || "Video by " + p.name),
      n("small", "", p.name),
    );
    list.append(b);
  }
  await select(rows.find((r) => r.id === id) || rows[0]);
}
