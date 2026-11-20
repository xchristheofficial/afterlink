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
  e.loading = "lazy";
  e.decoding = "async";
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
  if (document.documentElement.dataset.sessionExpired) return;
  const dialog = $("#socialDialog[open]");
  let alert = $("#alert");
  if (dialog) {
    alert = dialog.querySelector(".dialog-error");
    if (!alert) {
      alert = n("p", "dialog-error");
      alert.setAttribute("role", "alert");
      $("#sheet").append(alert);
    }
  }
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
    window.clearExpiredSession?.();
    location.replace(
      "/?auth=session&next=" +
        encodeURIComponent(location.pathname + location.search),
    );
    throw Error("Please sign in again.");
  }
  if (!r.ok) {
    const detail = await r.json().catch(() => null);
    throw Object.assign(Error(detail?.error || "Unable to complete request."), {
      status: r.status,
    });
  }
  return r.json();
}
export function icon(key) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    use = document.createElementNS(svg.namespaceURI, "use");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", "/assets/icons.svg#" + key);
  svg.append(use);
  return svg;
}
export function withIcon(element, key, label) {
  element.replaceChildren(icon(key));
  element.setAttribute("aria-label", label);
  element.title = label;
  return element;
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
    p.following ? "Following" : "Follow",
    async () => {
      await api("/follow", { id: p.id, on: !p.following });
      p.following = !p.following;
      b.textContent = p.following ? "Following" : "Follow";
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
