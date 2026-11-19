import { $, a, icon, avatar, error } from "./social-ui.js";
import { messages } from "./chats.js";
import { search, reels, notifications } from "./discovery.js";
import { postDetail } from "./post-detail.js";
const [, page, raw] = location.pathname.split("/"),
  peer = Number(raw),
  params = new URLSearchParams(location.search),
  q = params.get("q") || "",
  theme = page === "messages" && peer ? "thread" : page;
document.body.dataset.screen = theme;
document.title =
  ({
    thread: "Chat",
    messages: "Messages",
    notifications: "Notifications",
    search: "Explore",
    post: "Post",
    reels: "Reels",
  }[theme] || "AfterLink") + " · AfterLink";
$("#wordmark").src = "/assets/social/" + theme + ".webp";
const field = $("#socialSearch input");
field.value = q;
field.placeholder = {
  messages: "Search people, reels, chats…",
  thread: "Search conversations, messages…",
  notifications: "Search notifications…",
  search: "Search people, posts, reels…",
  post: "Search posts and people…",
  reels: "Search reels, topics, creators…",
}[theme];
$("#socialSearch").action =
  { thread: "/messages", reels: "/reels", notifications: "/notifications" }[
    theme
  ] || "/search";
const navs = {
  messages: ["home", "reels", "messages", "notifications"],
  thread: ["search", "notifications", "settings"],
  notifications: ["notifications", "messages", "settings"],
  reels: ["notifications", "search", "messages"],
  post: ["notifications", "messages", "search"],
  search: ["reels", "notifications", "messages"],
};
for (const key of navs[theme] || []) {
  const label = {
      home: "Home",
      reels: "Reels",
      messages: "Messages",
      notifications: "Bell",
      search: "Explore",
      settings: "Edit profile",
    }[key],
    link = a(key === "settings" ? "/profile/edit" : "/" + key, "");
  link.setAttribute("aria-label", label);
  link.title = label;
  if (key === page) link.setAttribute("aria-current", "page");
  if (["messages", "thread", "post", "notifications"].includes(theme)) {
    const image = document.createElement("img");
    image.className = "nav-glyph";
    image.alt = "";
    image.src = "/assets/social/" + theme + "-" + key + ".webp";
    link.append(image);
  } else link.append(icon(key === "search" ? "explore" : key));
  if (theme === "messages") link.append(label);
  $("#socialNav").append(link);
}
const mine = a("/profile", "", "nav-profile");
mine.setAttribute("aria-label", "My profile");
mine.append(avatar("me"));
$("#socialNav").append(mine);
$("#dismiss").onclick = () => $("#socialDialog").close();
const root = $("#surface");
try {
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
