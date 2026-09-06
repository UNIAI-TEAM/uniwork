// 5000 VU reads: the Vision §6.3 bar. Reported nightly, not blocking until
// the end of phase C (OPEN_QUESTIONS O5) — the workflow runs it with
// continue-on-error.
import { sleep } from "k6";
import { login, readOnce, readThresholds } from "./perf-lib.js";

export const options = {
  stages: [{ duration: "2m", target: 5000 }, { duration: "5m", target: 5000 }, { duration: "1m", target: 0 }],
  thresholds: readThresholds,
};

export function setup() {
  return Array.from({ length: 500 }, (_, i) => login(i * 9));
}

export default function (sessions) {
  readOnce(sessions[__VU % sessions.length]);
  sleep(2);
}
