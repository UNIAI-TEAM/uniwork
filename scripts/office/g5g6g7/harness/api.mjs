// G8-19 (UNI-1414) API sessions: one per seeded user, over the rows of
// api-contract.mjs G8_API_CALLS. A call answers {status, body, ok} for every
// HTTP status and {status: 0, error} for a network failure or timeout, so a row
// module asserts on what the server said instead of catching. Only programming
// errors (unknown row, wrong path params, a body key the row does not list)
// throw. Contract: g8-contract.md §5.
import { G8_API_CALLS, apiPath, assertBodyKeys, redact } from "./api-contract.mjs";
import { redactSignInError } from "./app-steps.mjs";

export const DEFAULT_API_TIMEOUT_MS = 30_000;

/** Error text safe for an artifact: no token, ticket, password or credential-looking run. */
function safeError(err) {
  const raw = err instanceof Error ? `${err.name === "TimeoutError" ? "timeout: " : ""}${err.message}` : String(err);
  return redactSignInError(redact(raw)) || "request failed";
}

/**
 * A session for `user` (a world user record; its `token` authorizes the calls).
 * @returns {{ user: object, userKey: string|null, call(name: string, pathParams?: object, body?: unknown, opts?: { query?: object, headers?: object, timeoutMs?: number }): Promise<{status: number, ok: boolean, body: unknown, error?: string}> }}
 */
export function session(user, { apiOrigin, fetchImpl = fetch } = {}) {
  if (!user || typeof user !== "object") throw new Error("session(user): a user record is required");
  if (!apiOrigin) throw new Error("session(user): apiOrigin is required");
  return {
    user,
    userKey: user.key ?? null,
    async call(name, pathParams = {}, body = undefined, { query = {}, headers = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS } = {}) {
      const spec = G8_API_CALLS[name];
      if (!spec) throw new Error(`unknown API call ${name}`);
      const path = apiPath(name, pathParams, G8_API_CALLS);
      if (body !== undefined) assertBodyKeys(name, body, G8_API_CALLS);
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
      }
      const qs = search.toString();
      const requestHeaders = { ...headers };
      if (user.token) requestHeaders.authorization = `Bearer ${user.token}`;
      if (body !== undefined) requestHeaders["content-type"] = "application/json";
      let res;
      try {
        res = await fetchImpl(`${apiOrigin}${path}${qs ? `?${qs}` : ""}`, {
          method: spec.method,
          headers: requestHeaders,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        return { status: 0, ok: false, body: null, error: safeError(err) };
      }
      let text = "";
      try {
        text = await res.text();
      } catch (err) {
        return { status: res.status, ok: false, body: null, error: safeError(err) };
      }
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { rawText: text };
        }
      }
      return { status: res.status, ok: res.ok, body: parsed };
    },
  };
}

/** `{ session(user) }` bound to one API origin. */
export function createApi({ apiOrigin, fetchImpl = fetch }) {
  return { session: (user) => session(user, { apiOrigin, fetchImpl }) };
}
