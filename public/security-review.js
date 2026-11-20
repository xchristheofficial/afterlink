import { $, a, api, box, button, input, n, sheet } from "./social-ui.js";

function checkedField(label, id, max) {
  const control = input(label, max),
    caption = n("label", "", label),
    issue = n("small", "security-issue");
  control.id = id;
  caption.htmlFor = id;
  issue.id = id + "-error";
  function clear() {
    issue.textContent = "";
    control.removeAttribute("aria-invalid");
    control.removeAttribute("aria-describedby");
  }
  control.addEventListener("input", clear);
  return {
    control,
    root: box("security-field", caption, control, issue),
    reject(message) {
      issue.textContent = message;
      control.setAttribute("aria-invalid", "true");
      control.setAttribute("aria-describedby", issue.id);
      control.focus();
    },
  };
}
function feedback() {
  const el = n("p", "security-issue");
  el.setAttribute("role", "alert");
  return el;
}
export function changePassword() {
  const current = checkedField("Current password", "security-current", 128),
    next = checkedField(
      "New password (12–128 characters)",
      "security-next",
      128,
    ),
    note = feedback();
  current.control.type = next.control.type = "password";
  current.control.autocomplete = "current-password";
  next.control.autocomplete = "new-password";
  sheet(
    "Change password",
    current.root,
    next.root,
    note,
    button(
      "Save password",
      async () => {
        note.textContent = "";
        if (!current.control.value)
          return current.reject("Enter your current password.");
        if (next.control.value.length < 12)
          return next.reject("Use 12–128 characters for your new password.");
        try {
          await api("/security/password", {
            current: current.control.value,
            password: next.control.value,
          });
          location.reload();
        } catch (e) {
          if (!current.control.isConnected || !$("#socialDialog").open) return;
          if (
            e.status === 403 &&
            e.message === "Current password did not match."
          )
            current.reject(e.message);
          else note.textContent = e.message;
        }
      },
      "gradient",
    ),
  );
  $("#socialDialog").addEventListener(
    "close",
    () => {
      current.control.value = next.control.value = "";
    },
    { once: true },
  );
  current.control.focus();
}
export function reviewDeletion() {
  const cancel = () => $("#socialDialog").close();
  const stay = button("Keep my account", cancel);
  sheet(
    "Review your groups before deleting",
    n(
      "p",
      "",
      "Deleting your account removes your group memberships and the group messages you sent.",
    ),
    n(
      "p",
      "",
      "If you manage a group, the earliest-joined remaining member becomes admin. If you are the last joined member, the group closes, even if invitations are pending.",
    ),
    n(
      "p",
      "",
      "To choose who takes over, open the group’s member list and choose Make admin before deleting your account.",
    ),
    a("/groups", "Review my groups"),
    stay,
    button("Continue to confirmation", confirmDeletion),
  );
  stay.focus();
}
function confirmDeletion() {
  const code = checkedField("Type DELETE to confirm", "security-delete"),
    note = feedback();
  code.control.autocomplete = "off";
  code.control.spellcheck = false;
  sheet(
    "Delete account permanently?",
    n("p", "", "This cannot be undone."),
    code.root,
    note,
    button("Keep my account", () => $("#socialDialog").close()),
    button(
      "Delete permanently",
      async () => {
        note.textContent = "";
        if (code.control.value !== "DELETE")
          return code.reject("Enter DELETE exactly, in uppercase.");
        try {
          await api("/delete-account", { confirmation: code.control.value });
          location.replace("/");
        } catch (e) {
          note.textContent = e.message;
        }
      },
      "danger",
    ),
  );
  code.control.focus();
}
