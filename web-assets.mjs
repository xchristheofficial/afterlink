import compression from "compression";
import express from "express";

// Mount after authenticated pages and API/SSE handlers. Only static files get
// compression; private responses retain their original cache and stream policy.
export function publicAssets(directory) {
  const router = express.Router();
  router.use(
    compression({
      filter: (req, res) => !req.headers.range && compression.filter(req, res),
    }),
  );
  router.use(express.static(directory));
  return router;
}

// Keep the public shell usable as plain static HTML. Only authenticated
// member routes need these classic scripts; preserve their dependency order.
export function memberAssets(html, pathname) {
  const profile = /^\/profile(?:\/|$)/.test(pathname);
  const edit = /^\/profile\/edit\/?$/.test(pathname);
  const scripts = [
    "navigation",
    "composer",
    ...(edit ? ["editor"] : []),
    ...(profile ? ["profile"] : []),
    "feed",
  ];
  const styles = ["notes", "editor", "composer"];
  return html
    .replace(
      "<!-- member-styles -->",
      styles
        .map((s) => `<link rel="stylesheet" href="/${s}.css" />`)
        .join("\n"),
    )
    .replace(
      "<!-- member-scripts -->",
      scripts.map((s) => `<script defer src="/${s}.js"></script>`).join("\n"),
    );
}
