// C-01 §9.4 autosave baseline: 200 users each autosave their own 200 KiB page
// every 2 s. Target (staging): PATCH p95 < 150 ms, no 5xx; a 422
// revision_conflict would mean two VUs share a page (they never do here).
// Each save carries the revision the previous one returned, like the editor.
//
//   BASE_URL=http://localhost:8080 k6 run scripts/load/documents-autosave.k6.js
//   (VUS, STEADY, PAGE_BYTES override the defaults for a smaller host)
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE, pageOfSize, session } from "./documents-lib.js";

const VUS = Number(__ENV.VUS || 200);
const PAGE_BYTES = Number(__ENV.PAGE_BYTES || 200 * 1024);

export const options = {
  setupTimeout: "10m",
  stages: [
    { duration: __ENV.RAMP || "30s", target: VUS },
    { duration: __ENV.STEADY || "3m", target: VUS },
    { duration: "15s", target: 0 },
  ],
  thresholds: {
    "http_req_duration{name:document_save}": ["p(95)<150"],
    "checks{name:document_save}": ["rate>0.999"],
  },
};

export function setup() {
  const pages = [];
  for (let i = 0; i < VUS; i++) {
    const s = session(i);
    const created = http.post(
      `${BASE}/api/v1/workspaces/${s.workspaceId}/documents`,
      JSON.stringify({ kind: "page", title: `k6 autosave ${i}` }),
      { headers: s.headers, tags: { name: "document_create" } },
    );
    check(created, { "create 201": (r) => r.status === 201 });
    pages.push({ headers: s.headers, id: created.json("document.id"), revision: created.json("document.revision") });
  }
  return pages;
}

let revision = null;

export default function (pages) {
  const p = pages[(__VU - 1) % pages.length];
  if (revision === null) revision = p.revision;
  const body = JSON.stringify({ revision, content: pageOfSize(PAGE_BYTES, `${__VU}-${__ITER}`) });
  const res = http.patch(`${BASE}/api/v1/documents/${p.id}`, body, {
    headers: p.headers,
    tags: { name: "document_save" },
  });
  const ok = check(res, { "save 200": (r) => r.status === 200 }, { name: "document_save" });
  if (ok) {
    revision = res.json("document.revision");
  } else if (res.status === 422) {
    revision = res.json("error.fields.current_revision") || revision;
  }
  sleep(2);
}
