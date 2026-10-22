"use client";

import { useEffect } from "react";
import { useAiPanelStore } from "@uniwork/core/ai";

type PageFocus = { kind: "task" | "meeting" | "document" | "project" | "room"; id: string; label: string };

/** Tells Ask UNI which object this page shows, so the composer offers it as a chip. Pass null while it loads. */
export function useAskUniPageContext(focus: PageFocus | null): void {
  const kind = focus?.kind;
  const id = focus?.id;
  const label = focus?.label;
  useEffect(() => {
    if (kind && id !== undefined && label !== undefined) useAiPanelStore.getState().setPage({ kind, id, label });
  }, [kind, id, label]);
  // The next page may already have set itself: clear only what is still this page's.
  useEffect(() => {
    if (!kind) return;
    return () => {
      const { page, setPage } = useAiPanelStore.getState();
      if (page?.kind === kind && page.id === id) setPage(null);
    };
  }, [kind, id]);
}
