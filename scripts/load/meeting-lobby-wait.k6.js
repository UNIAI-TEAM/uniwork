import http from "k6/http";
import { check, sleep } from "k6";

const base = __ENV.API_BASE_URL || "http://localhost:8080";
const token = __ENV.ACCESS_TOKEN || "";
const meetingId = __ENV.MEETING_ID || "";

export const options = {
  vus: 50,
  duration: "2m",
  thresholds: {
    http_req_failed: ["rate<0.05"],
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
    "no server error": (r) => r.status < 500,
    "waiting or deny": (r) => {
      if (r.status !== 200) return true;
      try {
        const d = JSON.parse(r.body).decision;
        return d === "WAITING_FOR_HOST" || d === "WAITING_APPROVAL" || d === "DENY";
      } catch {
        return false;
      }
    },
  });
  sleep(4);
}
