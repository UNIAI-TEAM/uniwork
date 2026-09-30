import type { CheckpointResult, DraftRecoveryAdapter, DraftIdentity, DraftSession, DraftLookup, RecoveryResult } from "../../../packages/core/office/draft-recovery";

export type LifecycleReason = "close" | "logout" | "update";
export type LifecycleChoice = "save" | "keep-draft" | "discard" | "stay";

export type LifecycleResult =
  | { readonly status: "proceed"; readonly choice: LifecycleChoice; readonly reason: LifecycleReason }
  | { readonly status: "stay"; readonly reason: LifecycleReason; readonly code?: "save_in_progress" | "save_failed" | "draft_not_durable" | "discard_failed" };

export interface LifecycleSaveResult {
  readonly accepted: boolean;
  readonly reason?: string;
}

export interface DesktopLifecycleOptions {
  readonly save: () => Promise<LifecycleSaveResult>;
  readonly checkpoint: () => Promise<CheckpointResult | void>;
  readonly discard: () => Promise<void>;
}

/** Coordinates close/logout/update prompts. The host must supply the user's
 * choice; no lifecycle path silently uploads or discards bytes. */
export function createDesktopLifecycleCoordinator(options: DesktopLifecycleOptions) {
  let inFlight = false;

  return Object.freeze({
    get busy(): boolean { return inFlight; },
    async resolve(reason: LifecycleReason, dirty: boolean, choice: LifecycleChoice): Promise<LifecycleResult> {
      if (!dirty) return { status: "proceed", choice: "stay", reason };
      if (choice === "stay") return { status: "stay", reason };
      if (inFlight) return { status: "stay", reason, code: "save_in_progress" };
      inFlight = true;
      try {
        if (choice === "save") {
          const result = await options.save();
          if (!result.accepted) return { status: "stay", reason, code: result.reason === "saving" ? "save_in_progress" : "save_failed" };
        } else if (choice === "keep-draft") {
          try {
            const result = await options.checkpoint();
            if (result && result.status !== "stored" && result.status !== "unchanged") return { status: "stay", reason, code: "draft_not_durable" };
          } catch { return { status: "stay", reason, code: "draft_not_durable" }; }
        } else {
          try { await options.discard(); }
          catch { return { status: "stay", reason, code: "discard_failed" }; }
        }
        return { status: "proceed", choice, reason };
      } finally { inFlight = false; }
    },
  });
}

export type RecoveryAction = "export" | "copy" | "clipboard";

/** Blocked drafts have no byte-producing escape hatch. This helper is shared
 * by menu/button handlers so a new export action cannot accidentally bypass
 * the recovery state. */
export function assertRecoveryActionAllowed(result: RecoveryResult, _action: RecoveryAction): void {
  if (result.status === "blocked" || result.status === "locked") {
    const error = new Error("draft operation refused") as Error & { code: string };
    error.code = "draft_recovery_locked";
    throw error;
  }
}

/** Convenience recovery wrapper that keeps the identity/session pair in main. */
export async function recoverDraft(options: {
  readonly adapter: DraftRecoveryAdapter;
  readonly session: DraftSession;
  readonly lookup: DraftLookup;
  readonly currentBase: DraftIdentity["base"];
  readonly liveAccess: "edit" | "none";
}): Promise<RecoveryResult> {
  return options.adapter.recover({ session: options.session, lookup: options.lookup, currentBase: options.currentBase, liveAccess: options.liveAccess });
}
