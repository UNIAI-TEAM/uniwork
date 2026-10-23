// What the realtime provider does when the server ends the socket's session
// (ws-client.ts › onSessionEnded). Pure, so the policy is tested in node:
//   close 4001 / pre-auth "invalid token" → refresh the session: a token
//     redials now, null (signed out) disconnects, a transient failure (a dead
//     spot, a 5xx) retries on the 2/5/15/60 s backoff instead of
//     leaving the socket down until the next foreground return;
//   "too many connections" → the server is shedding: redial on the backoff;
//   any other refusal (not a member) → down until the next foreground return
//     or network edge, which redial on their own.
// reset() runs once the socket is online again, and on unmount.
import { retryDelay } from "../retry-timers";

export interface SocketRecoveryDeps {
  refreshSession: () => Promise<string | null>;
  reconnect: () => void;
  disconnect: () => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  random?: () => number;
}

/** Refusals the server gives while busy: worth another try later. */
const SHEDDING = new Set(["too many connections"]);

export function createSocketRecovery(deps: SocketRecoveryDeps) {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function later(run: () => void): void {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      run();
    }, retryDelay(attempt++, deps.random));
  }

  function refresh(): void {
    deps.refreshSession().then(
      (token) => (token ? deps.reconnect() : deps.disconnect()),
      (error: unknown) => {
        deps.warn("refresh failed after 4001, retrying", { error: error instanceof Error ? error.name : typeof error, attempt });
        later(refresh);
      },
    );
  }

  return {
    sessionEnded(error?: string): void {
      if (error === undefined || error === "invalid token") {
        refresh();
        return;
      }
      if (SHEDDING.has(error)) {
        deps.warn("socket refused, retrying", { error });
        later(deps.reconnect);
        return;
      }
      deps.warn("socket refused, waiting for the next foreground return", { error });
    },
    reset(): void {
      if (timer) clearTimeout(timer);
      timer = null;
      attempt = 0;
    },
  };
}
