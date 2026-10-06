import type { DesktopDraftStore } from "../drafts/store";

export type RestartRefusalCode = "checkpoint_failed" | "confirmation_required";

export class RestartUpdateError extends Error {
  readonly code: RestartRefusalCode;
  constructor(code: RestartRefusalCode, message: string) { super(message); this.name = "RestartUpdateError"; this.code = code; }
}

export interface RestartUpdateOptions {
  readonly drafts: Pick<DesktopDraftStore, "flushScheduled"> & Partial<Pick<DesktopDraftStore, "prepareForRestart" | "cancelRestart" | "migrateFormat">>;
  readonly targetDraftFormat?: 1 | 2;
  readonly confirmDrafts: () => Promise<boolean>;
  readonly restart: () => Promise<void>;
}

/** The update boundary is deliberately ordered: the durable pre-flight flush
 * (so a broken store is reported before the user is asked), the leave decision
 * (so a Save/keep choice can still write), the sealing checkpoint, then the
 * restart. A storage error never proceeds to restart. */
export async function restartToUpdate(options: RestartUpdateOptions): Promise<void> {
  try {
    if (options.targetDraftFormat !== undefined) {
      if (!options.drafts.migrateFormat) throw new Error("draft migration service is unavailable");
      await options.drafts.migrateFormat(options.targetDraftFormat);
    } else if (options.drafts.prepareForRestart) {
      await options.drafts.flushScheduled();
    }
    if (!await options.confirmDrafts()) throw new RestartUpdateError("confirmation_required", "local drafts must be confirmed before restarting");
    if (options.drafts.prepareForRestart) await options.drafts.prepareForRestart();
    else await options.drafts.flushScheduled();
  }
  catch (error) {
    options.drafts.cancelRestart?.();
    if (error instanceof RestartUpdateError) throw error;
    throw new RestartUpdateError("checkpoint_failed", error instanceof Error ? error.message : "draft checkpoint failed");
  }
  try { await options.restart(); }
  catch (error) {
    // A failed install or quit reopens draft writes; the sealed store must
    // never outlive the update attempt.
    options.drafts.cancelRestart?.();
    throw error;
  }
}
