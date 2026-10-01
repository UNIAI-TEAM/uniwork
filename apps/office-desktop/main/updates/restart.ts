import type { DesktopDraftStore } from "../drafts/store";

export type RestartRefusalCode = "checkpoint_failed" | "confirmation_required";

export class RestartUpdateError extends Error {
  readonly code: RestartRefusalCode;
  constructor(code: RestartRefusalCode, message: string) { super(message); this.name = "RestartUpdateError"; this.code = code; }
}

export interface RestartUpdateOptions {
  readonly drafts: Pick<DesktopDraftStore, "flushScheduled">;
  readonly confirmDrafts: () => Promise<boolean>;
  readonly restart: () => Promise<void>;
}

/** The update boundary is deliberately ordered: durable checkpoint, explicit
 * confirmation, then restart. A storage error never proceeds to restart. */
export async function restartToUpdate(options: RestartUpdateOptions): Promise<void> {
  try { await options.drafts.flushScheduled(); }
  catch (error) { throw new RestartUpdateError("checkpoint_failed", error instanceof Error ? error.message : "draft checkpoint failed"); }
  if (!await options.confirmDrafts()) throw new RestartUpdateError("confirmation_required", "local drafts must be confirmed before restarting");
  await options.restart();
}
