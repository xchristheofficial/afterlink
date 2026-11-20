// Real roster + keyboard focus against in-memory group snapshots. No database.
import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import express from "express";
import { chromium } from "playwright";
const app = express(),
  group = {
    id: 7,
    uid: 1,
    admin: 1,
    groupName: "Weekend",
    topic: "Meetup",
    members: [
      { id: 1, name: "Lee", joined: 1 },
      { id: 2, name: "Alex", joined: 2 },
      { id: 3, name: "Alex", joined: null },
    ],
    messages: [],
  };
let lost = false;
app.get(["/groups/7", "/groups"], (_, r) =>
  r.sendFile(resolve("public/social.html")),
);
app.get("/api/feed/linkbacks/7", (_, r) =>
  lost
    ? r.status(403).json({ error: "Group unavailable." })
    : r.json({
        ...group,
        count: group.members.filter((m) => m.joined !== null).length,
      }),
);
app.get("/api/feed/linkbacks", (_, r) =>
  r.json({ groups: lost ? [] : [group] }),
);
app.get("/api/feed/unread", (_, r) => r.json({}));
app.get("/api/feed/settings", (_, r) => r.json({ prefs: {} }));
app.use(express.static("public"));
const server = app.listen(0, "127.0.0.1");
let browser;
try {
  await once(server, "listening");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  await page.addInitScript(() => {
    window.EventSource = class extends EventTarget {
      constructor() {
        super();
        window.stream = this;
      }
      close() {}
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/groups/7`);
  const btn = (name) => page.getByRole("button", { name, exact: true }),
    search = page.getByLabel("Find a member or invitee"),
    row = (id) => page.locator(`[data-member="${id}"]`),
    focused = (locator) =>
      locator.evaluate((el) => el === document.activeElement),
    wake = () => page.evaluate(() => stream.dispatchEvent(new Event("group")));
  await btn("Details").click();
  await search.fill("Alex");
  await search.evaluate((el) => el.setSelectionRange(1, 3));
  group.topic = "New topic";
  group.members.push({ id: 4, name: "Alex", joined: 4 });
  await wake();
  await page.getByRole("dialog").getByText("New topic").waitFor();
  assert.equal(await search.inputValue(), "Alex");
  assert.deepEqual(
    await search.evaluate((el) => [
      el === document.activeElement,
      el.selectionStart,
      el.selectionEnd,
    ]),
    [true, 1, 3],
  );
  const target = row(2).getByRole("button", { name: "Make admin" });
  await target.focus();
  group.members[1].name = "Alex T";
  group.members.reverse();
  await wake();
  await row(2).getByText("Alex T").waitFor();
  assert.ok(await focused(target));
  group.members = group.members.filter((m) => m.id !== 2);
  await wake();
  await row(2).waitFor({ state: "detached" });
  assert.ok(await focused(search));
  await row(3).getByRole("button", { name: "Resend" }).focus();
  group.members.find((m) => m.id === 3).joined = 5;
  await wake();
  await row(3).getByRole("button", { name: "Make admin" }).waitFor();
  assert.ok(await focused(search));
  await row(4).getByRole("button", { name: "Make admin" }).click();
  await page.getByRole("dialog", { name: "Transfer admin role?" }).waitFor();
  group.topic = "Changed during confirmation";
  await wake();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await btn("Details").click();
  await btn("Invite more people").focus();
  group.admin = 4;
  await wake();
  await btn("Invite more people").waitFor({ state: "hidden" });
  assert.ok(await focused(search));
  assert.equal(await btn("Remove").count(), 0);
  lost = true;
  await wake();
  await page.waitForURL("**/groups");
  assert.equal(await page.getByRole("dialog").count(), 0);
  console.log(
    "Group roster passed: search caret, same-member focus after rename/reorder, safe focus after removal/join or admin loss, stale confirmation dismissal, and access loss.",
  );
} finally {
  await browser?.close();
  server.close();
}
