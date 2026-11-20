// The change is not submitted until the member explicitly confirms it.
export function confirmPublicProfile() {
  const dialog = document.createElement("dialog");
  const form = document.createElement("form");
  form.method = "dialog";
  const title = document.createElement("h2");
  title.id = "public-review-title";
  title.textContent = "Make your account public?";
  const note = document.createElement("p");
  note.id = "public-review-note";
  note.textContent =
    "Members who don’t follow you will be able to see your existing posts shared with Everyone. Followers-only posts stay followers-only, and blocked members stay blocked.";
  dialog.setAttribute("aria-labelledby", title.id);
  dialog.setAttribute("aria-describedby", note.id);
  const keep = document.createElement("button"),
    publish = document.createElement("button");
  keep.value = "keep";
  keep.textContent = "Keep account private";
  keep.autofocus = true;
  publish.value = "public";
  publish.textContent = "Make public";
  form.className = "visibility-review-actions";
  form.append(keep, publish);
  dialog.append(title, note, form);
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        resolve(dialog.returnValue === "public");
      },
      { once: true },
    );
    dialog.showModal();
  });
}
