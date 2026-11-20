import { api, avatar, box, n } from "./social-ui.js";
export async function notes(host) {
  const rail = box("notes-rail");
  rail.setAttribute("aria-label", "Member notes");
  host.replaceChildren(rail);
  async function load() {
    const { mine, notes } = await api("/notes");
    rail.replaceChildren();
    for (const p of notes) {
      const own = p.id === mine,
        b = n("button", "note-person");
      b.type = "button";
      b.title = p.body || "Leave a note";
      b.onclick = () => (own ? edit(p.body || "") : view(p));
      const face = avatar(p.id);
      face.loading = "lazy";
      face.decoding = "async";
      b.append(
        box("note-cloud", n("span", "note-bubble", p.body || "Leave a note…")),
        face,
        n("span", "note-name", own ? "Your note" : p.name),
      );
      rail.append(b);
    }
  }
  function view(p) {
    const d = n("dialog", "note-editor"),
      chat = n("a", "", "Message " + p.name),
      dismiss = n("button", "", "Close");
    d.setAttribute("aria-label", p.name + "’s note");
    chat.href = "/messages/" + p.id;
    dismiss.onclick = () => d.close();
    d.append(
      n("h2", "", p.name + "’s note"),
      n("p", "", p.body),
      box("note-buttons", chat, dismiss),
    );
    d.onclose = () => d.remove();
    document.body.append(d);
    d.showModal();
  }
  function edit(value) {
    const d = n("dialog", "note-editor"),
      field = n("textarea"),
      status = n("p");
    d.setAttribute("aria-label", "Your note");
    field.maxLength = 80;
    field.value = value;
    field.setAttribute("aria-label", "Note text");
    const save = n("button", "gradient", "Save note"),
      remove = n("button", "", "Remove note"),
      cancel = n("button", "", "Cancel");
    async function submit(body) {
      save.disabled = remove.disabled = true;
      try {
        await api("/notes", { body });
        d.close();
        await load();
      } catch (e) {
        status.textContent = e.message;
      } finally {
        save.disabled = remove.disabled = false;
      }
    }
    save.onclick = () => submit(field.value);
    remove.onclick = () => submit("");
    cancel.onclick = () => d.close();
    d.append(
      n("h2", "", "Your note"),
      n("p", "", "Followers can see this until you change or remove it."),
      field,
      status,
      box("note-buttons", save, ...(value ? [remove] : []), cancel),
    );
    d.onclose = () => d.remove();
    document.body.append(d);
    d.showModal();
    field.focus();
  }
  await load();
}
