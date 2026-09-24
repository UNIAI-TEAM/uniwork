"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_ACCENT,
  ACCENT_STORAGE_KEY,
  applyAccent,
  readStoredAccent,
  type AccentName,
} from "../lib/accent";

/**
 * Reads and writes the accent theme. The DOM is the live state — the boot
 * script in the document already applied the stored accent before React ran —
 * so this hook starts on the default and syncs on mount rather than reading
 * localStorage during render, which would mismatch the server HTML.
 *
 * The `storage` listener keeps a second tab in step, matching next-themes'
 * behaviour for light/dark so the two axes do not disagree across windows.
 */
export function useAccent(): { accent: AccentName; setAccent: (next: AccentName) => void } {
  const [accent, setAccentState] = useState<AccentName>(DEFAULT_ACCENT);

  useEffect(() => {
    setAccentState(readStoredAccent());
    const onStorage = (event: StorageEvent) => {
      if (event.key !== ACCENT_STORAGE_KEY) return;
      const next = readStoredAccent();
      setAccentState(next);
      applyAccent(next, document.documentElement);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setAccent = useCallback((next: AccentName) => {
    setAccentState(next);
    applyAccent(next, document.documentElement);
    try {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
    } catch {
      // Blocked storage: the accent still applies for this session.
    }
  }, []);

  return { accent, setAccent };
}
