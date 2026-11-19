import { settings, connections, library, safety } from "./settings-pages.js";
import { stories } from "./stories.js";
import { $, icon, error } from "./social-ui.js";
import { messages } from "./chats.js";
import { search, reels, notifications } from "./discovery.js";
import { postDetail } from "./post-detail.js";
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
$("#wordmark").src = "/assets/profile-wordmark.webp";
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
  if (page === "settings") await settings(root, raw);
  if (page === "saved") await library(root);
  if (page === "connections") await connections(root);
  if (page === "safety") await safety(root);
  if (page === "stories") await stories(root, raw === "create");
  if (page === "messages") await messages(root, peer);
  if (page === "reels") await reels(root, q, Number(params.get("id")));
  if (page === "post") await postDetail(root, peer);
  if (page === "search") await search(root, q);
  if (page === "notifications") await notifications(root, q);
} catch (e) {
  error(e);
} finally {
  root.setAttribute("aria-busy", "false");
}
