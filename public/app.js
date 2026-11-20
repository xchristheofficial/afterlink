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
  $("factorField").hidden = true;
  $("factorCode").value = "";
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
  $("password").placeholder = signup ? "Create a password" : "Password";
  $("email").placeholder = signup ? "Enter your email" : "Email";
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
let resetToken =
  location.pathname === "/" &&
  new URLSearchParams(location.hash.slice(1)).get("reset");
const resetEyes = document.querySelectorAll(".reset-eye");
function setResetVisibility(button, visible) {
  const input = $(button.getAttribute("aria-controls"));
  input.type = visible ? "text" : "password";
  button.setAttribute("aria-pressed", String(visible));
  button.setAttribute(
    "aria-label",
    `${visible ? "Hide" : "Show"} ${input.placeholder.toLowerCase()}`,
  );
}
for (const button of resetEyes)
  button.onclick = () =>
    setResetVisibility(button, button.getAttribute("aria-pressed") !== "true");
function checkPassword() {
  const value = $("newPassword").value;
  const rules = {
    length: value.length >= 12,
    upper: /[A-Z]/.test(value),
    digit: /[0-9]/.test(value),
  };
  const score = Object.values(rules).filter(Boolean).length;
  for (const item of document.querySelectorAll("#passwordRules li")) {
    const met = rules[item.dataset.rule];
    item.dataset.met = String(met);
    item.setAttribute(
      "aria-label",
      `${item.textContent}: ${met ? "met" : "not met"}`,
    );
  }
  $("strengthMeter").value = score;
  $("strengthText").textContent = value
    ? ["Weak", "Weak", "Fair", "Strong"][score]
    : "Not entered";
  $("newPassword").setCustomValidity(
    value && score !== 3 ? "Meet all three password requirements." : "",
  );
  $("confirmPassword").setCustomValidity(
    $("confirmPassword").value && $("confirmPassword").value !== value
      ? "The passwords do not match."
      : "",
  );
}
function clearResetFields() {
  $("newPassword").value = $("confirmPassword").value = "";
  for (const button of resetEyes) setResetVisibility(button, false);
  checkPassword();
}
$("resetField").addEventListener("input", checkPassword);
function openRecovery() {
  const reset = !!resetToken;
  $("auth").hidden = true;
  $("recovery").hidden = false;
  document.querySelector(".inside").dataset.mode = reset ? "reset" : "recovery";
  $("password").value = "";
  $("recoveryEmail").value = $("email").value;
  $("requestField").hidden = $("recoveryEmail").disabled = reset;
  $("resetField").hidden = $("resetField").disabled = !reset;
  clearResetFields();
  $("resendGroup").hidden = reset;
  $("recoveryHeading").textContent = reset
    ? "Reset Password"
    : "Forgot Password?";
  $("recoveryIntro").textContent = reset
    ? "Choose a new password for your AfterLink account. Make it strong and unique."
    : "No worries. Enter your email and we will send you a reset link.";
  $("sendReset").textContent = reset ? "Reset Password" : "Send Reset Link";
  $("recoveryStatus").textContent = "";
  document.querySelector(".card").scrollTop = 0;
  $("recoveryHeading").focus({ preventScroll: true });
}
function closeRecovery() {
  resetToken = null;
  clearResetFields();
  $("recovery").hidden = true;
  $("auth").hidden = false;
  $("email").value = $("recoveryEmail").value;
  mode = "signin";
  update();
  $("heading").focus();
}
$("forgot").onclick = () => {
  if (!busy) openRecovery();
};
for (const button of document.querySelectorAll(".back"))
  button.onclick = () => {
    if (!busy) closeRecovery();
  };
