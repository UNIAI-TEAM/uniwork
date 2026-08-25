"use client";
import { useSyncExternalStore } from "react";

// Tín hiệu transient (không persist) — chỉ sống trong phiên vừa hoàn tất
// onboarding. Subscribe (không read-once) để sống qua StrictMode double-mount.
interface WelcomeState {
  signal: { workspaceId: string } | null;
  dismissed: boolean;
}
let state: WelcomeState = { signal: null, dismissed: false };
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => fn());
}

export function setWelcomeSignal(workspaceId: string) {
  state = { signal: { workspaceId }, dismissed: false };
  emit();
}
export function dismissWelcome() {
  state = { ...state, dismissed: true };
  emit();
}
export function resetWelcome() {
  state = { signal: null, dismissed: false };
  emit();
}

export function useWelcomeSignal(): WelcomeState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state,
  );
}
