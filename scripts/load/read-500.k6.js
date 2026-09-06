// 500 VU reads for 5 minutes: the mandatory nightly bar at the end of
// phase F (OPEN_QUESTIONS O5). Thresholds fail the job.
import { sleep } from "k6";
import { login, readOnce, readThresholds } from "./perf-lib.js";

export const options = {
  stages: [{ duration: "1m", target: 500 }, { duration: "3m", target: 500 }, { duration: "1m", target: 0 }],
  thresholds: readThresholds,
};

export function setup() {
  return Array.from({ length: 500 }, (_, i) => login(i * 7));
}

export default function (sessions) {
  readOnce(sessions[__VU % sessions.length]);
  sleep(1);
}
