export const $ = (s) => document.querySelector(s);
export function n(tag, cls = "", text = "") {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== "") e.textContent = text;
  return e;
}
export function box(cls, ...kids) {
  const e = n("div", cls);
  e.append(...kids);
  return e;
}
export function a(href, label, cls = "") {
  const e = n("a", cls, label);
  e.href = href;
  return e;
}
export function button(label, fn, cls = "") {
  const e = n("button", cls, label);
  e.type = "button";
  e.onclick = async () => {
    if (e.disabled) return;
    e.disabled = true;
    try {
      await fn(e);
    } catch (err) {
      error(err);
    } finally {
      e.disabled = false;
    }
  };
  return e;
}
export function input(label, max = 100) {
  const e = n("input");
  e.placeholder = label;
  e.setAttribute("aria-label", label);
  e.maxLength = max;
  return e;
}
export function avatar(id) {
  const e = n("img", "face");
  e.alt = "";
  e.src = "/api/feed/avatar/" + id;
  return e;
}
export function name(p) {
  const e = n("strong", "member-name", p.name);
  if (p.founder) {
    const badge = n("img", "verified-mark");
    badge.src = "/assets/radar-gold-badge.webp";
    badge.alt = "Verified founder";
    e.append(badge);
  }
  return e;
}
export function profile(p, id = p.id) {
  const e = a("/profile/" + id, "", "person-link");
  e.append(name(p));
  return e;
}
export function ago(ms) {
  const m = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  return m < 1
    ? "Just now"
    : m < 60
      ? m + "m ago"
      : m < 1440
        ? Math.floor(m / 60) + "h ago"
        : new Date(ms).toLocaleDateString();
}
export function error(e) {
  const alert = $("#alert");
  alert.hidden = false;
  alert.textContent = e.message || e;
}
export async function api(path, data) {
  const r = await fetch(
    "/api/feed" + path,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-AfterLink-Request": "1",
          },
          body: JSON.stringify(data),
        },
  );
  if (r.status === 401) {
    location.replace(
      "/?auth=session&next=" +
        encodeURIComponent(location.pathname + location.search),
    );
    throw Error("Please sign in again.");
  }
  const j = await r.json();
  if (!r.ok) throw Error(j.error || "Unable to complete request.");
  return j;
}
export const icons = {
  home: "M2 11 12 2l10 9 M5 10v11h5v-7h4v7h5V10",
  messages:
    "M4 3h16q2 0 2 2v11q0 2-2 2h-9l-6 5v-5H4q-2 0-2-2V5q0-2 2-2z M7 10h.1m4.9 0h.1m4.9 0h.1",
  reels: "M4 3h16q2 0 2 2v14q0 2-2 2H4q-2 0-2-2V5q0-2 2-2z M10 8l6 4-6 4z",
  notifications: "M3 18h18l-3-5V9a6 6 0 0 0-12 0v4z M10 21q2 3 4 0",
  search: "M14 6q-5-6-10 0t4 10q8 1 6-10z M14 15l7 7",
  heart: "M12 21 3 12C-2 5 7-1 12 6c5-7 14-1 9 6z",
  share: "M12 15V2m-5 5 5-5 5 5 M6 10H3v12h18V10h-3",
  save: "M5 2h14v20l-7-5-7 5z",
  settings:
    "M12 3v3m0 12v3m9-9h-3M6 12H3m3-6 2 2m8 8 2 2M6 18l2-2m8-8 2-2 M19 12a7 7 0 1 1-14 0 7 7 0 1 1 14 0z M14 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0z",
  explore: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
};
export function icon(key) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    path = document.createElementNS(svg.namespaceURI, "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  path.setAttribute("d", icons[key]);
  svg.append(path);
  return svg;
}
export function empty(title, detail, link) {
  return box(
    "empty-state",
    n("h2", "", title),
    n("p", "", detail),
    ...(link ? [link] : []),
  );
}
export function follow(p) {
  if (p.private && !p.following) return n("span", "subtle", "Private account");
  const b = button(
    p.following ? "Following" : "＋ Follow",
    async () => {
      await api("/follow", { id: p.id, on: !p.following });
      p.following = !p.following;
      b.textContent = p.following ? "Following" : "＋ Follow";
    },
    "gradient",
  );
  return b;
}
export function sheet(title, ...kids) {
  $("#sheet").replaceChildren(n("h2", "", title), ...kids);
  $("#socialDialog").setAttribute("aria-label", title);
  if (!$("#socialDialog").open) $("#socialDialog").showModal();
}
export async function share(id) {
  const url = new URL("/post/" + id, location.origin).href;
  try {
    if (navigator.share) {
      await navigator.share({ url });
      return true;
    }
    await navigator.clipboard.writeText(url);
    sheet(
      "Link copied",
      n("p", "", "Only members in this post’s audience can open it."),
    );
    return true;
  } catch (e) {
    if (e.name === "AbortError") return;
    const field = input("Post link");
    field.value = url;
    field.readOnly = true;
    sheet("Share post", field);
    field.select();
  }
}
export function media(m) {
  const e = n(m.type.startsWith("video/") ? "video" : "img");
  e.src = "/api/feed/media/" + m.id;
  if (e.tagName === "VIDEO") {
    e.controls = true;
    e.playsInline = true;
    e.preload = "metadata";
  } else {
    e.alt = "Photo attached to this post";
    e.loading = "lazy";
  }
  return e;
}
export function tabs(labels, selected, fn) {
  const bar = box("tabs");
  for (const t of labels) {
    const b = button(t, () => {
      for (const x of bar.children)
        x.setAttribute("aria-pressed", String(x === b));
      fn(t);
    });
    b.setAttribute("aria-pressed", String(t === selected));
    bar.append(b);
  }
  return bar;
}
