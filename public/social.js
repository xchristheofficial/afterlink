import { $, icon, error } from "./social-ui.js";
const [, page, raw] = location.pathname.split("/"),
  peer = Number(raw),
  params = new URLSearchParams(location.search),
  q = params.get("q") || "",
  theme =
    page === "stories" && raw === "create"
      ? "story-create"
      : page === "messages" && peer
        ? "thread"
        : page;
document.body.dataset.screen = theme;
document.title =
  ({
    linkbacks: "Linkbacks",
    groups: "Groups",
    settings: "Settings",
    connections: "Connections",
    saved: "Saved",
    safety: "Report or Block",
    stories: "Stories",
    "story-create": "Create Story",
    thread: "Chat",
    messages: "Messages",
    notifications: "Notifications",
    search: "Explore",
    post: "Post",
    reels: "Reels",
  }[theme] || "AfterLink") + " · AfterLink";

const field = $("#socialSearch input");
field.value = q;
field.placeholder =
  {
    messages: "Search people, reels, chats…",
    thread: "Search conversations, messages…",
    notifications: "Search notifications…",
    search: "Search people, posts, reels…",
    post: "Search posts and people…",
    reels: "Search reels, topics, creators…",
  }[theme] || "Search AfterLink…";
$("#socialSearch").action =
  { thread: "/messages", reels: "/reels", notifications: "/notifications" }[
    theme
  ] || "/search";
$("#dismiss").replaceChildren(icon("close"));
$("#dismiss").onclick = () => $("#socialDialog").close();
const root = $("#surface");
try {
  if (page === "settings")
    await (await import("./settings-pages.js")).settings(root, raw);
  if (page === "linkbacks" || page === "groups")
    await (
      await import("./linkbacks.js")
    ).linkbacks(root, peer, page === "groups");
  if (page === "saved")
    await (await import("./settings-pages.js")).library(root);
  if (page === "connections")
    await (await import("./settings-pages.js")).connections(root);
  if (page === "safety")
    await (await import("./settings-pages.js")).safety(root);
  if (page === "stories")
    await (await import("./stories.js")).stories(root, raw === "create");
  if (page === "messages")
    await (await import("./chats.js")).messages(root, peer);
  if (page === "reels")
    await (
      await import("./discovery.js")
    ).reels(root, q, Number(params.get("id")));
  if (page === "post")
    await (await import("./post-detail.js")).postDetail(root, peer);
  if (page === "search") await (await import("./discovery.js")).search(root, q);
  if (page === "notifications")
    await (await import("./discovery.js")).notifications(root, q);
} catch (e) {
  error(e);
} finally {
  root.setAttribute("aria-busy", "false");
}
