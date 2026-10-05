// 5000 VU chat reads: list rooms, ensure default channel, paginate messages (C-13.10 / UNI-516).
// Nightly report-only sibling to read-5000.k6.js until phase C closes the bar.
import { sleep } from "k6";
import { chatReadOnce, login, readThresholds } from "./perf-lib.js";

export const options = {
  stages: [{ duration: "2m", target: 5000 }, { duration: "5m", target: 5000 }, { duration: "1m", target: 0 }],
  thresholds: readThresholds,
};

export function setup() {
  return Array.from({ length: 500 }, (_, i) => login(i * 9));
}

export default function (sessions) {
  chatReadOnce(sessions[__VU % sessions.length]);
  sleep(2);
}
