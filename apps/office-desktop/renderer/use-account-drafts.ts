import { useEffect, useState } from "react";
import { desktopDraftDiscardResponseSchema, desktopDraftListResponseSchema, type DesktopDraftMetadata } from "../shared/ipc";
import type { RendererBridge } from "./app";
import type { DesktopRecoveryState } from "./recovery-status";

/** Account-level restart offer; document sessions use their own scoped requests. */
export function useAccountDrafts(bridge: RendererBridge) {
  const [draft, setDraft] = useState<DesktopDraftMetadata | null>(null);
  const [blocked, setBlocked] = useState<DesktopRecoveryState | null>(null);
  const read = async () => {
    const result = desktopDraftListResponseSchema.parse(await bridge.call("desktop:draft-list", { sessionGeneration: "desktop-dev-session" }));
    return [...result.drafts].sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  };
  useEffect(() => {
    let active = true;
    void read().then((next) => { if (active) { setDraft(next); setBlocked(null); } }).catch((error: unknown) => {
      if (!active) return;
      const code = (error as { code?: string } | null)?.code;
      setBlocked(code === "draft_recovery_locked" ? "locked" : code === "storage_unavailable" ? "unavailable" : null);
      setDraft(null);
    });
    return () => { active = false; };
  // The read action is local to this account's bridge subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);
  return {
    draft, blocked,
    dismiss: () => setDraft(null),
    async discard() {
      if (!draft) return false;
      try {
        desktopDraftDiscardResponseSchema.parse(await bridge.call("desktop:draft-discard", { sessionGeneration: "desktop-dev-session", draftId: draft.draftId, generation: draft.generation }));
        setDraft(await read());
        return true;
      } catch { return false; }
    },
  };
}
