"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether Email Hub's single-key shortcuts are on. WCAG 2.1.4 asks for a way
 * to turn single-character shortcuts off: speech-input users trigger them by
 * accident ("e" archives, "#" deletes). Per device on purpose, like the
 * browser's own keyboard settings; without storage it stays on.
 */
const KEY = "uniwork:email-hub:shortcuts";
const listeners = new Set<() => void>();
/** Holds the choice when storage is blocked, so the switch still works for this visit. */
let fallback = true;

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return fallback;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useEmailHubShortcutsPref(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, read, () => true);
  const setEnabled = useCallback((next: boolean) => {
    fallback = next;
    try {
      window.localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      /* storage blocked: `fallback` carries the choice until the page reloads */
    }
    for (const listener of listeners) listener();
  }, []);
  return [enabled, setEnabled];
}
