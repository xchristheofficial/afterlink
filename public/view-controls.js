import { n, box } from "./social-ui.js";
export function choice(label, pairs, change) {
  const field = n("select"),
    root = n("label", "view-choice", label);
  field.setAttribute("aria-label", label);
  for (const [value, text] of pairs) field.add(new Option(text, value));
  root.append(field);
  field.onchange = change;
  return { field, root };
}
export function check(label, change) {
  const field = n("input"),
    root = n("label", "view-check");
  field.type = "checkbox";
  root.append(field, label);
  field.onchange = change;
  return { field, root };
}
export function toolbox(label, ...controls) {
  const el = n("details", "view-toolbox");
  el.append(n("summary", "", label), box("view-controls", ...controls));
  return el;
}
