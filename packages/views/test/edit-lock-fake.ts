import { vi } from "vitest";

// The edit-lock routes (UNI-1645, R1-R10) as the contract's fake server
// answers them (contract-UNI-1645-a §9): every views test that opens an
// editable document gets the lock by default, so suites about something else
// keep typing. A test about the lock replaces `editLockRoute` (or wraps
// `defaultEditLockRoute`) to play another holder, a 423 or a lost heartbeat.

const EDIT_LOCK_PATH = /^\/api\/v1\/documents\/([^/]+)\/(edit-lock|edit-requests)(\/.*)?$/;

export const grantedLock = (documentId: string, over: Record<string, unknown> = {}) => ({
  lock_id: `lock-${documentId}`,
  document_id: documentId,
  holder_id: "me",
  client: "web_page",
  acquired_at: "2026-10-15T03:12:00Z",
  expires_at: "2026-10-15T03:14:00Z",
  granted_via: "acquire",
  heartbeat_interval_ms: 30_000,
  ttl_ms: 120_000,
  server_time: "2026-10-15T03:12:00Z",
  ...over,
});

export const lockState = (over: Record<string, unknown> = {}) => ({
  lock: null,
  my_request: null,
  pending_requests: [],
  can_take_over: false,
  can_request: false,
  server_time: "2026-10-15T03:12:00Z",
  ...over,
});

type Opts = { method?: string; body?: unknown } | undefined;

/** Free document: R1 reads no holder, R2 grants, heartbeats keep it, release and cancel are 204. */
export function defaultEditLockRoute(path: string, opts: Opts): Promise<unknown> {
  const match = EDIT_LOCK_PATH.exec(path)!;
  const documentId = decodeURIComponent(match[1]!);
  const method = opts?.method ?? "GET";
  const rest = match[3] ?? "";
  if (match[2] === "edit-lock" && !rest) {
    return Promise.resolve(method === "GET" ? lockState() : grantedLock(documentId));
  }
  if (rest.endsWith("/heartbeat")) {
    return Promise.resolve({ lock_id: rest.split("/")[1], expires_at: "2026-10-15T03:16:00Z", server_time: "2026-10-15T03:14:00Z" });
  }
  return Promise.resolve(undefined);
}

/** The lock routes' answer for this test; reset to the default after each test. */
export const editLockRoute = vi.fn(defaultEditLockRoute);

export function isEditLockPath(path: unknown): path is string {
  return typeof path === "string" && EDIT_LOCK_PATH.test(path);
}
