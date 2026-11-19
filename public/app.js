const $ = (id) => document.getElementById(id);
let mode = "signin",
  busy = false;
const messages = {
  Privacy:
    "AfterLink stores your email, an optional phone number, and a salted password hash for password accounts. Google accounts use a Google account identifier. An HTTP-only cookie keeps you signed in for up to seven days. Signing out revokes that session.",
  Terms:
    "Use an account you control and keep your sign-in details private. Do not impersonate someone else or access another person’s account.",
  Help: "Choose Sign up and enter your full name, username, email, and a password of at least 12 characters. To sign in, use the same email and password. You can leave Phone blank. Google sign-in requires Kodra to enable its Google connection.",
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
const registration = document.querySelectorAll("[data-registration]");
function showPassword(show) {
  $("password").type = show ? "text" : "password";
  $("reveal").setAttribute("aria-pressed", String(show));
  $("reveal").setAttribute(
    "aria-label",
    show ? "Hide password" : "Show password",
  );
}
function update() {
  const signup = mode === "signup";
  document.querySelector(".inside").dataset.mode = mode;
  for (const field of registration) {
    field.hidden = !signup;
    field.querySelector("input").disabled = !signup;
  }
  $("heading").textContent = $("submit").textContent = signup
    ? "Create Account"
    : "Sign In";
  $("switchPrompt").textContent = signup
    ? "Already have an account?"
    : "Don’t have an account?";
  $("switchMode").textContent = signup ? "Sign In" : "Sign up";
  $("password").autocomplete = signup ? "new-password" : "current-password";
  $("password").placeholder = signup ? "Create a password" : "••••••••••••";
  $("password").minLength = signup ? 12 : 1;
  $("password").value = "";
  showPassword(false);
  $("forgot").hidden = signup;
  error();
}
$("switchMode").onclick = () => {
  if (busy) return;
  mode = mode === "signin" ? "signup" : "signin";
  update();
  document.querySelector(".card").scrollTop = 0;
  $("heading").focus({ preventScroll: true });
};
$("reveal").onclick = () => showPassword($("password").type === "password");
$("forgot").onclick = () =>
  info(
    "Forgot password?",
    "Password reset by email is not available yet. If you registered with Google, use Continue with Google to sign in.",
  );
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
    update();
  }
}
$("form").onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;
  error();
  busy = true;
  $("submit").disabled = true;
  try {
    const { user } = await post("/api/" + mode, {
      email: $("email").value,
      ...(mode === "signup" && {
        fullName: $("fullName").value,
        username: $("username").value,
        phone: $("phone").value,
      }),
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
