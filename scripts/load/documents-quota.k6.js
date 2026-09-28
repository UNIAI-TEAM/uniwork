// C-01 §9.4 storage quota baseline: CountStorageBytesInOrganization over an
// organization holding 100k document rows (documents-seed.sql, org
// perf-org-1). The HTTP path that computes it on every call is the
// entitlement snapshot (GET /orgs/{id}/billing), which also counts members,
// workspaces and tasks, so the HTTP number is an upper bound; the query
// alone is timed with EXPLAIN ANALYZE (scripts/load/README.md). Target: the
// query < 50 ms.
//
//   BASE_URL=http://localhost:8080 k6 run scripts/load/documents-quota.k6.js
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE, session } from "./documents-lib.js";

const VUS = Number(__ENV.VUS || 10);
// perf-org-1 is users 200..399 with `--orgs 2 --users 400`.
const FIRST_USER = Number(__ENV.FIRST_USER || 200);

export const options = {
  vus: VUS,
  duration: __ENV.DURATION || "1m",
  thresholds: {
    "http_req_duration{name:storage_quota}": ["p(95)<50"],
    "checks{name:storage_quota}": ["rate>0.999"],
  },
};

export function setup() {
  return Array.from({ length: VUS }, (_, i) => session(FIRST_USER + i));
}

export default function (sessions) {
  const s = sessions[(__VU - 1) % sessions.length];
  const res = http.get(`${BASE}/api/v1/orgs/${s.organizationId}/billing`, {
    headers: s.headers,
    tags: { name: "storage_quota" },
  });
  check(
    res,
    {
      "billing 200": (r) => r.status === 200,
      "storage.bytes counted": (r) => r.body.includes("storage.bytes"),
    },
    { name: "storage_quota" },
  );
  sleep(0.25);
}
