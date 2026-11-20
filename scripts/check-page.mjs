import { checkSocial } from "./check-social.mjs";
// Run with npm run test:ui after installing Playwright Chromium. Never uses the live DB.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const dir = await mkdtemp(join(tmpdir(), "afterlink-ui-"));
const server = spawn(process.execPath, ["server.mjs"], {
  env: {
    ...process.env,
    PORT: "0",
    NODE_ENV: "test",
    DB_FILE: join(dir, "ui.sqlite"),
    GOOGLE_CLIENT_ID: "",
    RESEND_API_KEY: "",
  },
  stdio: ["ignore", "pipe", "inherit"],
});
let browser;
try {
  const [line] = await once(server.stdout, "data");
  const url = `http://127.0.0.1:${line.toString().match(/on (\d+)/)[1]}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const owner = await browser.newContext({ baseURL: url });
  const page = await owner.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(url + "/home");
  await page.getByText(/Sign in to open your Home Feed/).waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
  await page.evaluate(() =>
    localStorage.setItem(
      "afterlink.appearance",
      JSON.stringify({ theme: "dark", accent: "green" }),
    ),
  );
  await page.goto(url + "/home");
  await page.getByText(/Sign in to open your Home Feed/).waitFor();
  const brand = page.getByRole("heading", { level: 1, name: /AfterLink/ });
  assert.equal(
    await brand.locator("use").getAttribute("href"),
    "/assets/icons.svg#brand-link",
  );
  assert.equal(await brand.locator("img").count(), 0);
  assert.equal(
    await brand.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  assert.equal(
    await brand.evaluate((el) => getComputedStyle(el).color),
    "rgb(245, 244, 255)",
  );
  assert.equal(
    await page.locator("#error").evaluate((el) => getComputedStyle(el).color),
    "rgb(255, 172, 187)",
  );
  if (process.env.AUTH_DARK_SCREENSHOT)
    await page.screenshot({
      path: process.env.AUTH_DARK_SCREENSHOT,
      animations: "disabled",
    });
  await page.evaluate(() => localStorage.removeItem("afterlink.appearance"));
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  for (const [width, height] of [
    [1568, 730],
    [1440, 900],
    [1024, 768],
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    const bounds = await page.locator(".layout").boundingBox();
    if (width > 760) {
      const image = page.locator(".art img");
      const box = await image.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= height);
      assert.equal(
        await image.evaluate((el) => getComputedStyle(el).objectFit),
        "contain",
      );
    }
    assert.equal(bounds.x, 0);
    assert.equal(bounds.y, 0);
    assert.equal(bounds.width, width);
    assert.ok(bounds.height >= height);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth === innerWidth,
      ),
    );
  }
  await page.setViewportSize({ width: 1568, height: 784 });
  const art = page.locator(".art img");
  await art.evaluate((img) => img.decode());
  const original = await art.elementHandle();
  const rect = await art.boundingBox();
  const imageRequests = () =>
    page.evaluate(
      () =>
        performance
          .getEntriesByType("resource")
          .filter((e) => e.name.endsWith("/auth-illustration.webp")).length,
    );
  const initialRequests = await imageRequests();
  for (const label of [
    "Create Account",
    "Sign In",
    "Create Account",
    "Sign In",
  ]) {
    await page.fill("#password", "discarded");
    await page.click("#reveal");
    assert.equal(await page.getAttribute("#password", "type"), "text");
    await page.click("#switchMode");
    assert.equal(await page.innerText("#heading"), label);
    assert.equal(await page.getAttribute("#password", "type"), "password");
    assert.equal(await page.inputValue("#password"), "");
    assert.ok(
      await original.evaluate(
        (el) => el === document.querySelector(".art img"),
      ),
    );
    assert.deepEqual(await art.boundingBox(), rect);
    assert.equal(await imageRequests(), initialRequests);
  }
  await page.click("#forgot");
  await page.getByRole("heading", { name: "Forgot Password?" }).waitFor();
  assert.deepEqual(await art.boundingBox(), rect);
  assert.equal(await imageRequests(), initialRequests);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.fill("#recoveryEmail", "owner@example.test");
  await page.click("#sendReset");
  await page.getByText(/No link was sent/).waitFor();
  await page.click("#resend");
  await page.getByText(/No link was sent/).waitFor();
  await page.locator(".recovery-links .back").click();
  assert.equal(await page.inputValue("#email"), "owner@example.test");
  await page.click("#google");
  await page.getByRole("dialog", { name: "Google sign-in" }).waitFor();
  await page.keyboard.press("Escape");
  const icon = await page.request.get(
    await page.locator("link[rel=icon]").getAttribute("href"),
  );
  assert.ok(icon.ok());
  assert.match(icon.headers()["content-type"], /svg/);
  const email = `${randomUUID()}@example.test`,
    password = randomUUID();
  await page.click("#switchMode");
  await page.fill("#fullName", "UI test");
  await page.fill("#username", "ui_test");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("#submit");
  await page.locator("#account").waitFor();
  assert.equal(new URL(page.url()).pathname, "/home");
  // The server already checked the session before returning member HTML.
  // A stalled API must not leave the user looking at sign-in on a member URL.
  let sessionRequests = 0;
  await page.route("**/api/session", (route) => {
    sessionRequests++;
    return route.abort();
  });
  let releaseProfile;
  const slowProfile = new Promise((resolve) => {
    releaseProfile = resolve;
  });
  await page.route("**/api/feed/profile", async (route) => {
    await slowProfile;
    await route.continue();
  });
  await page.goto(url + "/profile/edit");
  try {
    await page.locator("#editLoading").waitFor();
    assert.ok(await page.locator(".topbar").isVisible());
    assert.ok(await page.locator(".layout").isHidden());
    assert.ok(await page.locator(".home-grid").isHidden());
  } finally {
    releaseProfile();
  }
  await page.locator("#editForm").waitFor();
  await page.goto(url + "/create");
  await page.locator("#createPage").waitFor();
  await page.goBack();
  await page.locator("#editForm").waitFor();
  assert.equal(sessionRequests, 0);
  await page.unroute("**/api/feed/profile");
  await page.unroute("**/api/session");
  await page.goto(url + "/home");
  await page.reload();
  await page.locator("#account").waitFor();
  assert.equal(new URL(page.url()).pathname, "/home");
  assert.equal(await page.innerText("#accountEmail"), email);
  await page.locator("#emptyFeed").waitFor();
  assert.equal(await page.innerText("#profileName"), "RADAR");
  assert.equal(await page.innerText("#profileHandle"), "@ui_test");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth === innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1568, height: 721 });
  assert.ok((await page.locator(".topbar").boundingBox()).height <= 76);
  const exploreButton = await page.locator("#emptyFeed .pill").boundingBox();
  assert.ok(exploreButton.y + exploreButton.height <= 721);
  await page
    .locator("#profileName")
    .getByRole("img", { name: "Verified account" })
    .waitFor();
  assert.equal(await page.locator(".topbar nav:visible").count(), 0);
  const toggle = page.locator("#railToggle");
  const menu = page.locator("#profileRail");
  const expandedWidth = (await menu.boundingBox()).width;
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await page.waitForFunction(
    () =>
      document.querySelector("#profileRail").getBoundingClientRect().width <=
      69,
  );
  const collapsedBox = await menu.boundingBox();
  assert.ok(collapsedBox.width < expandedWidth && collapsedBox.x <= 20);
  assert.equal(
    await menu.locator(".rail-identity").evaluate((e) => e.inert),
    true,
  );
  await menu.getByRole("button", { name: "Notifications" }).click();
  await page
    .getByRole("heading", { name: "Notifications", exact: true })
    .waitFor();
  await page.getByRole("link", { name: "AfterLink home" }).click();
  await page.reload();
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("aria-label"), "Expand sidebar");
  await page.setViewportSize({ width: 390, height: 844 });
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  await menu.locator('[data-later="Notifications"] span').waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth === innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1568, height: 721 });
  const radarBadge = page.locator("#profileName .verified-mark");
  assert.equal(
    await radarBadge.getAttribute("src"),
    "/assets/radar-gold-badge.webp",
  );
  await radarBadge.evaluate((img) => img.decode());
  // Check the actual empty feed, including on a dark device with no saved theme.
  await page.evaluate(() => scrollTo(0, 0));
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await page.locator("html").getAttribute("data-color"), "light");
  assert.equal(
    await page.locator('#feedPanel [data-view="Explore"]:visible').count(),
    1,
  );
  assert.equal(await page.locator(".story-links a:visible").count(), 2);
  if (process.env.FEED_SCREENSHOT)
    await page.screenshot({
      path: process.env.FEED_SCREENSHOT,
      animations: "disabled",
    });
  await page.goto(url + "/settings/appearance");
  await page.getByRole("button", { name: "dark", exact: true }).click();
  await page.getByRole("button", { name: "Save Appearance" }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.color === "dark",
  );
  await page.goto(url + "/home");
  await page.locator("#emptyFeed").waitFor();
  assert.equal(await page.locator("html").getAttribute("data-color"), "dark");
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  if (process.env.DARK_FEED_SCREENSHOT)
    await page.screenshot({
      path: process.env.DARK_FEED_SCREENSHOT,
      animations: "disabled",
    });
  await page.getByRole("link", { name: "Open your profile" }).click();
  await page.locator("#memberName .verified-mark").waitFor();
  assert.equal(await page.innerText("#memberName"), "RADAR");
  assert.equal(await page.innerText("#postCount"), "0");
  await page.getByRole("button", { name: "Edit Profile" }).click();
  await page.locator("#editForm").waitFor();
  assert.equal(new URL(page.url()).pathname, "/profile/edit");
  assert.equal(await page.locator(".profile-nav > :visible").count(), 1);
  assert.ok(await page.getByRole("link", { name: "My profile" }).isVisible());
  const editCard = await page.locator(".edit-card").boundingBox();
  assert.ok(editCard.width <= 800 && editCard.y + editCard.height <= 721);
  assert.equal(await page.inputValue("#editEmail"), email);
  assert.ok(await page.locator("#badgeNote").isVisible());
  await page.setViewportSize({ width: 320, height: 650 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth === innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1568, height: 1045 });
  await page.fill("#editUsername", "ui_updated");
  await page.waitForFunction(() =>
    document.querySelector("#handleState").textContent.includes("Available"),
  );
  await page
    .locator("#photoFile")
    .setInputFiles("public/assets/editor-avatar.webp");
  await page.waitForFunction(() =>
    document.querySelector("#editAvatar").src.startsWith("data:image/jpeg;"),
  );
  await page.fill("#editBio", "Building AfterLink");
  await page.click("#editSave");
  await page.getByText("Building AfterLink", { exact: true }).waitFor();
  await page.click("#shareProfile");
  const shared = await page.inputValue("#shareUrl");
  assert.ok(shared.startsWith(url + "/profile/"));
  await page.click("#shareClose");
  await page.getByRole("button", { name: "Create Your First Post" }).click();
  await page.locator("#postName .verified-mark").waitFor();
  assert.equal(new URL(page.url()).pathname, "/create");
  if (process.env.COMPOSER_SCREENSHOT)
    await page.screenshot({
      path: process.env.COMPOSER_SCREENSHOT,
      animations: "disabled",
    });
  await page.setViewportSize({ width: 320, height: 600 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth === innerWidth,
    ),
  );
  await page.fill("#postText", "My first real post.");
  assert.equal(await page.textContent("#postCounter"), "19 / 500");
  await page.selectOption("#postAudience", "followers");
  await page.click("[data-extra=pollPanel]");
  await page.getByLabel("First answer").fill("Morning");
  await page.getByLabel("Second answer").fill("Evening");
  await page
    .locator("#postFiles")
    .setInputFiles("public/assets/editor-avatar.webp");
  await page.locator("#postPreviews img").waitFor();
  await page.click("#openDrafts");
  await page.click("#storeDraft");
  await page.reload();
  await page.click("#openDrafts");
  await page.click("#restoreDraft");
  assert.equal(await page.inputValue("#postText"), "My first real post.");
  await page.locator("#postPreviews img").waitFor();
  await page.click("#publishPost");
  await page.locator("#memberGrid").getByText("My first real post.").waitFor();
  assert.equal(await page.innerText("#postCount"), "1");
  await page.reload();
  await page.getByText("Building AfterLink", { exact: true }).waitFor();
  await page.click('[data-tab="Reels"]');
  await page.getByText("No reels yet", { exact: true }).waitFor();
  await page.click('[data-tab="Saved"]');
  await page.getByText("No saved posts yet", { exact: true }).waitFor();
  await page.click('[data-tab="Tagged"]');
  await page.getByText("No tagged posts yet", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth === innerWidth,
    ),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".member-empty")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.locator("#feedRows").getByText("My first real post.").waitFor();
  await page.locator("#feedRows .verified-mark").waitFor();
  await page.getByRole("button", { name: "Save post", exact: true }).click();
  await page.getByRole("button", { name: "Unsave", exact: true }).waitFor();
  await page.locator('.side-nav [data-view="Saved"]').click();
  await page
    .locator(".library-item")
    .getByText("My first real post.")
    .waitFor();
  await page.getByRole("link", { name: "AfterLink home" }).click();
  await page.locator("#feedPanel").waitFor();
  await page.locator("#feedRows").getByText("My first real post.").waitFor();
  // Another authenticated user in the same isolated test database must not inherit RADAR.
  const second = await browser.newContext({ baseURL: url });
  const headers = { "X-AfterLink-Request": "1" };
  assert.equal((await second.request.get("/api/feed")).status(), 401);
  await second.request.post("/api/signup", {
    headers,
    data: {
      fullName: "Second Member",
      username: "second_member",
      email: `${randomUUID()}@example.test`,
      password: randomUUID(),
    },
  });
  const secondFeed = async () => (await second.request.get("/api/feed")).json();
  const initial = await secondFeed();
  assert.equal(initial.profile.name, "Second Member");
  assert.equal(initial.profile.founder, 0);
  assert.deepEqual(initial.posts, []);
  const { people } = await (
    await second.request.get("/api/feed/people?q=radar")
  ).json();
  assert.equal(people.length, 1);
  assert.ok(!("email" in people[0]));
  const ownPost = (await (await page.request.get("/api/feed")).json()).posts[0];
  const mediaUrl = "/api/feed/media/" + ownPost.media[0].id;
  assert.deepEqual(
    (
      await (
        await second.request.get("/api/feed/profile?id=" + people[0].id)
      ).json()
    ).posts,
    [],
  );
  assert.equal((await second.request.get(mediaUrl)).status(), 404);
  assert.equal(
    (
      await second.request.post("/api/feed/vote", {
        headers,
        data: { id: ownPost.id, choice: 0 },
      })
    ).status(),
    404,
  );
  assert.equal(
    (await (await page.request.get("/api/feed/draft")).json()).draft,
    null,
  );
  await second.request.post("/api/feed/follow", {
    headers,
    data: { id: people[0].id, on: true },
  });
  assert.equal((await secondFeed()).posts[0].body, "My first real post.");
  assert.equal((await secondFeed()).profile.following, 1);
  const slice = await second.request.get(mediaUrl, {
    headers: { Range: "bytes=0-3" },
  });
  assert.equal(slice.status(), 206);
  assert.equal((await slice.body()).toString(), "RIFF");
  const voted = await second.request.post("/api/feed/vote", {
    headers,
    data: { id: ownPost.id, choice: 1 },
  });
  assert.equal((await voted.json()).choice, 1);
  const otherPage = await second.newPage();
  await otherPage.goto(url + "/home");
  await otherPage.locator("#feedRows .verified-mark").waitFor();
  assert.equal(
    await otherPage.locator("#profileName .verified-mark").count(),
    0,
  );
  await otherPage.locator('.side-nav [data-view="Explore"]').click();
  await otherPage.locator(".person-card .verified-mark").waitFor();
  await otherPage.locator(".person-card .person-link").first().click();
  await otherPage
    .getByRole("button", { name: "Unfollow", exact: true })
    .waitFor();
  assert.equal(otherPage.url(), shared);
  assert.equal(
    await otherPage.locator('[data-tab="Saved"]').isVisible(),
    false,
  );
  assert.equal(
    await otherPage.getByRole("button", { name: "Edit Profile" }).count(),
    0,
  );
  assert.equal(await otherPage.innerText("#followerCount"), "1");
  const founder = people[0].id;
  const profileAPI = "/api/feed/profile";
  const details = await (
    await second.request.get(profileAPI + "?id=" + founder)
  ).json();
  assert.equal(details.contact, undefined);
  await checkSocial({
    page,
    second,
    url,
    peer: initial.profile.id,
    author: founder,
    postId: ownPost.id,
    browser,
  });
  const update = await page.request.post(profileAPI, {
    headers,
    data: { name: "RADAR", bio: "Building AfterLink", private: true },
  });
  assert.ok(update.ok());
  assert.ok((await secondFeed()).posts.some((p) => p.id === ownPost.id));
  await second.request.post("/api/feed/save", {
    headers,
    data: { id: details.posts[0].id, on: true },
  });
  await second.request.post("/api/feed/follow", {
    headers,
    data: { id: founder, on: false },
  });
  assert.deepEqual(
    (await (await second.request.get(profileAPI + "?id=" + founder)).json())
      .posts,
    [],
  );
  assert.deepEqual(
    (await (await second.request.get("/api/feed?view=saved")).json()).posts,
    [],
  );
  assert.equal(
    (
      await second.request.post("/api/feed/follow", {
        headers,
        data: { id: founder, on: true },
      })
    ).status(),
    403,
  );
  await otherPage.goto(url + "/profile/edit");
  await otherPage.locator("#editForm").waitFor();
  assert.equal(await otherPage.locator("#badgeNote").isVisible(), false);
  await otherPage.fill("#editUsername", "ui_updated");
  await otherPage.getByText("Taken", { exact: true }).waitFor();
  await otherPage.click("#editCancel");
  await otherPage
    .getByText("@second_member", { exact: true })
    .first()
    .waitFor();
  await otherPage.click("#memberAction");
  await otherPage.click("#deleteAccount");
  await otherPage.fill("#deleteText", "DELETE");
  await otherPage.click("#confirmDelete");
  await otherPage.waitForURL(url + "/");
  assert.equal((await second.request.get(profileAPI)).status(), 401);
  assert.equal(
    (await page.request.get(profileAPI + "?id=" + initial.profile.id)).status(),
    404,
  );
  await second.close();
  await page.click("#logout");
  await page.waitForURL(url + "/");
  await page.goto(shared);
  await page.locator("#form").waitFor();
  await page.fill("#email", email);
  await page.fill("#password", "incorrect");
  await page.click("#submit");
  await page.locator("#error").waitFor();
  await page.fill("#password", password);
  await page.click("#submit");
  await page.locator("#account").waitFor();
  await page.locator("#memberContent").waitFor();
  assert.equal(page.url(), shared);
  await page.click('[data-tab="Saved"]');
  await page.locator("#memberGrid").getByText("My first real post.").waitFor();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.click("#logout");
  await page.waitForURL(url + "/");
  await page.locator("#form").waitFor();
  // Exercise the real reset route with a token issued only in the test database.
  const token = randomBytes(32).toString("hex");
  const db = new DatabaseSync(join(dir, "ui.sqlite"));
  try {
    db.prepare(
      "INSERT INTO password_resets(user_id,digest,issued,expires) SELECT id,?,?,? FROM users WHERE email=?",
    ).run(
      createHash("sha256").update(token).digest("hex"),
      Date.now(),
      Date.now() + 60000,
      email,
    );
  } finally {
    db.close();
  }
  await page.goto("about:blank");
  await page.goto(`${url}/#reset=${token}`);
  await page.getByRole("heading", { name: "Reset Password" }).waitFor();
  assert.equal(await page.innerText("#strengthText"), "Not entered");
  const replacement = "A1" + randomUUID();
  await page.fill("#newPassword", replacement);
  assert.equal(await page.innerText("#strengthText"), "Strong");
  assert.equal(
    await page.locator("#passwordRules li[data-met=true]").count(),
    3,
  );
  await page
    .getByRole("button", { name: "Show new password", exact: true })
    .click();
  assert.equal(await page.getAttribute("#newPassword", "type"), "text");
  assert.equal(await page.getAttribute("#confirmPassword", "type"), "password");
  await page.fill("#confirmPassword", replacement + "x");
  await page.click("#sendReset");
  assert.ok(await page.locator("#confirmPassword:invalid").count());
  await page.fill("#confirmPassword", replacement);
  await page.click("#sendReset");
  await page.getByRole("dialog", { name: "Password updated" }).waitFor();
  await page.keyboard.press("Escape");
  await page.fill("#email", email);
  await page.fill("#password", replacement);
  await page.click("#submit");
  await page.locator("#account").waitFor();
  assert.equal(new URL(page.url()).pathname, "/home");
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: auth and recovery, responsive layout, profiles, composer, drafts, voting, protected media, messaging, notifications, discovery, reels, comments and account lifecycle.",
  );
} finally {
  await browser?.close();
  if (server.exitCode === null && !server.signalCode) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  await rm(dir, { force: true, recursive: true });
}
