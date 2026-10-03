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

/** Main-observed evidence for a leave dialog's Save choice. */
export function isLeaveSaveConfirmed(evidence: {
  readonly draftRows: number | null;
  readonly saveBusy: boolean;
  readonly lastConfirmedSaveAt: number;
  readonly issuedAt: number;
}): boolean {
  if (evidence.draftRows === null) return false;
  if (evidence.draftRows === 0) return !evidence.saveBusy;
  return evidence.lastConfirmedSaveAt >= evidence.issuedAt;
}

export interface DesktopLeaveCoordinatorOptions {
  /** Delivers the request to the renderer, which shows the ONE leave dialog. */
  readonly send: (request: LeaveRequest) => void;
  /** Main-side evidence checks for each choice. The renderer's `proceeded` is
   * never trusted alone: Keep requires a successful main read of the live
   * draft state, Save requires a receipt main observed after the request, and
   * Discard must leave no row for the live document. */
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
  let pending: { requestId: string; settle?: (value: LeaveResolution) => void } | undefined;
  let sequence = 0;
  const now = options.now ?? (() => Date.now());

  const nextId = () => options.idFactory?.() ?? `leave-${Date.now().toString(36)}-${++sequence}`;

  return Object.freeze({
    get busy(): boolean { return pending !== undefined; },
    async request(reason: LeaveReason): Promise<LeaveOutcome> {
      if (pending) return { requestId: pending.requestId, choice: "stay", proceeded: false, code: "busy" };
      const requestId = nextId();
      const issuedAt = now();
      return new Promise<LeaveOutcome>((resolve) => {
        let finished = false;
        const finish = (outcome: LeaveOutcome) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          pending = undefined;
          resolve(outcome);
        };
        // The deadline covers both the renderer answer and main verification.
        const timer = setTimeout(() => finish({ requestId, choice: "stay", proceeded: false, code: "timeout" }), options.timeoutMs ?? 30_000);
        pending = { requestId, settle: (resolution) => {
          void (async () => {
            // `stay` is never a proceed, whatever the renderer claims.
            if (resolution.choice === "stay" || !resolution.proceeded) {
              finish({ requestId, choice: resolution.choice, proceeded: false });
              return;
            }
            const verifier = resolution.choice === "keep" ? options.confirmKeep
              : resolution.choice === "save" ? (options.confirmSave ? () => options.confirmSave!(issuedAt) : undefined)
              : resolution.choice === "discard" ? options.confirmDiscard
              : undefined;
            try {
              if (verifier && !(await verifier())) {
                finish({ requestId, choice: "stay", proceeded: false, code: "unconfirmed" });
                return;
              }
              finish({ requestId, choice: resolution.choice, proceeded: true });
            } catch {
              finish({ requestId, choice: "stay", proceeded: false, code: "unconfirmed" });
            }
          })();
        } };
        try { options.send({ requestId, reason }); }
        catch { finish({ requestId, choice: "stay", proceeded: false, code: "unconfirmed" }); }
      });
    },
    /** Returns false for an unknown, stale or duplicate request id. */
    resolve(attempt: LeaveResolution): boolean {
      if (!pending?.settle || pending.requestId !== attempt.requestId) return false;
      const settle = pending.settle;
      pending.settle = undefined;
      settle(attempt);
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
