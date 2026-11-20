import { postMenu, startLinkback, yourLinkbacks } from "./linkbacks.js";
import {
  n,
  box,
  a,
  button,
  input,
  avatar,
  profile,
  ago,
  error,
  api,
  empty,
  follow,
  share,
  media,
  icon,
  withIcon,
} from "./social-ui.js";
export async function postDetail(root, id) {
  let data = await api("/post/" + id),
    p = data.post,
    reply = null,
    first = Infinity;
  const left = box("post-stage"),
    stage = box("media-frame"),
    right = box("discussion"),
    author = box(
      "byline",
      avatar(p.author),
      box(
        "summary",
        profile(data.author),
        n(
          "small",
          "subtle",
          (p.username ? "@" + p.username + " · " : "") + ago(p.created),
        ),
      ),
      ...(!data.own ? [follow(data.author)] : []),
    );
  const source = {
    id: p.id,
    body: p.body,
    name: data.author.name,
    media: p.media[0]?.id,
    type: p.media[0]?.type,
  };
  author.append(postMenu(source));
  if (new URLSearchParams(location.search).get("action") === "linkback")
    startLinkback(source);
  else if (new URLSearchParams(location.search).get("action") === "groups")
    await yourLinkbacks(source);
  if (!p.media.length) stage.append(n("blockquote", "", p.body));
  else stage.append(media(p.media[0]));
  if (p.media.length > 1) {
    let index = 0;
    const total = p.media.length,
      position = n("span", "", `1 / ${total}`);
    position.setAttribute("role", "status");
    function select(next) {
      index = (next + total) % total;
      stage.firstElementChild.replaceWith(media(p.media[index]));
      position.textContent = `${index + 1} / ${total}`;
    }
    function arrow(step, glyph, label) {
      const control = withIcon(n("button"), glyph, label);
      control.type = "button";
      control.onclick = () => select(index + step);
      return control;
    }
    stage.tabIndex = 0;
    stage.setAttribute("role", "group");
    stage.setAttribute(
      "aria-label",
      "Post gallery. Use Left and Right arrow keys to browse attachments.",
    );
    stage.onkeydown = (e) => {
      if (
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.target.closest("video")
      )
        return;
      const next = {
        ArrowLeft: index - 1,
        ArrowRight: index + 1,
        Home: 0,
        End: total - 1,
      }[e.key];
      if (typeof next !== "number") return;
      e.preventDefault();
      select(next);
    };
    stage.append(
      box(
        "slide-controls",
        arrow(-1, "back", "Previous attachment"),
        position,
        arrow(1, "next", "Next attachment"),
      ),
    );
  }
  const like = button("", async () => {
    await api("/heart", { post: id, on: !p.liked });
    p.liked = !p.liked;
    p.likes += p.liked ? 1 : -1;
    likeLabel();
  });
  function likeLabel() {
    like.replaceChildren(icon("heart"), n("span", "", p.likes));
    like.setAttribute("aria-pressed", String(!!p.liked));
    like.setAttribute("aria-label", `Like post, ${p.likes} likes`);
  }
  likeLabel();
  const countButton = button("", () => field.focus()),
    send = button("", async () => {
      if (await share(id)) await api("/share", { post: id });
    });
  send.append(icon("share"), "Share");
  left.append(stage, box("post-actions", like, countButton, send));
  const title = n("h2", "", "Comments "),
    count = n("span", "count");
  title.id = "comments";
  title.tabIndex = -1;
  title.append(count);
  const rows = box("comments"),
    field = input("Add a comment…", 500),
    form = n("form", "comment-form"),
    target = box("reply-target"),
    submit = n("button", "gradient", "Post");
  target.hidden = true;
  field.required = true;
  form.append(
    avatar("me"),
    field,
    withIcon(
      button("", () => {
        field.setRangeText(
          "😊",
          field.selectionStart,
          field.selectionEnd,
          "end",
        );
        field.focus();
      }),
      "smile",
      "Add emoji",
    ),
    submit,
  );
  right.append(
    author,
    postComposer.caption(p.body),
    postComposer.content({ ...p, media: [] }, api),
    title,
    rows,
    target,
    form,
  );
  if (data.downloadable && p.media.length)
    left.append(
      ...p.media.map((m, i) =>
        a(
          "/api/feed/media/" + m.id + "?download=1",
          "Download media" + (p.media.length > 1 ? " " + (i + 1) : ""),
        ),
      ),
    );
  if (!data.own)
    right.append(
      a(
        "/safety?id=" + p.author + "&post=" + id,
        "Report or Block",
        "moderate",
      ),
    );
  root.append(left, right);
  function cancel() {
    reply = null;
    target.hidden = true;
    field.placeholder = "Add a comment…";
  }
  function row(c) {
    const react = button(
      "",
      async () => {
        await api("/heart", { post: id, comment: c.id, on: !c.liked });
        c.liked = !c.liked;
        c.likes += c.liked ? 1 : -1;
        paint();
      },
      "outline",
    );
    function paint() {
      react.replaceChildren(icon("heart"), ` Like ${c.likes}`);
      react.setAttribute("aria-pressed", String(!!c.liked));
    }
    paint();
    const respond = button(
      "↶ Reply",
      () => {
        reply = c.id;
        target.hidden = false;
        target.replaceChildren(
          n("span", "", "Replying to " + c.name),
          button("Cancel", cancel),
        );
        field.focus();
      },
      "outline",
    );
    return box(
      "comment",
      avatar(c.author),
      box(
        "comment-body",
        profile(c, c.author),
        n("small", "subtle", " · " + ago(c.created)),
        ...(c.parentName
          ? [n("small", "reply-reference", "↳ " + c.parentName)]
          : []),
        n("p", "", c.body),
        box("comment-actions", respond, react),
      ),
    );
  }
  function draw(d) {
    count.textContent = d.post.comments;
    countButton.replaceChildren(icon("messages"), String(d.post.comments));
    countButton.setAttribute("aria-label", d.post.comments + " comments");
    rows.replaceChildren();
    first = d.comments[0]?.id ?? Infinity;
    if (d.more) rows.append(older);
    for (const c of d.comments) rows.append(row(c));
    if (!d.comments.length)
      rows.append(empty("No comments yet", "Be the first to leave a comment."));
  }
  const older = button("Earlier comments", async () => {
    const d = await api(`/post/${id}?before=${first}`);
    first = d.comments[0]?.id ?? first;
    older.after(...d.comments.map(row));
    if (!d.more) older.remove();
  });
  draw(data);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (submit.disabled || !field.value.trim()) return;
    submit.disabled = true;
    try {
      await api("/comment", { post: id, body: field.value, parent: reply });
      field.value = "";
      cancel();
      draw(await api("/post/" + id));
      rows.lastChild?.scrollIntoView({ block: "nearest" });
    } catch (e) {
      error(e);
    } finally {
      submit.disabled = false;
    }
  };
  if (location.hash === "#comments") title.focus();
}
