import http from "k6/http";
import { check, sleep } from "k6";

const base = __ENV.API_BASE_URL || "http://localhost:8080";
const token = __ENV.ACCESS_TOKEN || "";
const meetingId = __ENV.MEETING_ID || "";

export const options = {
  stages: [
    { duration: "30s", target: 20 },
    { duration: "1m", target: 100 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
};

export default function () {
  if (!token || !meetingId) {
    throw new Error("Set ACCESS_TOKEN and MEETING_ID");
  }
  const res = http.post(
    `${base}/api/v1/meetings/${meetingId}/join`,
    JSON.stringify({}),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  check(res, {
    "status 200": (r) => r.status === 200,
    "has decision": (r) => {
      try {
        return JSON.parse(r.body).decision !== undefined;
      } catch {
        return false;
      }
    },
  });
  sleep(1);
}
