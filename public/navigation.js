// Remove private UI before navigating away, including when navigation is slow.
globalThis.clearExpiredSession = () => {
  if (document.documentElement.dataset.sessionExpired) return;
  document.documentElement.dataset.sessionExpired = "true";
  window.dispatchEvent(new Event("afterlink-session-expired"));
  for (const media of document.querySelectorAll("video,audio")) {
    media.pause();
    media.srcObject?.getTracks().forEach((track) => track.stop());
    media.srcObject = null;
    media.removeAttribute("src");
  }
  for (const dialog of document.querySelectorAll("dialog[open]"))
    dialog.close();
  document.body.replaceChildren(
    document.createTextNode("Your session ended. Returning to sign in…"),
  );
};
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
  let busy = false,
    queued = false;
  async function refresh(event) {
    if (document.hidden) return;
    if (busy) {
      // Interval ticks can wait for the next poll. A real change needs a
      // fresh count after this request, no matter how many events arrived.
      if (event) queued = true;
      return;
    }
    busy = true;
    try {
      const r = await fetch("/api/feed/unread");
      if (!r.ok) return;
      const counts = await r.json();
      if (document.hidden) return;
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
    } finally {
      busy = false;
      if (queued) {
        queued = false;
        void refresh();
      }
    }
  }
  addEventListener("unread-change", refresh);
  addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", refresh);
  setInterval(refresh, 8000);
})();
