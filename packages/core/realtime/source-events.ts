import type { QueryClient } from "@tanstack/react-query";
import { documentKeys } from "../documents/keys";
import type { WSEventType } from "../types/events";
import { createInvalidateScheduler } from "./invalidate-scheduler";

/**
 * The Documents home lists files other modules hold (chat, task attachments,
 * meeting recordings, email) from `documentKeys.sources`. Those files do not
 * produce `document.*` frames, so the sync hook refreshes the list on the
 * frames that mean "a source file appeared or went". The frames stay ids-only
 * (ADR 0015): they only mark the query stale, nothing from them is cached.
 *
 * - `now`: the frame always means a file change (a task attachment, a finished
 *   recording): the usual ~250 ms coalescing wave.
 * - `slow`: the frame MAY carry a file (any chat message, new mail — the
 *   payload cannot say), and these are the chattiest frames there are, so the
 *   refetch goes through a longer window; a burst costs one fetch.
 *
 * `recording.ready` is a `Scope: meeting` frame: only a socket that holds that
 * meeting open hears it, so a Documents home opened elsewhere catches a new
 * recording on its next refetch (window focus, see `useDocumentSources`).
 */
const SOURCES_INVALIDATE_MS = 5_000;

type SourcesWave = "now" | "slow";

export function sourcesWaveFor(
  wsId: string,
  type: WSEventType,
  payload: Record<string, string>,
): SourcesWave | null {
  switch (type) {
    case "attachment.uploaded":
    case "attachment.deleted":
      // Workspace-scoped; a frame stamped for another workspace is not ours.
      return payload.workspace_id && payload.workspace_id !== wsId ? null : "now";
    case "recording.ready":
      return "now";
    case "email_hub.new_mail":
      // Stamped with the workspace the mail account is linked to.
      return payload.workspace_id && payload.workspace_id !== wsId ? null : "slow";
    case "chat.message.created":
    case "chat.message.deleted":
      return "slow";
    default:
      return null;
  }
}

/**
 * The sync hook's side of it: `onFrame` marks the sources list stale for the
 * frames above (`now` through the hook's own scheduler, `slow` through a
 * window of its own), `dispose` stops the slow window with the subscription.
 */
export function createSourcesRefresher(
  qc: QueryClient,
  wsId: string,
  scheduler: Pick<ReturnType<typeof createInvalidateScheduler>, "schedule">,
) {
  const slow = createInvalidateScheduler(qc, SOURCES_INVALIDATE_MS);
  return {
    onFrame(type: WSEventType, payload: Record<string, string>) {
      const wave = sourcesWaveFor(wsId, type, payload);
      if (wave) (wave === "slow" ? slow : scheduler).schedule(documentKeys.sourcesRoot(wsId));
    },
    dispose: () => slow.dispose(),
  };
}
