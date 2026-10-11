// C-11 §9 performance gate: one-step Work Graph neighbors of a task at about
// 1M edges, p95 < 200 ms. Dataset: `go run ./cmd/seed --orgs 1 --users 200
// --tasks 200000` plus scripts/load/graph-seed.sql (~5 edges per task). The
// API needs graph_ui on for that organization (FF_GRAPH_UI=true); see
// scripts/load/README.md, "Work Graph". Run by hand, not in CI.
//
//   BASE_URL=http://localhost:8080 k6 run scripts/load/graph-neighbors.k6.js
import http from "k6/http";
import { check, sleep } from "k6";
import { login } from "./perf-lib.js";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const VUS = Number(__ENV.VUS || 50);
const MAX_IDS = 500;
const PAGE = 200;

export const options = {
  stages: [
    { duration: "20s", target: VUS },
    { duration: __ENV.STEADY || "2m", target: VUS },
    { duration: "10s", target: 0 },
  ],
  thresholds: { http_req_duration: ["p(95)<200"], checks: ["rate>0.99"] },
};

// user0@perf.local owns the load organization's only workspace. The ids come
// from the paged tasks/query (at most 200 a page): GET .../tasks has no limit
// and would return every task, 120 MB at 200k.
export function setup() {
  const s = login(0);
  const ids = [];
  for (let offset = 0; ids.length < MAX_IDS; offset += PAGE) {
    const res = http.post(
      `${BASE}/api/v1/workspaces/${s.workspaceId}/tasks/query`,
      JSON.stringify({ limit: PAGE, offset }),
      { headers: s.headers, tags: { name: "task_ids" } },
    );
    const page = res.json("tasks.#.id") || [];
    ids.push(...page);
    if (page.length < PAGE) break;
  }
  if (ids.length === 0) throw new Error("the load workspace has no tasks");
  return { headers: s.headers, workspaceId: s.workspaceId, ids: ids.slice(0, MAX_IDS) };
}

export default function ({ headers, workspaceId, ids }) {
  const id = ids[(__VU * 31 + __ITER) % ids.length];
  const res = http.get(
    `${BASE}/api/v1/workspaces/${workspaceId}/graph/nodes/TASK/${id}/neighbors?limit=50`,
    { headers, tags: { name: "graph_neighbors" } },
  );
  check(res, { "200": (r) => r.status === 200 });
  sleep(0.5);
}
