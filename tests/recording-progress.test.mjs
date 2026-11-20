import test from "node:test";
import assert from "node:assert/strict";
import {
  RECORDING_BYTES,
  RECORDING_MS,
  recordingProgress,
} from "../public/recording-progress.js";

test("recording clock starts from zero and warns before either local cap", () => {
  assert.deepEqual(recordingProgress(-20, 0), { time: "0:00", warning: "" });
  assert.deepEqual(recordingProgress(RECORDING_MS - 60001, 0), {
    time: "8:59",
    warning: "",
  });
  assert.match(recordingProgress(RECORDING_MS - 60000, 0).warning, /minute/);
  assert.match(
    recordingProgress(30000, Math.ceil(RECORDING_BYTES * 0.9)).warning,
    /64 MiB/,
  );
  assert.equal(recordingProgress(RECORDING_MS + 3000, 0).time, "10:00");
});
