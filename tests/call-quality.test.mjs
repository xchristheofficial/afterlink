import test from "node:test";
import assert from "node:assert/strict";
import { connectionEstimate } from "../public/call-quality.mjs";
const audio = (r, l, ssrc = 4) => ({
  type: "inbound-rtp",
  kind: "audio",
  id: "a",
  ssrc,
  packetsReceived: r,
  packetsLost: l,
});
const report = (...stats) => new Map(stats.map((s) => [s.id, s]));
test("quality uses selected path and recent audio loss, not lifetime totals", () => {
  const active = [
    { id: "t", type: "transport", selectedCandidatePairId: "p" },
    {
      id: "p",
      type: "candidate-pair",
      remoteCandidateId: "b",
      localCandidateId: "c",
      currentRoundTripTime: 0.25,
    },
    { id: "b", candidateType: "relay" },
    { id: "c", candidateType: "host" },
  ];
  const first = report(audio(1000, 300));
  assert.deepEqual(
    connectionEstimate(first, report(...active, audio(1099, 301))),
    { rating: "Fair", delay: 250, loss: 1, path: "TURN relay" },
  );
  active[1].currentRoundTripTime = 0.02;
  active[2].candidateType = "srflx";
  assert.deepEqual(
    connectionEstimate(first, report(...active, audio(1094, 306))),
    { rating: "Poor", delay: 20, loss: 6, path: "Direct" },
  );
  assert.equal(
    connectionEstimate(first, report(...active, audio(1100, 300))).rating,
    "Good",
  );
});
test("missing, idle, reset or replaced audio counters do not imply zero loss", () => {
  const first = report(audio(100, 10));
  for (const s of [
    audio(100, 10),
    audio(0, 0),
    audio(220, 20, 8),
    audio(200, undefined),
  ])
    assert.deepEqual(connectionEstimate(first, report(s)), {
      rating: "Unavailable",
      delay: null,
      loss: null,
      path: null,
    });
});
