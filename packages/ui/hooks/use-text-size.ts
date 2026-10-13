"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_TEXT_SIZE,
  TEXT_SIZE_STORAGE_KEY,
  applyTextSize,
  isTextSize,
  readStoredTextSize,
  type TextSize,
} from "../lib/text-size";

/**
 * Reads and writes the text size. The boot script already applied the stored
 * level before React ran, so this hook starts on the default and syncs on
 * mount rather than reading during render, which would mismatch the server
 * HTML. It syncs from <html>, not storage: with storage blocked a pick lives
 * only on the attribute, and reading storage would check Default while the
 * page is larger. It writes the DOM only when the user picks, or when another
 * tab does (the `storage` listener).
 */
export function useTextSize(): { textSize: TextSize; setTextSize: (next: TextSize) => void } {
  const [textSize, setTextSizeState] = useState<TextSize>(DEFAULT_TEXT_SIZE);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-text-size");
    setTextSizeState(isTextSize(current) ? current : DEFAULT_TEXT_SIZE);
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
