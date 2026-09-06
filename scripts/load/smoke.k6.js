// 50 VU for one minute: runs on PRs labelled `perf`. Proves the stack is up
// and the thresholds hold at a trickle before the nightly runs take over.
import { sleep } from "k6";
import { login, readOnce, readThresholds } from "./perf-lib.js";

export const options = { vus: 50, duration: "1m", thresholds: readThresholds };

export function setup() {
  return Array.from({ length: 50 }, (_, i) => login(i));
}

export default function (sessions) {
  readOnce(sessions[__VU % sessions.length]);
  sleep(1);
}
