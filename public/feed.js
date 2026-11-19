const homeFeed = (() => {
  const el = (id) => document.getElementById(id);
  const onProfile = /^\/profile(?:\/|$)/.test(location.pathname);
  const onCreate = /^\/create\/?$/.test(location.pathname);
  let view = "Feed",
    version = 0;
  const grid = document.querySelector(".home-grid");
  const railToggle = el("railToggle");
  const railKey = "afterlink.sidebar.collapsed";
  function setRail(collapsed) {
    grid.classList.toggle("rail-collapsed", collapsed);
    railToggle.setAttribute("aria-expanded", String(!collapsed));
    railToggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    railToggle.setAttribute("aria-label", railToggle.title);
  }
  try {
    setRail(localStorage.getItem(railKey) === "true");
  } catch {
    setRail(false);
  }
  railToggle.onclick = () => {
    const collapsed = !grid.classList.contains("rail-collapsed");
    setRail(collapsed);
    try {
      localStorage.setItem(railKey, String(collapsed));
    } catch {
      /* Storage is optional. */
    }
  };
  for (const button of document.querySelectorAll(".side-nav button"))
    button.title = button.getAttribute("aria-label");
  const text = (tag, value) => {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  };
  async function api(path, body) {
    const r = await fetch(
      "/api/feed" + path,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-AfterLink-Request": "1",
            },
            body: JSON.stringify(body),
          },
    );
    if (r.status === 401) {
      location.replace("/?auth=session");
      throw Error("Your session ended. Please sign in again.");
    }
    const data = await r.json();
    if (!r.ok) throw Error(data.error || "Unable to load the feed.");
    return data;
  }
  function fail(e) {
    el("feedError").hidden = false;
    el("feedError").textContent = e.message;
  }
  function action(label, task) {
    const b = text("button", label);
    b.className = "mini-action";
    b.onclick = async () => {
      b.disabled = true;
      try {
        await task();
        await load(view);
      } catch (e) {
        fail(e);
      } finally {
        b.disabled = false;
      }
    };
    return b;
  }
  function renderName(node, profile) {
    node.textContent = profile.name;
    if (!profile.founder) return;
    const badge = document.createElement("img");
    badge.className = "verified-mark";
    badge.src = "/assets/radar-gold-badge.webp";
    badge.alt = badge.title = "Verified account";
    node.append(badge);
  }
  function identity(profile) {
    const wrap = document.createElement("div");
    const name = document.createElement("strong");
    renderName(name, profile);
    const link = document.createElement("a");
    link.href = "/profile/" + (profile.author ?? profile.id);
    link.className = "author-link";
    link.append(name);
    wrap.append(link);
    if (profile.username) wrap.append(text("small", "@" + profile.username));
    return wrap;
  }
  function detailLink(item) {
    const link = text("a", "Open post & comments");
    link.href = "/post/" + item.id;
    link.className = "post-detail-link";
    return link;
  }
  function row(item, people) {
    const node = document.createElement("article");
    node.className = "feed-row";
    const head = document.createElement("header");
    head.append(identity(item));
    if (people) {
      if (item.private && !item.following)
        head.append(text("small", "Private account"));
      else
        head.append(
          action(item.following ? "Unfollow" : "Follow", () =>
            api("/follow", { id: item.id, on: !item.following }),
          ),
        );
      node.append(head);
    } else {
      head.append(text("time", new Date(item.created).toLocaleDateString()));
      node.append(
        head,
        text("p", item.body),
        postComposer.content(item, api),
        detailLink(item),
        action(item.saved ? "Unsave" : "Save post", () =>
          api("/save", { id: item.id, on: !item.saved }),
        ),
      );
    }
    return node;
  }
  async function load(next) {
    view = next;
    const id = ++version;
    const feed = view === "Feed",
      people = view === "Explore";
    for (const b of document.querySelectorAll(".home [data-view]")) {
      if (b.dataset.view === next) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    el("feedPanel").hidden = !feed;
    el("otherPanel").hidden = feed;
    el("emptyFeed").hidden = true;
    el("viewTitle").textContent = next === "Explore" ? "Explore People" : next;
    el("feedError").hidden = true;
    el("viewHint").textContent = "";
    el("settingsLinks").hidden = next !== "Settings";
    el("feedRows").replaceChildren();
    try {
      const [data, results] = await Promise.all([
        api(next === "Saved" ? "?view=saved" : ""),
        people
          ? api("/people?q=" + encodeURIComponent(el("searchPeople").value))
          : null,
      ]);
      if (id !== version) return;
      const p = data.profile;
      document
        .querySelectorAll(".home-grid .avatar")
        .forEach((img) => (img.src = "/api/feed/avatar/me"));
      renderName(el("profileName"), p);
      el("profileHandle").textContent = p.username ? "@" + p.username : "";
      el("founderBadge").hidden = !p.founder;
      el("counts").textContent =
        `${p.followers} Followers • ${p.following} Following`;
      if (next === "Settings") {
        el("viewHint").textContent = "Your signed-in account";
        return;
      }
      const items = people ? results.people : data.posts;
      el("emptyFeed").hidden = !feed || items.length > 0;
      if (!items.length && !feed)
        el("viewHint").textContent = people
          ? "No matching accounts yet."
          : "No saved posts yet.";
      el("feedRows").replaceChildren(...items.map((x) => row(x, people)));
    } catch (e) {
      if (id === version) fail(e);
    }
  }
  for (const b of document.querySelectorAll(".home [data-view]"))
    b.onclick = () => {
      if (["Settings", "Saved"].includes(b.dataset.view)) {
        location.assign("/" + b.dataset.view.toLowerCase());
        return;
      }
      if (b.dataset.view === "Explore") {
        location.assign("/search");
        return;
      }
      el("searchPeople").value = "";
      load(b.dataset.view);
    };
  for (const b of document.querySelectorAll(".home [data-later]"))
    b.onclick = () => {
      const paths = {
        "Your Story": "/stories",
        Reels: "/reels",
        Messages: "/messages",
        Notifications: "/notifications",
      };
      if (paths[b.dataset.later]) location.assign(paths[b.dataset.later]);
      else
        info(
          b.dataset.later,
          `${b.dataset.later} isn’t available on AfterLink yet.`,
        );
    };
  el("peopleSearch").onsubmit = (e) => {
    e.preventDefault();
    location.assign(
      "/search?q=" + encodeURIComponent(el("searchPeople").value),
    );
  };
  function compose(tool = "") {
    const params = new URLSearchParams();
    if (onProfile) params.set("from", "profile");
    if (tool) params.set("tool", tool);
    location.assign("/create" + (params.size ? "?" + params : ""));
  }
  el("openComposer").onclick = () => compose();
  el("composePhoto").onclick = () => compose("photo");
  el("composeVideo").onclick = () => compose("video");
  el("composeEmoji").onclick = () => compose("feeling");
  function clear() {
    version++;
    for (const id of [
      "profileName",
      "profileHandle",
      "counts",
      "feedRows",
      "feedError",
    ])
      el(id).replaceChildren();
    el("searchPeople").value = "";
    el("postForm").reset();

    el("founderBadge").hidden = true;
  }
  return {
    open: () => {
      clear();
      if (onProfile || onCreate) {
        grid.hidden = true;
        railToggle.hidden = true;
        document.querySelector(".profile-nav").hidden = false;
        el("account").classList.add("profile-screen");
        if (onCreate) {
          postComposer.open(api, renderName);
          return;
        }
        el("memberPage").hidden = false;
        memberPage.start({ api, renderName, compose });
      } else {
        const q = new URLSearchParams(location.search).get("q");
        if (q !== null) el("searchPeople").value = q;
        load(q === null ? "Feed" : "Explore");
      }
    },
    clear,
  };
})();
