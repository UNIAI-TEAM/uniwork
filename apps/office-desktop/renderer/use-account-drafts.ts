import { useEffect, useState } from "react";
import { desktopDraftDiscardResponseSchema, desktopDraftListResponseSchema, type DesktopDraftMetadata } from "../shared/ipc";
import type { RendererBridge } from "./app";
import type { DesktopRecoveryState } from "./recovery-status";

/** Scope-level restart offer; document sessions use their own scoped requests.
 * Signed out the same offer serves the local device scope. A locked key store
 * is a typed `locked` result, never an error to guess at. */
export function useAccountDrafts(bridge: RendererBridge, enabled = true) {
  const [draft, setDraft] = useState<DesktopDraftMetadata | null>(null);
  const [blocked, setBlocked] = useState<DesktopRecoveryState | null>(null);
  const read = async () => {
    const result = desktopDraftListResponseSchema.parse(await bridge.call("desktop:draft-list", { sessionGeneration: "desktop-dev-session" }));
    if (result.locked) return { draft: null, blocked: "locked" as DesktopRecoveryState };
    return { draft: [...result.drafts].sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null, blocked: null };
  };
  useEffect(() => {
    if (!enabled) {
      setDraft(null);
      setBlocked(null);
      return;
    }
    let active = true;
    void read().then((next) => { if (active) { setDraft(next.draft); setBlocked(next.blocked); } }).catch((error: unknown) => {
      if (!active) return;
      const code = (error as { code?: string } | null)?.code;
      setBlocked(code === "draft_recovery_locked" ? "locked" : code === "storage_unavailable" ? "unavailable" : null);
      setDraft(null);
    });
    return () => { active = false; };
  // The read action is local to this scope's bridge subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, enabled]);
  return {
    draft, blocked,
    dismiss: () => setDraft(null),
    async discard() {
      if (!draft) return false;
      try {
        desktopDraftDiscardResponseSchema.parse(await bridge.call("desktop:draft-discard", { sessionGeneration: "desktop-dev-session", draftId: draft.draftId, generation: draft.generation }));
        const next = await read();
        setDraft(next.draft);
        setBlocked(next.blocked);
        return true;
      } catch { return false; }
    },
  };
}
