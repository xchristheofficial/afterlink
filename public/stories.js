import {
  $,
  n,
  box,
  a,
  button,
  input,
  api,
  avatar,
  name,
  ago,
  empty,
  error,
  icon,
  withIcon,
  sheet,
} from "./social-ui.js";
const templates = ["Mountains", "Forest", "Lake", "Beach", "City", "Desert"];
const asset = (t) => "/assets/templates/" + t + ".webp";
export async function stories(root, create) {
  if (create) return editor(root);
  const { stories, uid } = await api("/stories");
  if (!stories.length) {
    root.append(
      empty(
        "No active stories",
        "Stories are available for 24 hours.",
        a("/stories/create", "Create a story", "gradient"),
      ),
    );
    return;
  }
  let index = Math.max(
      0,
      stories.findIndex(
        (s) => s.id === Number(new URLSearchParams(location.search).get("id")),
      ),
    ),
    timer;
  function draw() {
    clearTimeout(timer);
    const s = stories[index],
      mine = s.author === uid,
      src = s.template ? asset(s.template) : "/api/feed/story-media/" + s.id,
      video = s.type?.startsWith("video/"),
      image = n(video ? "video" : "img"),
      bars = box("story-progress");
    for (let i = 0; i < stories.length; i++) {
      const b = button("", () => {
        index = i;
        draw();
      });
      b.setAttribute("aria-label", "Story " + (i + 1));
      b.setAttribute("aria-pressed", String(index === i));
      bars.append(b);
    }
    image.src = src;
    image.setAttribute("aria-label", "Story by " + s.name);
    if (video) {
      image.controls = true;
      image.playsInline = true;
      image.onended = next;
    }
    const header = box(
      "story-author",
      avatar(s.author),
      box("pref-copy", name(s), n("small", "", ago(s.created))),
      withIcon(a("/home", "", "story-close"), "close", "Close story"),
    );
    if (!mine)
      header.append(
        withIcon(
          a("/safety?id=" + s.author, "", "story-more"),
          "more",
          "Report or Block",
        ),
      );
    const stage = box(
      "story-stage",
      image,
      ...(s.caption ? [n("strong", "story-caption", s.caption)] : []),
    );
    const controls = box(
      "story-controls",
      button("Previous", () => {
        index = (index + stories.length - 1) % stories.length;
        draw();
      }),
      a("/stories/create", "Create story"),
      button("Next", next),
    );
    const player = box("story-player", bars, header, stage, controls);
    root.replaceChildren(player);
    let paused = false;
    const pause = () => {
      clearTimeout(timer);
      paused = true;
    };
    if (
      !video &&
      !matchMedia("(prefers-reduced-motion:reduce)").matches &&
      document.documentElement.dataset.motion !== "reduce" &&
      stories.length > 1
    ) {
      const b = button("Pause", () => {
        if (paused) {
          timer = setTimeout(next, 7000);
          paused = false;
          b.textContent = "Pause";
        } else {
          pause();
          b.textContent = "Resume";
        }
      });
      controls.append(b);
      timer = setTimeout(next, 7000);
    }
    function next() {
      if (index < stories.length - 1) {
        index++;
        draw();
      } else {
        clearTimeout(timer);
      }
    }
    if (!mine && s.replies) {
      const msg = input("Reply to " + s.name + "…", 500),
        status = n("small");
      msg.onfocus = pause;
      const reply = async (text) => {
        await api("/story-reply", { id: s.id, body: text });
        msg.value = "";
        status.textContent = "Sent in Messages.";
      };
      player.append(
        box(
          "story-reply",
          msg,
          button("Send", () => reply(msg.value)),
        ),
        box(
          "reactions",
          ...["❤️", "🔥", "👏", "😁"].map((r) => button(r, () => reply(r))),
        ),
        status,
      );
    }
    history.replaceState(null, "", "/stories?id=" + s.id);
  }
  draw();
}
async function editor(root) {
  const picker = box(
      "story-picker",
      n("h2", "", "Photo / Video Picker"),
      n("p", "subtle", "Choose a template or upload your own photo or video."),
    ),
    center = box("story-preview", n("h2", "", "Story Preview")),
    details = box("story-details", n("h2", "", "Story Details")),
    gallery = box("template-grid"),
    stage = box("story-stage");
  root.append(picker, center, details);
  let template = templates[0],
    file,
    url,
    sharing = false;
  const caption = input("Add caption…", 220),
    aud = n("select"),
    reply = n("input"),
    friends = box("friend-list"),
    status = n("p", "pref-status"),
    up = n("input"),
    camera = n("input");
  for (const f of [up, camera]) {
    f.type = "file";
    f.accept = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm";
    f.hidden = true;
  }
  camera.accept = "image/*";
  camera.setAttribute("capture", "environment");
  for (const [t, v] of [
    ["Everyone", "everyone"],
    ["Followers", "followers"],
    ["Close Friends", "friends"],
  ]) {
    const o = n("option", "", t);
    o.value = v;
    aud.append(o);
  }
  aud.setAttribute("aria-label", "Audience");
  reply.type = "checkbox";
  reply.checked = true;
  const lab = n("label");
  lab.append("Allow Replies ", reply);
  const checked = new Set();
  aud.onchange = async () => {
    friends.replaceChildren();
    if (aud.value !== "friends") return;
    try {
      const d = await api("/connections");
      for (const p of d.Followers) {
        const l = n("label"),
          c = n("input");
        c.type = "checkbox";
        c.checked = checked.has(p.id);
        c.onchange = () =>
          c.checked ? checked.add(p.id) : checked.delete(p.id);
        l.append(c, p.name);
        friends.append(l);
      }
      if (!d.Followers.length)
        friends.textContent =
          "You need a follower to share with Close Friends.";
    } catch (e) {
      error(e);
    }
  };
  for (const t of templates) {
    const b = button(t, () => {
      file = null;
      template = t;
      preview();
    });
    b.dataset.template = t;
    const img = n("img");
    img.alt = "";
    img.src = asset(t);
    b.prepend(img);
    gallery.append(b);
  }
  picker.append(
    gallery,
    up,
    camera,
    box(
      "story-controls",
      button("Take Photo", () => camera.click()),
      button("Upload", () => up.click()),
    ),
  );
  for (const f of [up, camera])
    f.onchange = () => {
      if (!f.files[0]) return;
      if (f.files[0].size > 8 * 1024 * 1024) {
        error("Choose a file under 8 MB.");
        return;
      }
      file = f.files[0];
      template = null;
      preview();
    };
  let captionNode;
  function preview() {
    if (url) URL.revokeObjectURL(url);
    url = file ? URL.createObjectURL(file) : null;
    const isVideo = file?.type.startsWith("video/"),
      e = n(isVideo ? "video" : "img");
    e.src = url || asset(template);
    e.setAttribute("aria-label", "Selected story background");
    if (isVideo) e.controls = true;
    captionNode = n("strong", "story-caption", caption.value);
    captionNode.hidden = !caption.value;
    stage.replaceChildren(e, captionNode);
    for (const b of gallery.children)
      b.setAttribute("aria-pressed", String(b.dataset.template === template));
  }
  caption.oninput = () => {
    captionNode.textContent = caption.value;
    captionNode.hidden = !caption.value;
  };
  const tools = box(
    "story-tools",
    button("Aa", () => caption.focus()),
    withIcon(
      button("", () => {
        sheet(
          "Add a caption sticker",
          box(
            "reactions",
            ...["❤️", "✨", "🌿", "🎉", "🔥"].map((s) =>
              button(s, () => {
                caption.value = (caption.value + s).slice(0, 220);
                caption.oninput();
                $("#socialDialog").close();
              }),
            ),
          ),
        );
      }),
      "smile",
      "Add caption sticker",
    ),
  );
  const download = n("input");
  download.type = "checkbox";
  const downloadLabel = n("label");
  downloadLabel.append("Download original media after sharing ", download);
  center.append(tools, stage);
  details.append(
    n("label", "", "Caption"),
    caption,
    n("label", "", "Audience"),
    aud,
    friends,
    lab,
    downloadLabel,
    n(
      "p",
      "subtle",
      "Tip: Add a caption for context. Your story expires after 24 hours.",
    ),
    button(
      "Share to Story",
      async () => {
        if (sharing) return;
        sharing = true;
        try {
          let data;
          if (file)
            data = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result.split(",")[1]);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
          const r = await api("/stories", {
            template,
            file: data,
            caption: caption.value,
            audience: aud.value,
            friends: [...checked],
            replies: reply.checked,
          });
          if (download.checked) {
            const link = a(url || asset(template), "");
            link.download = file?.name || template + ".webp";
            document.body.append(link);
            link.click();
            link.remove();
          }
          location.replace("/stories?id=" + r.id);
        } finally {
          sharing = false;
        }
      },
      "gradient",
    ),
    a("/stories", "View active stories"),
    status,
  );
  preview();
}
