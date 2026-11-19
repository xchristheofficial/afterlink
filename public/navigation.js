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