$("resend").onclick = () => $("recoveryForm").requestSubmit();
$("recoveryForm").onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;
  if (resetToken) {
    checkPassword();
    if (!$("recoveryForm").reportValidity()) return;
  }
  busy = $("sendReset").disabled = $("resend").disabled = true;
  $("recoveryStatus").textContent = "";
  try {
    if (resetToken) {
      await post("/api/reset-password", {
        token: resetToken,
        password: $("newPassword").value,
      });
      closeRecovery();
      info("Password updated", "You can now sign in with your new password.");
    } else {
      await post("/api/forgot-password", { email: $("recoveryEmail").value });
      $("recoveryStatus").textContent =
        "If this address has a password account, check your inbox for a reset link. Allow a minute before resending.";
    }
  } catch (err) {
    $("recoveryStatus").textContent = err.message;
  } finally {
    busy = $("sendReset").disabled = $("resend").disabled = false;
  }
};
if (resetToken) {
  $("routePending").hidden = true;
  document.querySelector(".layout").hidden = false;
  history.replaceState(null, "", location.pathname);
  openRecovery();
}
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
  document.querySelector(".layout").hidden = !!user;
  $("auth").hidden = !!user;
  $("account").hidden = !user;
  $("accountEmail").textContent = user?.email || "";
  if (user) homeFeed.open();
  else homeFeed.clear();
  if (user) {
    $("recovery").hidden = true;
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
    const result = await post("/api/" + mode, {
      code: $("factorCode").value,
      email: $("email").value,
      ...(mode === "signup" && {
        fullName: $("fullName").value,
        username: $("username").value,
        phone: $("phone").value,
      }),
      password: $("password").value,
    });
    if (result.requiresCode) {
      $("factorField").hidden = false;
      $("factorCode").focus();
      return;
    }
    location.replace(returnProfile() || "/home");
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
    location.replace("/");
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
// Remember only an internal numeric profile destination across sign-in, including OAuth.
const target = new URLSearchParams(location.search).get("profile");
const allowedSocial = (s) =>
  typeof s === "string" &&
  /^\/(?:(?:linkbacks|groups)(?:\/[1-9]\d*)?|messages(?:\/[1-9]\d*)?|notifications|settings(?:\/(?:privacy|notifications|appearance|security))?|connections|saved|safety|stories(?:\/create)?|search|reels|post\/[1-9]\d*)(?:\?[^\s\\#]*)?$/.test(
    s,
  );
const nextPage = new URLSearchParams(location.search).get("next");
try {
  if (location.pathname === "/" && allowedSocial(nextPage))
    sessionStorage.setItem("afterlink.returnProfile", nextPage);
  if (
    location.pathname === "/" &&
    (target === "edit" || target === "me" || /^[1-9]\d*$/.test(target))
  )
    sessionStorage.setItem("afterlink.returnProfile", target);
} catch {
  /* Storage may be unavailable. */
}
function returnProfile() {
  try {
    const id = sessionStorage.getItem("afterlink.returnProfile");
    sessionStorage.removeItem("afterlink.returnProfile");
    if (allowedSocial(id)) return id;
    return id === "edit"
      ? "/profile/edit"
      : id === "me"
        ? "/profile"
        : /^[1-9]\d*$/.test(id)
          ? "/profile/" + id
          : null;
  } catch {
    return null;
  }
}
const auth = new URLSearchParams(location.search).get("auth");
if (auth) {
  error(
    auth === "session"
      ? "Sign in to open your Home Feed. If you just signed in, check that cookies are enabled for this site."
      : auth === "existing"
        ? "That email already has an account. Sign in with your password."
        : auth === "unavailable"
          ? "Google sign-in is not configured."
          : "Google sign-in was not completed. Please try again.",
  );
  history.replaceState(null, "", "/");
}
// Both shells start hidden: never paint sign-in or an unrelated member page
// while the session check is in flight. Recovery links do not need a session.
async function openRoute() {
  const atHome = /^\/home\/?$/.test(location.pathname);
  const memberRoute =
    atHome || /^\/(create\/?$|profile(?:\/|$))/.test(location.pathname);
  $("retryRoute").hidden = true;
  $("routeStatus").textContent = "Loading AfterLink…";
  try {
    const member = document.querySelector('meta[name="member-session"]');
    let user;
    if (memberRoute && member)
      user = { email: decodeURIComponent(member.content) };
    else {
      const r = await fetch("/api/session", { cache: "no-store" });
      if (!r.ok) throw Error();
      ({ user } = await r.json());
    }
    if (memberRoute && !user) return location.replace("/?auth=session");
    if (!memberRoute && user)
      return location.replace(returnProfile() || "/home");
    const target = user && atHome && returnProfile();
    if (target) return location.replace(target);
    if (user) {
      document.title = atHome ? "Home Feed · AfterLink" : "Profile · AfterLink";
      account(user);
    } else document.querySelector(".layout").hidden = false;
    $("routePending").hidden = true;
  } catch {
    $("routeStatus").textContent =
      "Could not load this page. Check your connection and try again.";
    $("retryRoute").hidden = false;
  }
}
$("retryRoute").onclick = openRoute;
if (!resetToken) openRoute();
