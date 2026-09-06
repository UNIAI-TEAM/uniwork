// 200 VU, 80% reads / 20% task create+update for 5 minutes. Write p95 ≤ 400 ms.
import { sleep } from "k6";
import { login, readOnce, writeOnce, writeThresholds } from "./perf-lib.js";

export const options = {
  stages: [{ duration: "1m", target: 200 }, { duration: "3m", target: 200 }, { duration: "1m", target: 0 }],
  thresholds: writeThresholds,
};

export function setup() {
  return Array.from({ length: 200 }, (_, i) => login(i * 11));
}

export default function (sessions) {
  const s = sessions[__VU % sessions.length];
  if (__ITER % 5 === 0) {
    writeOnce(s);
  } else {
    readOnce(s);
  }
  sleep(1);
}
