// Shared helpers for the documents k6 scenarios (C-01 §9.4, G1-09). The
// dataset is `go run ./cmd/seed --orgs 2 --users 400 --tasks 0` plus
// scripts/load/documents-seed.sql; see scripts/load/README.md. The server
// needs FF_DOCUMENTS=true.
import http from "k6/http";
import { check } from "k6";

export const BASE = __ENV.BASE_URL || "http://localhost:8080";

// The API rate-limits per client IP and path (middleware.RateLimit). Every
// simulated user gets its own address, which the server honours only when
// TRUSTED_PROXIES covers the k6 host (127.0.0.1/32 locally) - otherwise all
// VUs share one budget and the run measures 429s, not the documents path.
function clientIP(i) {
  return `10.77.${(i >> 8) & 255}.${i & 255}`;
}

// Logs in user<i>@perf.local and returns its headers and its first
// workspace (the seed gives every user exactly one).
export function session(i) {
  const base = { "Content-Type": "application/json", "X-Forwarded-For": clientIP(i) };
  const res = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ email: `user${i}@perf.local`, password: "password123" }),
    { headers: base, tags: { name: "login" } },
  );
  check(res, { "login 200": (r) => r.status === 200 });
  const headers = { ...base, Authorization: `Bearer ${res.json("access_token")}` };
  const ws = http.get(`${BASE}/api/v1/workspaces`, { headers, tags: { name: "workspaces" } });
  return {
    headers,
    workspaceId: ws.json("workspaces.0.id"),
    organizationId: ws.json("workspaces.0.organization_id"),
  };
}

// A ProseMirror page of about `bytes` bytes of JSON: 2 KiB paragraphs.
export function pageOfSize(bytes, seed) {
  const para = `Đoạn ${seed} `.padEnd(2000, "nội dung tự lưu ");
  const n = Math.max(1, Math.round(bytes / (para.length + 60)));
  const content = [];
  for (let i = 0; i < n; i++) {
    content.push({ type: "paragraph", content: [{ type: "text", text: `${i} ${para}` }] });
  }
  return { type: "doc", content };
}
