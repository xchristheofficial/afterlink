// Export preferences, not the raw settings response (which also contains other
// members' names). Future API fields are excluded unless deliberately added.
export function downloadPreferences(settings, expectedMember) {
  if (!Number.isSafeInteger(expectedMember) || settings.id !== expectedMember)
    throw Error(
      "Your signed-in account changed. Reload Settings before downloading.",
    );
  const { prefs } = settings;
  const pick = (keys) =>
    Object.fromEntries(
      keys
        .filter((key) => ["boolean", "string"].includes(typeof prefs[key]))
        .map((key) => [key, prefs[key]]),
    );
  const snapshot = {
    format: "afterlink-settings",
    version: 1,
    exportedAt: new Date().toISOString(),
    privacy: {
      privateAccount: settings.private,
      ...pick([
        "messages",
        "mentions",
        "stories",
        "activity",
        "typing",
        "downloads",
      ]),
    },
    appearance: pick(["theme", "accent", "reduce", "autoplay", "autoReels"]),
    notifications: pick([
      "follow",
      "mention",
      "comment",
      "like",
      "message",
      "reel",
    ]),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(snapshot, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "afterlink-settings.json";
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
