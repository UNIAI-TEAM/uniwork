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

/** The update boundary is deliberately ordered: durable checkpoint, explicit
 * confirmation, then restart. A storage error never proceeds to restart. */
export async function restartToUpdate(options: RestartUpdateOptions): Promise<void> {
  try {
    if (options.targetDraftFormat !== undefined) {
      if (!options.drafts.migrateFormat) throw new Error("draft migration service is unavailable");
      await options.drafts.migrateFormat(options.targetDraftFormat);
    }
    if (options.drafts.prepareForRestart) await options.drafts.prepareForRestart();
    else await options.drafts.flushScheduled();
  }
  catch (error) { throw new RestartUpdateError("checkpoint_failed", error instanceof Error ? error.message : "draft checkpoint failed"); }
  try {
    if (!await options.confirmDrafts()) throw new RestartUpdateError("confirmation_required", "local drafts must be confirmed before restarting");
    await options.restart();
  } catch (error) {
    options.drafts.cancelRestart?.();
    throw error;
  }
}
