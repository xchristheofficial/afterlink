const homeFeed = (() => {
  const el = (id) => document.getElementById(id);
  let view = "Feed",
    version = 0;
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
  function identity(profile) {
    const wrap = document.createElement("div");
    wrap.append(text("strong", profile.name));
    if (profile.username) wrap.append(text("small", "@" + profile.username));
    return wrap;
  }
  function row(item, people) {
    const node = document.createElement("article");
    node.className = "feed-row";
    const head = document.createElement("header");
    head.append(identity(item));
    if (people) {
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
      el("profileName").textContent = p.name;
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
      el("searchPeople").value = "";
      load(b.dataset.view);
    };
  for (const b of document.querySelectorAll(".home [data-later]"))
    b.onclick = () =>
      info(
        b.dataset.later,
        `${b.dataset.later} isn’t available on AfterLink yet.`,
      );
  el("peopleSearch").onsubmit = (e) => {
    e.preventDefault();
    load("Explore");
  };
  function compose(initial) {
    el("postText").value = initial;
    el("postError").textContent = "";
    el("composer").showModal();
    el("postText").focus();
  }
  el("openComposer").onclick = () => compose("");
  el("composeEmoji").onclick = () => compose("😊 ");
  el("cancelPost").onclick = () => el("composer").close();
  el("postForm").onsubmit = async (e) => {
    e.preventDefault();
    const button = el("publishPost");
    if (button.disabled) return;
    button.disabled = true;
    try {
      await api("/posts", { body: el("postText").value });
      el("composer").close();
      await load("Feed");
    } catch (err) {
      el("postError").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
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
    el("composer").close();
    el("founderBadge").hidden = true;
  }
  return {
    open: () => {
      clear();
      load("Feed");
    },
    clear,
  };
})();
