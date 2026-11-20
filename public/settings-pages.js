import { choice, check, toolbox } from "./view-controls.js";
import {
  $,
  a,
  api,
  avatar,
  box,
  button,
  empty,
  error,
  follow,
  icon,
  input,
  n,
  profile,
  sheet,
  tabs,
} from "./social-ui.js";
const labels = {
  privacy: "Privacy & Safety",
  appearance: "Appearance",
  notifications: "Notification Preferences",
  security: "Account & Security",
};
export function panel(root, title, back = "/settings") {
  const card = box("pref-card"),
    head = box("pref-heading");
  if (back) {
    const b = a(back, "", "back-control");
    b.append(icon("back"));
    b.setAttribute("aria-label", "Back");
    head.append(b);
  }
  head.append(n("h1", "", title));
  card.append(head);
  root.append(card);
  return card;
}
const copy = (title, desc = "") =>
  box(
    "pref-copy",
    n("strong", "", title),
    ...(desc ? [n("small", "", desc)] : []),
  );
// Local-only filters: do not send private search terms to the server or URL.
function localFilter(label, onChange) {
  const field = input(label);
  field.type = "search";
  const clear = n("button", "", "Clear search");
  clear.type = "button";
  clear.hidden = true;
  field.oninput = () => {
    clear.hidden = !field.value;
    onChange();
  };
  clear.onclick = () => {
    field.value = "";
    field.oninput();
    field.focus();
  };
  return { field, bar: box("local-filter", field, clear) };
}
function keywordMatch(query) {
  const fold = (text) => text.normalize("NFKC").toLowerCase();
  const words = fold(query).trim().split(/\s+/);
  return (text) => {
    const haystack = fold(text);
    return words.every((word) => haystack.includes(word));
  };
}
function row(title, desc, control, key) {
  return box(
    "pref-row",
    ...(key ? [box("tile-icon", icon(key))] : []),
    copy(title, desc),
    control,
  );
}
function toggle(value, title, onChange) {
  const e = n("input", "pref-toggle");
  e.type = "checkbox";
  e.checked = value;
  e.setAttribute("role", "switch");
  e.setAttribute("aria-label", title);
  e.onchange = async () => {
    e.disabled = true;
    try {
      await onChange(e.checked);
    } catch (err) {
      e.checked = !e.checked;
      error(err);
    } finally {
      e.disabled = false;
    }
  };
  return e;
}
const linkRow = (title, desc, key, url) => {
  const e = a(url, "", "pref-link");
  e.append(box("tile-icon", icon(key)), copy(title, desc), icon("next"));
  return e;
};
function menu(root) {
  const aside = n("aside", "settings-rail"),
    main = box("settings-directory"),
    search = input("Search settings…");
  aside.append(n("small", "eyebrow", "MENU"));
  for (const [t, k, url] of [
    ["Home", "home", "/home"],
    ["Chat", "messages", "/messages"],
    ["Saved", "save", "/saved"],
    ["Settings", "settings", "/settings"],
    ["People", "explore", "/search"],
  ]) {
    const l = a(url, "");
    l.append(icon(k), t);
    aside.append(l);
  }
  root.append(aside, main);
  main.append(n("h1", "", "Settings"), search);
  const groups = [
    [
      "Account",
      [
        [
          "Edit Profile",
          "Update your name, profile photo, and bio",
          "user",
          "/profile/edit",
        ],
        [
          "Account & Security",
          "Password, sign-in sessions, and account access",
          "shield",
          "/settings/security",
        ],
      ],
    ],
    [
      "Privacy",
      [
        [
          "Privacy & Safety",
          "Control who can contact you and see your stories",
          "lock",
          "/settings/privacy",
        ],
        [
          "Blocked Accounts",
          "Manage blocked and muted members",
          "block",
          "/settings/privacy#blocked",
        ],
      ],
    ],
    [
      "Notifications",
      [
        [
          "Notification Preferences",
          "Choose which activity appears in your notifications",
          "notifications",
          "/settings/notifications",
        ],
      ],
    ],
    [
      "Appearance",
      [
        [
          "Appearance",
          "Theme, accent color, motion, and video playback",
          "palette",
          "/settings/appearance",
        ],
      ],
    ],
    [
      "Library",
      [
        [
          "Saved Posts",
          "Your private posts, reels, and collections",
          "save",
          "/saved",
        ],
        [
          "Followers & Following",
          "Search your connections",
          "user",
          "/connections",
        ],
      ],
    ],
  ];
  const results = box("menu-results");
  main.append(results);
  function draw() {
    results.replaceChildren();
    for (const [h, items] of groups) {
      const found = items.filter((r) =>
        (h + r.join(" ")).toLowerCase().includes(search.value.toLowerCase()),
      );
      if (found.length)
        results.append(
          n("h2", "eyebrow", h),
          ...found.map((r) => linkRow(...r)),
        );
    }
    if (!results.childElementCount)
      results.append(
        empty("No matching settings", "Try “privacy” or “appearance”."),
      );
  }
  search.oninput = draw;
  draw();
}
export async function settings(root, section) {
  if (!section) {
    menu(root);
    return;
  }
  if (!labels[section]) throw Error("Settings page not found.");
  const card = panel(root, labels[section]),
    { prefs, private: priv, restricted, id: memberId } = await api("/settings");
  const note = n("p", "pref-status");
  note.setAttribute("role", "status");
  const save = async (b) => {
    const r = await api("/settings", b);
    note.textContent = "Changes saved.";
    return r;
  };
  if (section === "privacy") {
    function choose(title, items, key, value) {
      const names = Object.keys(items),
        bar = box("segments");
      for (const label of names) {
        const b = button(label, async () => {
          if (items[label] === value) return;
          for (const c of bar.children) c.disabled = true;
          try {
            if (key === "private" && !items[label] && value) {
              const { confirmPublicProfile } =
                await import("./privacy-review.js");
              if (!(await confirmPublicProfile())) return;
            }
            await save({ [key]: items[label] });
            value = items[label];
            for (const c of bar.children)
              c.setAttribute("aria-pressed", String(c === b));
          } finally {
            for (const c of bar.children) c.disabled = false;
            b.focus();
          }
        });
        b.setAttribute("aria-pressed", String(items[label] === value));
        bar.append(b);
      }
      card.append(n("h2", "", title), bar);
    }
    choose(
      "Account Visibility",
      { Public: false, Private: true },
      "private",
      priv,
    );
    card.append(
      n(
        "small",
        "subtle",
        "Private accounts limit posts to existing followers and pause new follows.",
      ),
    );
    choose(
      "Who Can Message You",
      { Everyone: "everyone", "Followers Only": "followers", "No One": "none" },
      "messages",
      prefs.messages,
    );
    choose(
      "Who Can Mention You",
      { Everyone: "everyone", "Followers Only": "followers" },
      "mentions",
      prefs.mentions,
    );
    choose(
      "Who Can See Your Stories",
      { Everyone: "everyone", "Followers Only": "followers" },
      "stories",
      prefs.stories,
    );
    const area = box("restricted");
    const filter = localFilter("Search blocked or muted accounts", draw);
    const restrictedSection = box(
      "",
      n("h2", "", "Blocked & Muted Accounts"),
      filter.bar,
      area,
    );
    restrictedSection.id = "blocked";
    card.append(restrictedSection);
    function draw() {
      area.replaceChildren();
      if (!restricted.length)
        area.append(n("p", "subtle", "No blocked or muted accounts."));
      const matches = keywordMatch(filter.field.value);
      const results = restricted.filter((p) =>
        matches(p.name + " " + (p.kind === "block" ? "Blocked" : "Muted")),
      );
      if (restricted.length && !results.length)
        area.append(n("p", "subtle", "No matching accounts."));
      results.forEach((p) =>
        area.append(
          row(
            p.name,
            p.kind === "block" ? "Blocked" : "Muted",
            button(p.kind === "block" ? "Unblock" : "Unmute", async () => {
              await api("/restrict", { id: p.id, kind: p.kind, on: false });
              restricted.splice(restricted.indexOf(p), 1);
              draw();
            }),
          ),
        ),
      );
    }
    draw();
    card.append(
      row(
        "Typing indicators",
        "Show when you are typing to chat partners who also share typing indicators.",
        toggle(prefs.typing, "Typing indicators", (v) => save({ typing: v })),
      ),
      row(
        "Show Activity Status",
        "Show recent activity to members who also share their status.",
        toggle(prefs.activity, "Show Activity Status", (v) =>
          save({ activity: v }),
        ),
      ),
    );
    card.append(
      row(
        "Allow Post Downloads",
        "Offer a download button on public posts. This cannot prevent screen capture.",
        toggle(prefs.downloads, "Allow Post Downloads", (v) =>
          save({ downloads: v }),
        ),
      ),
    );
    card.append(
      row(
        "Download your settings",
        "Save your current privacy, appearance, and notification preferences as JSON. The file excludes contact details, blocked accounts, messages, and sign-in information.",
        button("Download settings", async () => {
          const { downloadPreferences } = await import("./settings-export.js");
          // Recheck the session at click time; never export stale page data.
          downloadPreferences(await api("/settings"), memberId);
          note.textContent = "Settings download started.";
        }),
      ),
    );
    if (location.hash === "#blocked") restrictedSection.scrollIntoView();
  }
  if (section === "notifications") {
    card.append(n("p", "subtle", "Choose what you get notified about."));
    const data = {};
    for (const [k, t, d] of [
      ["follow", "Follows", "Someone follows you"],
      ["mention", "Mentions", "Someone mentions your username"],
      ["comment", "Comments", "Comments on your posts and replies"],
      ["like", "Likes", "Someone likes your post"],
      ["message", "Messages", "A member sends you a message"],
      ["reel", "Reels", "A member you follow posts a video"],
    ]) {
      data[k] = prefs[k];
      card.append(
        row(
          t,
          d,
          toggle(data[k], t, (v) => (data[k] = v)),
        ),
      );
    }
    card.append(
      row(
        "Email & push notifications",
        "Delivery is not configured. These preferences apply in AfterLink.",
        n("small", "", "Unavailable"),
      ),
      button("Save Preferences", () => save(data), "gradient wide"),
    );
  }
  if (section === "appearance") {
    const data = {
      theme: prefs.theme,
      accent: prefs.accent,
      reduce: prefs.reduce,
      autoplay: prefs.autoplay,
      autoReels: prefs.autoReels,
    };
    card.append(
      n("h2", "", "Theme"),
      n("p", "subtle", "Choose how AfterLink appears to you."),
    );
    const tiles = box("theme-tiles");
    for (const t of ["light", "dark", "system"]) {
      const b = button(t, () => {
        data.theme = t;
        for (const c of tiles.children)
          c.setAttribute("aria-pressed", String(c === b));
      });
      b.prepend(
        box("theme-preview " + t, box("mini-window", n("i"), n("i"), n("i"))),
      );
      b.setAttribute("aria-pressed", String(data.theme === t));
      tiles.append(b);
    }
    card.append(tiles, n("h2", "", "Accent Color"));
    const colors = box("swatches");
    for (const c of ["blue", "green", "purple", "orange", "rose"]) {
      const b = button(
        "",
        () => {
          data.accent = c;
          for (const x of colors.children)
            x.setAttribute("aria-pressed", String(x === b));
        },
        "swatch " + c,
      );
      b.setAttribute("aria-label", c);
      b.setAttribute("aria-pressed", String(data.accent === c));
      colors.append(b);
    }
    card.append(colors, n("h2", "", "Motion Preferences"));
    for (const [key, t, d] of [
      [
        "reduce",
        "Reduce Motion",
        "Minimize transitions. Device reduced-motion preferences always take priority.",
      ],
      ["autoplay", "Auto-play Videos", "Play visible feed videos muted."],
      ["autoReels", "Auto-play Reels", "Start the selected reel muted."],
    ])
      card.append(
        row(
          t,
          d,
          toggle(data[key], t, (v) => (data[key] = v)),
        ),
      );
    card.append(
      button(
        "Save Appearance",
        async () => {
          await save(data);
          window.applyAppearance(data);
        },
        "gradient wide",
      ),
    );
  }
  if (section === "security") {
    const { user, devices, factor, factorAvailable, changed } =
      await api("/security");
    card.append(
      n("h2", "", "Password"),
      row(
        "Change Password",
        user.password
          ? changed
            ? "Last changed: " + new Date(changed).toLocaleDateString()
            : "Confirm your current password to change it."
          : "Managed by your sign-in provider.",
        user.password
          ? button("Change", async () =>
              (await import("./security-review.js")).changePassword(),
            )
          : n("small", "", "Provider"),
      ),
      n("h2", "", "Two-Factor"),
      row(
        "Authenticator App",
        factor
          ? "An authenticator code is required at sign-in."
          : factorAvailable
            ? "Use a time-based authenticator to secure your account."
            : "Setup requires a configured encryption key and password sign-in.",
        factorAvailable
          ? button(factor ? "Disable" : "Set up", () => {
              const pass = input("Current password", 128);
              pass.type = "password";
              const code = input("Authenticator or recovery code", 20);
              sheet(
                "Authenticator app",
                pass,
                ...(factor ? [code] : []),
                button(
                  factor ? "Disable two-factor" : "Start setup",
                  async () => {
                    if (factor) {
                      await api("/security/factor/disable", {
                        password: pass.value,
                        code: code.value,
                      });
                      location.reload();
                      return;
                    }
                    const { key } = await api("/security/factor/setup", {
                      password: pass.value,
                    });
                    const setup = input("Manual setup key");
                    setup.value = key;
                    setup.readOnly = true;
                    sheet(
                      "Add AfterLink in your authenticator",
                      n(
                        "p",
                        "",
                        "Enter this manual key in your app, then enter the six-digit code below. Setup expires in 10 minutes.",
                      ),
                      setup,
                      code,
                      button("Verify and enable", async () => {
                        const { codes } = await api("/security/factor/enable", {
                          code: code.value,
                        });
                        sheet(
                          "Save your recovery codes",
                          n(
                            "p",
                            "",
                            "Store these one-time codes safely. They will not be shown again.",
                          ),
                          n("pre", "", codes.join("\n")),
                          button("Done", () => location.reload()),
                        );
                      }),
                    );
                  },
                ),
              );
            })
          : n("small", "", factor ? "On" : "Off"),
      ),
      n("h2", "", "Signed-in Devices"),
    );
    for (const d of devices)
      card.append(
        row(
          (d.current ? "This device" : "Other device") +
            (d.label ? " · " + d.label : ""),
          "Expires " + new Date(d.expires).toLocaleDateString(),
          n("small", "", d.current ? "Active now" : ""),
        ),
      );
    card.append(
      button("Sign out of all other devices", async () => {
        await api("/security/logout-others", {});
        location.reload();
      }),
      n("h2", "", "Email"),
      row(
        user.email,
        "",
        n("small", "", user.verified ? "Verified by Google" : "Not verified"),
      ),
      n("h2", "danger", "Danger Zone"),
    );
    card.append(
      box(
        "danger-zone",
        n("p", "", "Deleting your account permanently removes its data."),
        button("Sign Out", async () => {
          const r = await fetch("/api/logout", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-AfterLink-Request": "1",
            },
            body: "{}",
          });
          if (r.ok) location.replace("/");
        }),
        button(
          "Delete Account",
          async () => (await import("./security-review.js")).reviewDeletion(),
          "danger",
        ),
      ),
    );
  }
  card.append(note);
}
export async function connections(root) {
  const params = new URLSearchParams(location.search),
    d = await api(
      "/connections" +
        (params.has("id") ? "?id=" + encodeURIComponent(params.get("id")) : ""),
    ),
    card = panel(root, d.member.name, "/profile/" + d.member.id),
    filter = input("Search connections…"),
    list = box("connection-list");
  let tab = params.get("tab") === "following" ? "Following" : "Followers";
  function draw() {
    list.replaceChildren();
    for (const p of d[tab].filter((p) =>
      (p.name + " " + (p.username || ""))
        .toLowerCase()
        .includes(filter.value.toLowerCase()),
    )) {
      list.append(
        box(
          "member-line",
          avatar(p.id),
          profile(p),
          ...(p.id !== d.uid ? [follow(p)] : []),
        ),
      );
    }
    if (!list.childElementCount)
      list.append(
        empty(
          filter.value ? "No matches" : "No " + tab.toLowerCase() + " yet",
          filter.value
            ? "Try a different name."
            : "Connections will appear here.",
          a("/search", "Explore People", "gradient"),
        ),
      );
  }
  const names = ["Followers", "Following"].map((k) => k + " " + d[k].length);
  card.append(
    tabs(names, names[tab === "Following" ? 1 : 0], (v) => {
      tab = v.split(" ")[0];
      draw();
    }),
    filter,
    list,
  );
  filter.oninput = draw;
  draw();
}
export async function library(root) {
  const card = panel(root, "Saved", "/home"),
    search = localFilter("Search saved posts…", drawPosts),
    list = box("library-grid"),
    cols = box("library-grid");
  let d = await api("/library"),
    tab = "All Saved",
    collection = null;
  const title = n("h2", "", "Collections");
  const unfiled = check("Not in a collection", drawPosts),
    type = choice(
      "Attachment type",
      [
        ["any", "Any attachment or text"],
        ["image/", "Has photos"],
        ["video/", "Has video"],
        ["text", "Text only"],
      ],
      drawPosts,
    ),
    order = choice(
      "Sort saved posts",
      [
        ["recent", "Recently saved"],
        ["old", "Oldest saved"],
        ["author", "Author A–Z"],
      ],
      drawPosts,
    ),
    lite = check("Hide media previews", drawPosts),
    colSearch = localFilter("Find collections by name", draw);
  const create = button("New Collection", () => {
    const field = input("Collection name", 50);
    sheet(
      "New collection",
      field,
      button(
        "Create",
        async () => {
          await api("/collection", { name: field.value });
          d = await api("/library");
          $("#socialDialog").close();
          draw();
        },
        "gradient",
      ),
    );
  });
  card.append(
    n("p", "subtle", "Only you can see your saved posts."),
    search.bar,
    tabs(["All Saved", "Posts", "Reels", "Collections"], tab, (t) => {
      tab = t;
      collection = null;
      draw();
    }),
    toolbox(
      "Saved library tools",
      unfiled.root,
      type.root,
      order.root,
      lite.root,
    ),
    box("list-heading", title, create),
    colSearch.bar,
    cols,
    list,
  );
  function draw() {
    cols.replaceChildren();
    cols.hidden = !["All Saved", "Collections"].includes(tab);
    title.textContent = collection
      ? d.collections.find((c) => c.id === collection)?.name
      : "Collections";
    colSearch.bar.hidden = cols.hidden;
    for (const c of d.collections.filter((c) =>
      keywordMatch(colSearch.field.value)(c.name),
    )) {
      const b = button(
        "",
        () => {
          collection = collection === c.id ? null : c.id;
          draw();
        },
        "collection-tile",
      );
      b.setAttribute("aria-pressed", String(collection === c.id));
      b.append(
        icon("save"),
        copy(
          c.name,
          d.links.filter((x) => x.collection === c.id).length + " items",
        ),
      );
      cols.append(b);
    }
    const label = collection
      ? `Search in ${title.textContent}`
      : "Search saved posts…";
    search.field.setAttribute("aria-label", label);
    search.field.placeholder = label;
    drawPosts();
  }
  function drawPosts() {
    list.replaceChildren();
    const matches = keywordMatch(search.field.value);
    const members = collection
      ? new Set(
          d.links.filter((x) => x.collection === collection).map((x) => x.post),
        )
      : null;
    const sorted = [...d.posts],
      filed = new Set(d.links.map((l) => l.post));
    if (order.field.value === "old") sorted.reverse();
    if (order.field.value === "author")
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    for (const p of sorted) {
      if (unfiled.field.checked && filed.has(p.id)) continue;
      if (
        type.field.value !== "any" &&
        (type.field.value === "text"
          ? p.media.length
          : !p.media.some((m) => m.type.startsWith(type.field.value)))
      )
        continue;
      const reel = p.media.some((m) => m.type.startsWith("video/"));
      if (
        (tab === "Posts" && reel) ||
        (tab === "Reels" && !reel) ||
        (tab === "Collections" && !collection) ||
        (members && !members.has(p.id)) ||
        !matches(p.body + " " + p.name)
      )
        continue;
      const link = a("/post/" + p.id, "");
      if (p.media[0] && !lite.field.checked) {
        const e = n(p.media[0].type.startsWith("video/") ? "video" : "img");
        e.src = "/api/feed/media/" + p.media[0].id;
        e.setAttribute("aria-label", "Saved media");
        link.append(e);
      }
      link.append(n("strong", "", p.body || "Post by " + p.name));
      list.append(
        box(
          "library-item",
          link,
          a("/profile/" + p.author, p.name, "saved-author"),
          button("Collections", () => {
            const choices = d.collections.map((c) => {
              const on = d.links.some(
                (x) => x.collection === c.id && x.post === p.id,
              );
              return button(
                (on ? "Remove from " : "Add to ") + c.name,
                async () => {
                  await api("/collection", { id: c.id, post: p.id, on: !on });
                  d = await api("/library");
                  $("#socialDialog").close();
                  draw();
                },
              );
            });
            sheet(
              "Organize saved post",
              ...(choices.length
                ? choices
                : [n("p", "", "Create a collection first.")]),
            );
          }),
          button("Unsave", async () => {
            await api("/save", { id: p.id, on: false });
            d = await api("/library");
            draw();
          }),
        ),
      );
    }
    if (!list.childElementCount)
      list.append(
        n(
          "p",
          "subtle",
          tab === "Collections" && !collection
            ? "Select a collection to open it."
            : search.field.value.trim()
              ? "No saved items match those keywords."
              : "No saved items here yet.",
        ),
      );
  }
  draw();
}
export async function safety(root) {
  const q = new URLSearchParams(location.search),
    id = Number(q.get("id")),
    post = Number(q.get("post")) || null,
    { profile: p, own } = await api("/profile?id=" + id);
  if (own) throw Error("Choose another member.");
  const card = panel(
      root,
      "Report or Block",
      post ? "/post/" + post : "/profile/" + id,
    ),
    reason = n("fieldset"),
    note = n("p", "pref-status");
  reason.append(n("legend", "", "Select a reason to report:"));
  for (const t of [
    "Spam",
    "Harassment",
    "Inappropriate Content",
    "Misinformation",
  ]) {
    const x = n("input");
    x.type = "radio";
    x.name = "reason";
    x.value = t;
    x.checked = t === "Spam";
    const l = n("label");
    l.append(x, t);
    reason.append(l);
  }
  card.append(
    row(
      "Report Content",
      "Report " + p.name,
      button("Select", () => reason.querySelector("input").focus()),
      "flag",
    ),
    row(
      "Block " + p.name,
      "Hide their posts, prevent direct messages, and leave shared Linkbacks.",
      button(
        "Block",
        async () => {
          if (!confirm("Block " + p.name + "?")) return;
          await api("/restrict", { id, kind: "block", on: true });
          location.replace("/settings/privacy#blocked");
        },
        "danger",
      ),
      "block",
    ),
    row(
      "Mute",
      "Hide posts from your feed and discovery.",
      button("Mute", async () => {
        await api("/restrict", { id, kind: "mute", on: true });
        note.textContent = "Account muted.";
      }),
      "mute",
    ),
  );
  if (p.isFollowing)
    card.append(
      row(
        "Unfollow",
        "",
        button("Unfollow", async (b) => {
          await api("/follow", { id, on: false });
          b.parentElement.remove();
        }),
        "user",
      ),
    );
  card.append(
    reason,
    button(
      "Submit report",
      async (b) => {
        await api("/report", {
          id,
          post,
          reason: reason.querySelector(":checked").value,
        });
        b.hidden = true;
        note.textContent = "Report recorded. You can also block this member.";
      },
      "gradient wide",
    ),
    note,
  );
}
