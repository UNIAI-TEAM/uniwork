"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "uniwork:email-hub:remote-images";
const listeners = new Set<() => void>();
let fallback = false;

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "on";
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

/** When true, remote images in email HTML load without asking each time (this browser only). */
export function useEmailHubRemoteImagesPref(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, read, () => false);
  const setEnabled = useCallback((next: boolean) => {
    fallback = next;
    try {
      window.localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      /* storage blocked */
    }
    for (const listener of listeners) listener();
  }, []);
  return [enabled, setEnabled];
}
