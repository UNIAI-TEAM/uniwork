"use client";

import { useCallback, useState } from "react";
import { useAskAttachments, type AskFileRefusal } from "@uniwork/core/ai/attachments";

/**
 * The composer's staged files plus why the last picked, dropped or pasted ones
 * were refused: the panel owns it, so a drop on the dock and a pick in the
 * composer show their reasons in the same chip row.
 */
export function useAskUniAttachments(wsId: string) {
  const staged = useAskAttachments(wsId);
  const { add, clear } = staged;
  const [refused, setRefused] = useState<AskFileRefusal[]>([]);
  // Each distinct reason once, and a new batch replaces the last one's.
  const attach = useCallback((files: File[]) => setRefused([...new Set(add(files))]), [add]);
  const clearAll = useCallback(() => {
    clear();
    setRefused([]);
  }, [clear]);
  return { ...staged, clear: clearAll, refused, attach };
}

export type AskUniAttachments = ReturnType<typeof useAskUniAttachments>;
