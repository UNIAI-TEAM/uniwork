// C-01 §9.4 search baseline: trigram `?q=` over a workspace of 20k pages
// (documents-seed.sql, org perf-org-0). Target (staging): p95 < 200 ms.
// Queries are folded-text fragments of the seeded titles, with and without
// diacritics, so every request walks the gin_trgm index and the fold.
//
//   BASE_URL=http://localhost:8080 k6 run scripts/load/documents-search.k6.js
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE, session } from "./documents-lib.js";

const VUS = Number(__ENV.VUS || 50);
const QUERIES = ["kế hoạch", "bien ban hop", "ngân sách", "quy trinh", "đề xuất 12", "hop 1999", "quy 400"];

export const options = {
  stages: [
    { duration: "20s", target: VUS },
    { duration: __ENV.STEADY || "2m", target: VUS },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    "http_req_duration{name:document_search}": ["p(95)<200"],
    "checks{name:document_search}": ["rate>0.999"],
  },
};

export function setup() {
  // Users 0..199 share perf-org-0's workspace, where the 20k pages live.
  return Array.from({ length: VUS }, (_, i) => session(i));
}

export default function (sessions) {
  const s = sessions[(__VU - 1) % sessions.length];
  const q = QUERIES[(__VU + __ITER) % QUERIES.length];
  const res = http.get(
    `${BASE}/api/v1/workspaces/${s.workspaceId}/documents?q=${encodeURIComponent(q)}&limit=50`,
    { headers: s.headers, tags: { name: "document_search" } },
  );
  check(res, { "search 200": (r) => r.status === 200 }, { name: "document_search" });
  sleep(0.5);
}
