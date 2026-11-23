import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(fileURLToPath(new URL(name, root)), "utf8");

// The developer team is Razorbill. A rename is easy to apply to the obvious
// places and miss in a dialog or an email, so every surface is checked here.
test("every member-facing surface credits Razorbill", async () => {
  const surfaces = {
    "public/index.html": await read("public/index.html"),
    "public/app.js": await read("public/app.js"),
    "recovery.mjs": await read("recovery.mjs"),
  };
  for (const [name, text] of Object.entries(surfaces))
    assert.doesNotMatch(text, /Kodra/i, `${name} still names the old team`);

  // Visible on the signed-out card and in Settings, not only in a dialog.
  assert.match(
    surfaces["public/index.html"],
    /<footer class="made-by">Made by Razorbill<\/footer>/,
  );
  assert.match(
    surfaces["public/index.html"],
    /<p class="made-by">Made by Razorbill<\/p>/,
  );
  assert.match(
    surfaces["public/index.html"],
    /content="Sign in to AfterLink, made by Razorbill\."/,
  );
  assert.match(surfaces["public/app.js"], /AfterLink is made by Razorbill\./);
  assert.match(surfaces["recovery.mjs"], /AfterLink by Razorbill/);

  // The credit needs its own style, or it reads as body copy.
  assert.match(await read("public/style.css"), /\.made-by\s*\{/);
});
