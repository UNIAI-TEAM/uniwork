// Shared helpers for the k6 scenarios. The dataset comes from
// `go run ./cmd/seed` (server/cmd/seed): user<N>@perf.local / password123,
// one workspace per organization, users spread evenly across organizations.
import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const USERS = Number(__ENV.SEED_USERS || 5000);

export function login(i) {
  const res = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ email: `user${i % USERS}@perf.local`, password: "password123" }),
    { headers: { "Content-Type": "application/json" }, tags: { name: "login" } },
  );
  check(res, { "login 200": (r) => r.status === 200 });
  const token = res.json("access_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
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

/** Default workspace channel + message page (creates the room on first GET /chat/room). */
export function chatReadOnce(s) {
  const opts = (name) => ({ headers: s.headers, tags: { name, kind: "read" } });
  const ws = s.workspaceId;
  check(http.get(`${BASE}/api/v1/workspaces/${ws}/chat/rooms`, opts("chat_rooms")), {
    "chat rooms 200": (r) => r.status === 200,
  });
  const roomRes = http.get(`${BASE}/api/v1/workspaces/${ws}/chat/room`, opts("chat_room"));
  check(roomRes, { "chat room 200": (r) => r.status === 200 });
  const roomId = roomRes.json("room_id");
  if (roomId) {
    check(
      http.get(`${BASE}/api/v1/workspaces/${ws}/chat/rooms/${roomId}/messages?limit=50`, opts("chat_messages")),
      { "chat messages 200": (r) => r.status === 200 },
    );
  }
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
