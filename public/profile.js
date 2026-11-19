const memberPage = (() => {
  const el = (id) => document.getElementById(id);
  let api,
    renderName,
    compose,
    data,
    selected = "Posts",
    generation = 0;
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const text = (tag, value) => {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  };
  function card(post) {
    const article = document.createElement("article");
    article.className = "member-post";
    const name = text("strong", "");
    renderName(name, post.name ? post : data.profile);
    const date = new Date(post.created);
    const time = text("time", date.toLocaleDateString());
    time.dateTime = date.toISOString();
    article.append(
      name,
      time,
      text("p", post.body),
      postComposer.content(post, api),
    );
    const link = text(
      "a",
      selected === "Reels" ? "Watch reel" : "Open post & comments",
    );
    link.className = "post-detail-link";
    link.href = (selected === "Reels" ? "/reels?id=" : "/post/") + post.id;
    article.append(link);
    return article;
  }
  async function tab(name) {
    if (name === "Saved" && !data.own) return;
    selected = name;
    const gen = ++generation,
      grid = el("memberGrid");
    for (const button of tabs)
      button.setAttribute("aria-pressed", String(button.dataset.tab === name));
    grid.setAttribute("aria-label", name);
    grid.replaceChildren();
    grid.classList.remove("is-empty");
    try {
      let items =
        name === "Posts"
          ? data.posts
          : name === "Reels"
            ? data.posts.filter((p) =>
                p.media.some((m) => m.type.startsWith("video/")),
              )
            : [];
      if (name === "Saved") {
        grid.textContent = "Loading saved posts…";
        items = (await api("?view=saved")).posts;
      }
      if (gen !== generation) return;
      if (items.length) {
        grid.replaceChildren(...items.map(card));
        return;
      }
      grid.classList.add("is-empty");
      const empty = document.createElement("div");
      empty.className = "member-empty";
      const icon = el("emptyIcon").content.cloneNode(true);
      empty.append(
        icon,
        text(
          "p",
          {
            Posts:
              !data.own && data.profile.private && !data.profile.isFollowing
                ? "This account’s posts are private"
                : "No posts yet",
            Reels: "No reels yet",
            Saved: "No saved posts yet",
            Tagged: "No tagged posts yet",
          }[name],
        ),
      );
      if (data.own && name === "Posts") {
        const b = text("button", "Create Your First Post");
        b.className = "pill";
        b.onclick = () => compose("");
        empty.append(b);
      }
      grid.replaceChildren(empty);
    } catch (e) {
      if (gen === generation) grid.textContent = e.message;
    }
  }
  async function refresh() {
    const id = location.pathname.split("/")[2];
    try {
      data = await api(
        "/profile" + (id ? "?id=" + encodeURIComponent(id) : ""),
      );
      const { profile: p, own } = data;
      document.title = `${p.name} · AfterLink`;
      document.querySelector(".member-avatar").src = "/api/feed/avatar/" + p.id;
      renderName(el("memberName"), p);
      el("memberHandle").textContent = p.username ? "@" + p.username : "";
      el("memberBio").textContent =
        p.bio || "Just joined AfterLink. Connect After. Link Forever.";
      for (const key of ["Followers", "Following"]) {
        el("list" + key).href =
          "/connections?id=" + p.id + "&tab=" + key.toLowerCase();
        const count = el(
          key === "Followers" ? "followerCount" : "followingCount",
        );
        count.onclick = () => location.assign(el("list" + key).href);
      }
      el("profileSafety").hidden = own;
      el("profileSafety").href = "/safety?id=" + p.id;
      el("postCount").textContent = p.postCount;
      el("followerCount").textContent = p.followers;
      el("followingCount").textContent = p.following;
      el("memberAction").textContent = own
        ? "Edit Profile"
        : p.isFollowing
          ? "Unfollow"
          : "Follow";
      el("memberAction").disabled = !own && !!p.private && !p.isFollowing;
      if (el("memberAction").disabled)
        el("memberAction").textContent = "Private account";
      tabs.find((b) => b.dataset.tab === "Saved").hidden = !own;
      el("memberStatus").hidden = true;
      el("memberContent").hidden = false;
      await tab(selected);
    } catch (e) {
      el("memberStatus").textContent = e.message;
      el("memberStatus").hidden = false;
    }
  }
  for (const b of tabs) b.onclick = () => tab(b.dataset.tab);
  el("memberAction").onclick = async () => {
    if (data.own) {
      location.assign("/profile/edit");
      return;
    }
    const b = el("memberAction");
    b.disabled = true;
    try {
      await api("/follow", {
        id: data.profile.id,
        on: !data.profile.isFollowing,
      });
      await refresh();
    } catch (e) {
      info("Follow", e.message);
    } finally {
      b.disabled = !!data.profile.private && !data.profile.isFollowing;
    }
  };
  el("shareProfile").onclick = () => {
    el("shareUrl").value = new URL(
      "/profile/" + data.profile.id,
      location.origin,
    ).href;
    el("copyStatus").textContent = "";
    el("shareMember").showModal();
  };
  el("copyLink").onclick = async () => {
    try {
      await navigator.clipboard.writeText(el("shareUrl").value);
      el("copyStatus").textContent = "Link copied.";
    } catch {
      el("shareUrl").focus();
      el("shareUrl").select();
      el("copyStatus").textContent = "Copy the selected link.";
    }
  };
  el("shareClose").onclick = () => el("shareMember").close();
  return {
    start(services) {
      ({ api, renderName, compose } = services);
      document.querySelector(".feed-brand").src =
        "/assets/profile-wordmark.webp";
      el("searchPeople").placeholder = "Search people…";
      document.querySelector(".profile-nav .avatar").src =
        "/api/feed/avatar/me";
      if (location.pathname.replace(/\/$/, "") === "/profile/edit")
        profileEditor.open(api);
      else refresh();
    },
    refresh,
  };
})();
