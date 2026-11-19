export const separated = (a, b) =>
  `EXISTS(SELECT 1 FROM restrictions r WHERE r.kind='block' AND ((r.owner=${a} AND r.target=${b}) OR (r.owner=${b} AND r.target=${a})))`;
export const muted = (a, b) =>
  `EXISTS(SELECT 1 FROM restrictions r WHERE r.kind='mute' AND r.owner=${a} AND r.target=${b})`;
