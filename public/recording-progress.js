export const RECORDING_MS = 10 * 60 * 1000;
export const RECORDING_BYTES = 64 * 1024 * 1024;

export function recordingProgress(elapsed, bytes) {
  const sec = Math.floor(Math.min(RECORDING_MS, Math.max(0, elapsed)) / 1000);
  return {
    time: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`,
    warning:
      bytes >= RECORDING_BYTES * 0.9
        ? "Nearly at the 64 MiB recording limit."
        : elapsed >= RECORDING_MS - 60000
          ? "Less than a minute of recording time remains."
          : "",
  };
}
