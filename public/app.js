const $ = (id) => document.getElementById(id);
let mode = "signin",
  step = 1,
  busy = false;
const messages = {
  Privacy:
    "AfterLink stores your email, an optional phone number, and a salted password hash for password accounts. Google accounts use a Google account identifier. An HTTP-only cookie keeps you signed in for up to seven days. Signing out revokes that session.",
  Terms:
    "Use an account you control and keep your sign-in details private. Do not impersonate someone else or access another person’s account.",
  Help: "Choose Create Account, enter an email and optionally a phone number, then choose a password. To sign in, use the same email and password. You can leave Phone blank. Google sign-in requires Kodra to enable its Google connection.",
  More: "AfterLink is a product of Kodra. Connect After. Link Forever. The colorful panel is a design illustration, not a live feed.",
};
function info(title, text) {
  $("dialogTitle").textContent = title;
  $("dialogText").textContent = text;
  $("dialog").showModal();
}
function error(text = "") {
  $("error").textContent = text;
  $("error").hidden = !text;
}
for (const b of document.querySelectorAll("[data-info]"))
  b.onclick = () => info(b.dataset.info, messages[b.dataset.info]);
function update() {
  const second = step === 2;
  $("identity").hidden = second;
  $("secret").hidden = !second;
  $("password").disabled = !second;
  $("password").required = second;
  $("email").disabled = second;
  $("phone").disabled = second;
  for (const m of ["signin", "signup"])
    $(m).setAttribute("aria-pressed", String(mode === m));
  $("password").autocomplete =
    mode === "signup" ? "new-password" : "current-password";
  $("password").minLength = mode === "signup" ? 12 : 1;
  $("hint").textContent =
    mode === "signup"
      ? "Use at least 12 characters."
      : "Enter your AfterLink password.";
  $("summary").textContent = $("email").value.trim();
  $("submit").textContent = second
    ? mode === "signup"
      ? "Create Account"
      : "Sign In"
    : "Continue";
  error();
}
for (const m of ["signin", "signup"])
  $(m).onclick = () => {
    if (busy) return;
    mode = m;
    step = 1;
    $("password").value = "";
    update();
  };
$("back").onclick = () => {
  if (busy) return;
  step = 1;
  update();
  $("email").focus();
};
async function post(path, data) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-AfterLink-Request": "1" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw Error(json.error || "Please try again.");
  return json;
}
function account(user) {
  $("auth").hidden = !!user;
  $("account").hidden = !user;
  $("accountEmail").textContent = user?.email || "";
  if (user) {
    $("form").reset();
    step = 1;
    update();
  }
}
$("form").onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;
  error();
  if (step === 1) {
    const phone = $("phone").value.replace(/[ ()-]/g, "");
    if (phone && !/^\+?[0-9]{7,15}$/.test(phone)) {
      error("Enter a valid phone number or leave it blank.");
      $("phone").focus();
      return;
    }
    step = 2;
    update();
    $("password").focus();
    return;
  }
  busy = true;
  $("submit").disabled = true;
  try {
    const { user } = await post("/api/" + mode, {
      email: $("email").value,
      phone: $("phone").value,
      password: $("password").value,
    });
    account(user);
  } catch (e) {
    error(e.message);
  } finally {
    busy = false;
    $("submit").disabled = false;
  }
};
$("logout").onclick = async () => {
  try {
    await post("/api/logout", {});
    mode = "signin";
    step = 1;
    update();
    account(null);
  } catch {
    info("Sign out", "Could not reach AfterLink. Please try again.");
  }
};
$("google").onclick = async () => {
  try {
    const { google } = await (await fetch("/api/providers")).json();
    if (google) location.assign("/auth/google");
    else
      info(
        "Google sign-in",
        "Google sign-in hasn’t been connected by Kodra yet. You can use your email and password instead.",
      );
  } catch {
    info("Connection issue", "Please try again when you are online.");
  }
};
const auth = new URLSearchParams(location.search).get("auth");
if (auth) {
  error(
    auth === "existing"
      ? "That email already has an account. Sign in with your password."
      : auth === "unavailable"
        ? "Google sign-in is not configured."
        : "Google sign-in was not completed. Please try again.",
  );
  history.replaceState(null, "", "/");
}
fetch("/api/session")
  .then((r) => r.json())
  .then(({ user }) => {
    if (user) account(user);
  })
  .catch(() => error("Could not reach AfterLink. Please refresh to retry."));
