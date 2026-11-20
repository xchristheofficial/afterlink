// The feed already has a rail. Other member pages share these four shortcuts;
// the compact profile editor shows only the profile photo.
(() => {
  const nav = document.querySelector("#socialNav, .profile-nav");
  if (!nav || location.pathname === "/") return;
  const ns = "http://www.w3.org/2000/svg";
  for (const [path, label] of [
    ["home", "Home"],
    ["messages", "Messages"],
    ["notifications", "Notifications"],
    ["settings", "Settings"],
    ["profile", "My profile"],
  ]) {
    if (/^\/profile\/edit\/?$/.test(location.pathname) && path !== "profile")
      continue;
    const link = document.createElement("a");
    link.href = "/" + path;
    link.title = label;
    link.setAttribute("aria-label", label);
    if (
      location.pathname.split("/")[1] === path &&
      (path !== "profile" || location.pathname === "/profile")
    )
      link.setAttribute("aria-current", "page");
    if (path === "profile") {
      const image = new Image();
      image.alt = "";
      image.className = "face avatar";
      image.src = "/api/feed/avatar/me";
      link.append(image);
    } else {
      const svg = document.createElementNS(ns, "svg"),
        use = document.createElementNS(ns, "use");
      svg.setAttribute("class", "fi");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      use.setAttribute("href", "/assets/icons.svg#" + path);
      svg.append(use);
      link.append(svg);
    }
    nav.append(link);
  }
})();

// Counts cover all visible unread items, not only the first page of the inbox.
(() => {
  if (location.pathname === "/") return;
  let version = 0;
  async function refresh() {
    if (document.hidden) return;
    const seq = ++version;
    try {
      const r = await fetch("/api/feed/unread");
      if (!r.ok) return;
      const counts = await r.json();
      if (seq !== version) return;
      for (const [key, title] of [
        ["messages", "Messages"],
        ["notifications", "Notifications"],
        ["groups", "Groups"],
        ["linkbacks", "Linkbacks"],
        ["chats", "Chats"],
      ]) {
        const selector = ["messages", "notifications"].includes(key)
          ? `#socialNav a[href="/${key}"],.profile-nav a[href="/${key}"],.side-nav [data-later="${title}"]`
          : `.lb-tabs a[href="/${key === "chats" ? "messages" : key}"]`;
        for (const link of document.querySelectorAll(selector)) {
          let badge = link.querySelector(".nav-unread");
          if (!badge) {
            badge = document.createElement("b");
            badge.className = "nav-unread";
            badge.setAttribute("aria-hidden", "true");
            link.append(badge);
          }
          const count = counts[key];
          badge.hidden = !count;
          badge.textContent = count > 99 ? "99+" : String(count);
          link.setAttribute(
            "aria-label",
            count ? `${title}, ${count} unread` : title,
          );
        }
      }
    } catch {
      /* A network interruption must not prevent navigation. */
    }
  }
  addEventListener("unread-change", refresh);
  addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", refresh);
  setInterval(refresh, 8000);
})();
