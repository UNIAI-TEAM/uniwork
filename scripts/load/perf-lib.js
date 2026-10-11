// Shared helpers for the k6 scenarios. The dataset comes from
// `go run ./cmd/seed` (server/cmd/seed): user<N>@perf.local / password123,
// one workspace per organization, users spread evenly across organizations.
import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const USERS = Number(__ENV.SEED_USERS || 5000);

// Login is budgeted per client IP (60/min). Each user gets its own address,
// which the server honours only when TRUSTED_PROXIES covers the k6 host;
// without it setup() spends the budget after 60 users and measures 429s.
function clientIP(i) {
  return `10.66.${(i >> 8) & 255}.${i & 255}`;
}

export function login(i) {
  const u = i % USERS;
  const base = { "Content-Type": "application/json", "X-Forwarded-For": clientIP(u) };
  const res = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ email: `user${u}@perf.local`, password: "password123" }),
    { headers: base, tags: { name: "login" } },
  );
  check(res, { "login 200": (r) => r.status === 200 });
  const token = res.json("access_token");
  const headers = { ...base, Authorization: `Bearer ${token}` };
  const ws = http.get(`${BASE}/api/v1/workspaces`, { headers, tags: { name: "workspaces" } });
  const workspaceId = ws.json("workspaces.0.id");
  return { headers, workspaceId };
}

export const readThresholds = {
  http_req_failed: ["rate<0.001"],
  "http_req_duration{kind:read}": ["p(95)<200"],
};

export const writeThresholds = {
  http_req_failed: ["rate<0.001"],
  "http_req_duration{kind:read}": ["p(95)<200"],
  "http_req_duration{kind:write}": ["p(95)<400"],
};

export function readOnce(s) {
  const opts = (name) => ({ headers: s.headers, tags: { name, kind: "read" } });
  check(http.get(`${BASE}/api/v1/me`, opts("me")), { "me 200": (r) => r.status === 200 });
  check(http.get(`${BASE}/api/v1/workspaces/${s.workspaceId}/tasks?limit=50`, opts("tasks")), {
    "tasks 200": (r) => r.status === 200,
  });
}

/** Sidebar, default workspace channel and its first message page (the seed creates the channel). */
export function chatReadOnce(s) {
  const opts = (name) => ({ headers: s.headers, tags: { name, kind: "read" } });
  const ws = s.workspaceId;
  check(http.get(`${BASE}/api/v1/workspaces/${ws}/chat/rooms`, opts("chat_rooms")), {
    "chat rooms 200": (r) => r.status === 200,
  });
  const roomRes = http.get(`${BASE}/api/v1/workspaces/${ws}/chat/room`, opts("chat_room"));
  const roomId = roomRes.json("room_id");
  check(roomRes, { "chat room 200": (r) => r.status === 200, "chat room seeded": () => Boolean(roomId) });
  // Never skipped: a missing room is a broken dataset and must fail the run
  // (the 404 counts in http_req_failed), not quietly drop the message read.
  check(
    http.get(`${BASE}/api/v1/workspaces/${ws}/chat/rooms/${roomId}/messages?limit=50`, opts("chat_messages")),
    { "chat messages 200": (r) => r.status === 200 },
  );
}

export function writeOnce(s) {
  const opts = (name, kind) => ({ headers: s.headers, tags: { name, kind } });
  const created = http.post(
    `${BASE}/api/v1/workspaces/${s.workspaceId}/tasks`,
    JSON.stringify({ title: `k6 ${Date.now()}` }),
    opts("task_create", "write"),
  );
  check(created, { "create 2xx": (r) => r.status === 200 || r.status === 201 });
  const id = created.json("task.id");
  if (id) {
    check(
      http.patch(`${BASE}/api/v1/tasks/${id}`, JSON.stringify({ status: "in_progress" }), opts("task_update", "write")),
      { "update 200": (r) => r.status === 200 },
    );
  }
}
