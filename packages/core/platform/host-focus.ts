"use client";

import { useSyncExternalStore } from "react";
import { getDesktopBridge } from "./desktop-bridge";

// Inside UniChat the tab is always "visible": only the shell knows whether its
// window has focus, so the bridge is the source there and this mirrors it.
let hostFocused = true;

function subscribe(onChange: () => void): () => void {
  const bridge = getDesktopBridge();
  if (!bridge) {
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }
  let seen = false;
  const off = bridge.onFocusChange((focused) => {
    seen = true;
    hostFocused = focused;
    onChange();
  });
  // The one-shot query loses to any event that arrived while it was pending.
  void bridge.isFocused().then((focused) => {
    if (seen) return;
    hostFocused = focused;
    onChange();
  });
  return off;
}

// Read on every render so a visibility flip without an event is still seen.
function getSnapshot(): boolean {
  return getDesktopBridge() ? hostFocused : document.visibilityState === "visible";
}

/** Whether the person is looking at this app: the shell window's focus inside UniChat, the tab's visibility on web. */
export function useHostFocus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
