// Read the active path and changes in incoming audio counters only. Never retain
// or export the raw RTC report: candidate records can include network addresses.
export function connectionEstimate(first, last) {
  let pair;
  for (const stat of last.values()) {
    if (stat.type === "transport" && stat.selectedCandidatePairId) {
      pair = last.get(stat.selectedCandidatePairId);
      if (pair) break;
    }
  }
  const rtt = pair?.currentRoundTripTime;
  const delay =
    Number.isFinite(rtt) && rtt >= 0 ? Math.round(rtt * 1000) : null;
  const ends = [pair?.localCandidateId, pair?.remoteCandidateId].map(
    (id) => last.get(id)?.candidateType,
  );
  const path = ends.includes("relay")
    ? "TURN relay"
    : ends.every(Boolean)
      ? "Direct"
      : null;
  let received = 0,
    lost = 0;
  for (const s of last.values()) {
    if (s.type !== "inbound-rtp" || (s.kind ?? s.mediaType) !== "audio")
      continue;
    const prev = first.get(s.id);
    if (!prev || prev.ssrc !== s.ssrc) continue;
    const r = s.packetsReceived - prev.packetsReceived,
      l = s.packetsLost - prev.packetsLost;
    if (!Number.isFinite(r) || !Number.isFinite(l) || r < 0 || l < 0) continue;
    received += r;
    lost += l;
  }
  const loss = received + lost ? (100 * lost) / (received + lost) : null;
  const rating =
    delay === null && loss === null
      ? "Unavailable"
      : delay >= 400 || loss >= 5
        ? "Poor"
        : delay >= 200 || loss >= 2
          ? "Fair"
          : "Good";
  return { rating, delay, loss, path };
}
