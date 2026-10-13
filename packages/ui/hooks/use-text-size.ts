"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_TEXT_SIZE,
  TEXT_SIZE_STORAGE_KEY,
  applyTextSize,
  readStoredTextSize,
  type TextSize,
} from "../lib/text-size";

/**
 * Reads and writes the text size. Mirrors `useAccent`: the boot script already
 * applied the stored level before React ran, so this hook starts on the
 * default and syncs on mount rather than reading localStorage during render,
 * which would mismatch the server HTML. It writes the DOM only when the user
 * picks, or when another tab does (the `storage` listener).
 */
export function useTextSize(): { textSize: TextSize; setTextSize: (next: TextSize) => void } {
  const [textSize, setTextSizeState] = useState<TextSize>(DEFAULT_TEXT_SIZE);

  useEffect(() => {
    setTextSizeState(readStoredTextSize());
    const onStorage = (event: StorageEvent) => {
      if (event.key !== TEXT_SIZE_STORAGE_KEY) return;
      const next = readStoredTextSize();
      setTextSizeState(next);
      applyTextSize(next, document.documentElement);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTextSize = useCallback((next: TextSize) => {
    setTextSizeState(next);
    applyTextSize(next, document.documentElement);
    try {
      window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, next);
    } catch {
      // Blocked storage: the size still applies for this session.
    }
  }, []);

  return { textSize, setTextSize };
}
