import { button, n } from "./social-ui.js";

// Only the most recent local recording is retained, never in browser storage.
export function recordingDownload() {
  const root = n("aside", "record-download");
  root.hidden = true;
  root.setAttribute("aria-label", "Local call recording");
  let timer,
    url,
    epoch = 0;
  function clear() {
    clearTimeout(timer);
    if (url) URL.revokeObjectURL(url);
    url = null;
    root.replaceChildren();
    root.hidden = true;
  }
  addEventListener("pagehide", () => {
    epoch++;
    clear();
  });
  return {
    root,
    forCall() {
      const started = epoch;
      return (blob) => {
        if (started !== epoch || !blob.size) return;
        clear();
        url = URL.createObjectURL(blob);
        const ext = blob.type.includes("mp4")
          ? blob.type.startsWith("audio")
            ? "m4a"
            : "mp4"
          : "webm";
        const link = n("a", "", "Download recording again");
        link.href = url;
        link.download = `AfterLink-call-${Date.now()}.${ext}`;
        root.append(
          n("strong", "", "Your last recording"),
          n("small", "subtle", "Available here for 5 minutes on this device."),
          link,
          button("Dismiss download link", clear),
        );
        root.hidden = false;
        timer = setTimeout(clear, 5 * 60 * 1000);
        link.click();
      };
    },
  };
}
