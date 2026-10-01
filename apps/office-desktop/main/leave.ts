import type { LeaveChoice } from "../shared/ipc";

export type LeaveReason = "close" | "logout" | "update";

export interface LeaveRequest {
  readonly requestId: string;
  readonly reason: LeaveReason;
}

export interface LeaveResolution {
  readonly requestId: string;
  readonly choice: LeaveChoice;
  readonly proceeded: boolean;
}

export interface LeaveOutcome extends LeaveResolution {
  readonly code?: "timeout" | "busy" | "unconfirmed";
}

export interface DesktopLeaveCoordinatorOptions {
  /** Delivers the request to the renderer, which shows the ONE leave dialog. */
  readonly send: (request: LeaveRequest) => void;
  /** Main-side evidence checks for each choice. The renderer's `proceeded` is
   * never trusted alone: a keep must be a durable row main can see, a save must
   * be a receipt main observed after the request, and a discard must leave no
   * row for the live document. */
  readonly confirmKeep?: () => Promise<boolean>;
  readonly confirmSave?: (issuedAt: number) => Promise<boolean>;
  readonly confirmDiscard?: () => Promise<boolean>;
  readonly idFactory?: () => string;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

/** One non-queueing leave decision. Main asks the renderer, blocks any second
 * decision until the first settles, and fails closed (stay) on timeout. */
export function createDesktopLeaveCoordinator(options: DesktopLeaveCoordinatorOptions) {
  let pending: { requestId: string; settle: (value: LeaveResolution) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  let sequence = 0;
  const now = options.now ?? (() => Date.now());

  const nextId = () => options.idFactory?.() ?? `leave-${Date.now().toString(36)}-${++sequence}`;

  return Object.freeze({
    get busy(): boolean { return pending !== undefined; },
    async request(reason: LeaveReason): Promise<LeaveOutcome> {
      if (pending) return { requestId: pending.requestId, choice: "stay", proceeded: false, code: "busy" };
      const requestId = nextId();
      const issuedAt = now();
      let timedOut = false;
      const resolution = await new Promise<LeaveResolution>((resolve) => {
        const timer = setTimeout(() => { pending = undefined; timedOut = true; resolve({ requestId, choice: "stay", proceeded: false }); }, options.timeoutMs ?? 30_000);
        pending = { requestId, timer, settle: (value) => { clearTimeout(timer); pending = undefined; resolve(value); } };
        options.send({ requestId, reason });
      });
      if (!resolution.proceeded) return { requestId, choice: resolution.choice, proceeded: false, ...(timedOut ? { code: "timeout" as const } : {}) };
      const verifier = resolution.choice === "keep" ? options.confirmKeep
        : resolution.choice === "save" ? (options.confirmSave ? () => options.confirmSave!(issuedAt) : undefined)
        : resolution.choice === "discard" ? options.confirmDiscard
        : undefined;
      if (verifier && !(await verifier())) return { requestId, choice: "stay", proceeded: false, code: "unconfirmed" };
      return { requestId, choice: resolution.choice, proceeded: true };
    },
    /** Returns false for an unknown, stale or duplicate request id. */
    resolve(attempt: LeaveResolution): boolean {
      if (!pending || pending.requestId !== attempt.requestId) return false;
      pending.settle(attempt);
      return true;
    },
  });
}

export type DesktopLeaveCoordinator = ReturnType<typeof createDesktopLeaveCoordinator>;

/** IPC handler for the renderer's answer. The request id is the only key. */
export function createLeaveIpcHandler(leave: DesktopLeaveCoordinator) {
  return {
    "desktop:leave-resolved": (request: { readonly requestId: string; readonly choice: LeaveChoice; readonly proceeded: boolean }) => ({ resolved: leave.resolve(request) }),
  };
}
