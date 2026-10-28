"use client";

import { useCallback, useRef } from "react";

/**
 * The trashed document a notification pointed at is scrolled to and focused
 * once per id, the first time its row shows. A row present on the first render
 * takes the keyboard; one that only comes in after the user pressed Load more
 * for that focus id (`pagedByUser` holds the id) is scrolled to and
 * highlighted, never focused.
 */
export function useFocusClaim() {
  const appliedFocus = useRef<string | null>(null);
  const pagedByUser = useRef<string | null>(null);
  const claimFocus = useCallback((documentId: string) => {
    if (appliedFocus.current === documentId) return null;
    appliedFocus.current = documentId;
    const mode = pagedByUser.current === documentId ? "reveal" : "focus";
    pagedByUser.current = null;
    return mode;
  }, []);
  return { claimFocus, pagedByUser };
}
