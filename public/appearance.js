(() => {
  const scheme = matchMedia("(prefers-color-scheme:dark)"),
    motion = matchMedia("(prefers-reduced-motion:reduce)");
  let prefs = {};
  function paint() {
    const r = document.documentElement;
    r.dataset.color =
      prefs.theme === "dark" || (prefs.theme === "system" && scheme.matches)
        ? "dark"
        : "light";
    r.dataset.accent = prefs.accent || "purple";
    r.dataset.motion = prefs.reduce || motion.matches ? "reduce" : "full";
  }
  try {
    prefs = JSON.parse(localStorage.getItem("afterlink.appearance")) || {};
  } catch {}
  paint();
  // A saved change should also update already-open tabs without a reload.
  addEventListener("storage", (event) => {
    if (event.key !== "afterlink.appearance") return;
    try {
      prefs = JSON.parse(event.newValue) || {};
      paint();
    } catch {}
  });
  scheme.addEventListener("change", paint);
  motion.addEventListener("change", paint);
  window.applyAppearance = (p) => {
    prefs = Object.fromEntries(
      ["theme", "accent", "reduce", "autoplay", "autoReels"].map((k) => [
        k,
        p[k],
      ]),
    );
    try {
      localStorage.setItem("afterlink.appearance", JSON.stringify(prefs));
    } catch {}
    paint();
  };
  if (location.pathname !== "/")
    fetch("/api/feed/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && window.applyAppearance(d.prefs))
      .catch(() => {});
  const observer = new IntersectionObserver(
    (entries) => {
      for (const { target: v, isIntersecting } of entries) {
        if (
          document.documentElement.dataset.motion === "reduce" ||
          !(v.closest(".player") ? prefs.autoReels : prefs.autoplay)
        )
          continue;
        if (isIntersecting) {
          v.muted = true;
          v.play().catch(() => {});
        } else v.pause();
      }
    },
    { threshold: 0.65 },
  );
  document.addEventListener(
    "loadedmetadata",
    (e) => {
      if (e.target.matches?.(".player video,.published-gallery video"))
        observer.observe(e.target);
    },
    true,
  );
})();
