const postComposer = (() => {
  const el = (id) => document.getElementById(id),
    types = {
      photo: "image/jpeg,image/png,image/webp,image/gif",
      video: "video/mp4,video/webm",
      gif: "image/gif",
    };
  const node = (tag, label) => {
    const n = document.createElement(tag);
    if (label !== undefined) n.textContent = label;
    return n;
  };
  function renderMedia(type, url) {
    const video = type.startsWith("video/"),
      n = node(video ? "video" : "img");
    n.src = url;
    if (video) {
      n.controls = true;
      n.preload = "metadata";
    } else {
      n.alt = "Post attachment";
      n.loading = "lazy";
    }
    return n;
  }
  function content(post, api) {
    const area = node("div");
    area.className = "published-extra";
    const tags = [
      post.audience === "followers" ? "Followers only" : "",
      post.feeling && `Feeling ${post.feeling.toLowerCase()}`,
      post.location,
    ].filter(Boolean);
    if (tags.length) area.append(node("small", tags.join(" · ")));
    if (post.media?.length) {
      const gallery = node("div");
      gallery.className = "published-gallery";
      for (const m of post.media)
        gallery.append(renderMedia(m.type, "/api/feed/media/" + m.id));
      area.append(gallery);
    }
    if (post.poll?.length) {
      const box = node("div");
      box.className = "published-poll";
      const msg = node("small");
      msg.setAttribute("role", "status");
      const render = () => {
        box.replaceChildren();
        post.poll.forEach((label, i) => {
          const n = post.votes.find((v) => v.choice === i)?.n || 0,
            b = node("button", `${label} · ${n}`);
          b.type = "button";
          b.setAttribute("aria-pressed", String(post.choice === i));
          b.onclick = async () => {
            for (const x of box.querySelectorAll("button")) x.disabled = true;
            try {
              Object.assign(
                post,
                await api("/vote", { id: post.id, choice: i }),
              );
              msg.textContent = "Vote recorded.";
            } catch (e) {
              msg.textContent = e.message;
            }
            render();
          };
          box.append(b);
        });
        box.append(msg);
      };
      render();
      area.append(box);
    }
    return area;
  }
  async function open(api, renderName) {
    const params = new URLSearchParams(location.search),
      back = params.get("from") === "profile" ? "/profile" : "/home",
      tool = params.get("tool");
    let media = [],
      ready = false,
      busy = false,
      dirty = false,
      fromDraft = false,
      saved = null,
      isPrivate = false;
    document.title = "Create Post · AfterLink";
    el("account").classList.add("editor-screen", "compose-screen");
    el("createPage").hidden = false;
    document.querySelector(".feed-brand").src = "/assets/profile-wordmark.webp";
    document.querySelector(".profile-nav .avatar").src = el("postAvatar").src =
      "/api/feed/avatar/me";
    el("searchPeople").placeholder = "Search people…";
    const err = (t) => (el("postError").textContent = t);
    function enabled() {
      el("publishPost").disabled =
        !ready || busy || !(el("postText").value.trim() || media.length);
      el("openDrafts").disabled = !ready || busy;
    }
    function count() {
      el("postCounter").textContent = `${el("postText").value.length} / 500`;
      enabled();
    }
    function previews() {
      const wrap = el("postPreviews");
      wrap.replaceChildren();
      for (const [i, m] of media.entries()) {
        const item = node("div"),
          b = node("button", "×");
        b.type = "button";
        b.setAttribute("aria-label", `Remove attachment ${i + 1}`);
        b.onclick = () => {
          if (busy) return;
          media.splice(i, 1);
          dirty = true;
          previews();
        };
        item.append(renderMedia(m.type, `data:${m.type};base64,` + m.data), b);
        wrap.append(item);
      }
      enabled();
    }
    const read = (file) =>
      new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () =>
          resolve({ type: file.type, data: r.result.split(",")[1] });
        r.onerror = () => reject(Error("Could not read this file."));
        r.readAsDataURL(file);
      });
    async function add(files) {
      if (!files.length || busy) return;
      busy = true;
      enabled();
      try {
        files = [...files];
        const all = [...media, ...files];
        if (
          all.length > 10 ||
          (all.some((f) => f.type.startsWith("video/")) && all.length !== 1)
        )
          throw Error("Choose up to 10 photos or one video, not both.");
        if (
          files.some(
            (f) =>
              !(types.photo + "," + types.video).split(",").includes(f.type),
          )
        )
          throw Error("Choose JPG, PNG, WebP, GIF, MP4 or WebM.");
        if (
          media.reduce((n, m) => n + Math.floor((m.data.length * 3) / 4), 0) +
            files.reduce((n, f) => n + f.size, 0) >
          8 * 1024 * 1024
        )
          throw Error("Attachments must be 8 MB or less in total.");
        media.push(...(await Promise.all(files.map(read))));
        dirty = true;
        err("");
        previews();
      } catch (e) {
        err(e.message);
      } finally {
        busy = false;
        enabled();
      }
    }
    function picker(kind) {
      const f = el("postFiles");
      f.accept = types[kind] || types.photo + "," + types.video;
      f.multiple = kind !== "video";
      f.click();
    }
    el("postFiles").onchange = (e) => {
      add([...e.target.files]);
      e.target.value = "";
    };
    document
      .querySelectorAll("[data-pick]")
      .forEach((b) => (b.onclick = () => picker(b.dataset.pick)));
    el("browsePost").onclick = () => picker();
    const drop = el("postDrop");
    drop.ondragover = (e) => {
      e.preventDefault();
      drop.classList.add("dragging");
    };
    drop.ondragleave = () => drop.classList.remove("dragging");
    drop.ondrop = (e) => {
      e.preventDefault();
      drop.classList.remove("dragging");
      add(e.dataTransfer.files);
    };
    function panel(id, on) {
      el(id).hidden = !on;
      document
        .querySelector(`[data-extra="${id}"]`)
        .setAttribute("aria-expanded", String(on));
    }
    document.querySelectorAll("[data-extra]").forEach(
      (b) =>
        (b.onclick = () => {
          const id = b.dataset.extra;
          panel(id, el(id).hidden);
          dirty = true;
          if (!el(id).hidden) el(id).querySelector("input,select").focus();
        }),
    );
    el("postForm").oninput = () => {
      dirty = true;
      count();
    };
    document.querySelectorAll("[data-exit]").forEach(
      (b) =>
        (b.onclick = () => {
          if (
            !busy &&
            (!dirty || confirm("Discard unsaved changes to this post?"))
          )
            location.assign(back);
        }),
    );
    const payload = () => ({
      body: el("postText").value,
      audience: el("postAudience").value,
      media,
      feeling: el("feelingPanel").hidden ? "" : el("postFeeling").value,
      location: el("placePanel").hidden ? "" : el("postLocation").value,
      poll: el("pollPanel").hidden
        ? []
        : [...el("pollPanel").querySelectorAll("input")].map((x) => x.value),
      fromDraft,
    });
    el("postForm").onsubmit = async (e) => {
      e.preventDefault();
      if (busy || !ready) return;
      busy = true;
      enabled();
      el("publishPost").textContent = "Publishing…";
      el("postForm").inert = true;
      try {
        await api("/posts", payload());
        location.replace(back);
      } catch (e) {
        err(e.message);
        busy = false;
        el("postForm").inert = false;
        el("publishPost").textContent = "Publish";
        enabled();
      }
    };
    const dialog = el("draftDialog"),
      draftButtons = () => [
        el("restoreDraft"),
        el("storeDraft"),
        el("removeDraft"),
      ];
    el("openDrafts").onclick = async () => {
      dialog.showModal();
      draftButtons().forEach((b) => (b.disabled = true));
      el("draftInfo").textContent = "Loading draft…";
      try {
        ({ draft: saved } = await api("/draft"));
        el("draftInfo").textContent = saved
          ? "Saved draft: " +
            (saved.body.slice(0, 80) || "Attachments or post options")
          : "No saved draft. Save this post to finish later.";
        el("storeDraft").disabled = false;
        el("restoreDraft").disabled = el("removeDraft").disabled = !saved;
      } catch (e) {
        el("draftInfo").textContent = e.message;
      }
    };
    el("closeDraft").onclick = () => dialog.close();
    el("restoreDraft").onclick = () => {
      if (
        !saved ||
        (dirty &&
          !confirm("Replace your unsaved changes with the saved draft?"))
      )
        return;
      el("postText").value = saved.body;
      el("postAudience").value = isPrivate ? "followers" : saved.audience;
      el("postLocation").value = saved.location;
      el("postFeeling").value = saved.feeling;
      panel("feelingPanel", !!saved.feeling);
      panel("placePanel", !!saved.location);
      panel("pollPanel", !!saved.poll.length);
      el("pollPanel")
        .querySelectorAll("input")
        .forEach((x, i) => (x.value = saved.poll[i] || ""));
      media = saved.media;
      fromDraft = true;
      dirty = false;
      previews();
      count();
      dialog.close();
    };
    el("storeDraft").onclick = async () => {
      if (saved && !confirm("Replace your saved draft?")) return;
      draftButtons().forEach((b) => (b.disabled = true));
      try {
        await api("/draft", payload());
        fromDraft = true;
        dirty = false;
        dialog.close();
        err("Draft saved.");
      } catch (e) {
        el("draftInfo").textContent = e.message;
        el("storeDraft").disabled = false;
      }
    };
    el("removeDraft").onclick = async () => {
      if (!confirm("Delete your saved draft?")) return;
      try {
        await api("/discard-draft", {});
        fromDraft = false;
        dialog.close();
        err("Saved draft deleted.");
      } catch (e) {
        el("draftInfo").textContent = e.message;
      }
    };
    try {
      const { profile: p } = await api("/profile");
      renderName(el("postName"), p);
      el("postHandle").textContent = p.username ? "@" + p.username : "";
      el("postText").placeholder = `What's on your mind, ${p.name}?`;
      isPrivate = !!p.private;
      if (isPrivate) {
        el("postAudience").value = "followers";
        el("postAudience").disabled = true;
      }
      ready = true;
      enabled();
      if (tool === "feeling") panel("feelingPanel", true);
      if (tool === "photo" || tool === "video") {
        el("browsePost").focus();
        el("browsePost").onclick = () => picker(tool);
      }
    } catch (e) {
      err(e.message);
    }
  }
  return { open, content };
})();
