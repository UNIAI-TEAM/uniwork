// What the app lock is doing right now, for the parts of the app that must
// follow it without importing the guard (components/app/privacy-guard.tsx).
//
// - `engaged`: the lock is on and not yet opened for the person signed in
//   (the guard writes it). A live call lifts the lock screen so the call can
//   connect, so the call screen refuses to shrink while it is engaged — a
//   shrunk call would leave every chat usable past the lock
//   (components/calls/call-overlay.tsx). Every open sheet closes when it
//   engages (components/ui/call-aware-modal.tsx): a Modal is its own native
//   window, drawn above the lock screen.
// - `ownerPrompts`: how many Face ID / passcode prompts are open
//   (privacy.ts › authenticateOwner). On Android the passcode screen is
//   another activity, so the app reads as `background` while it is up; the
//   guard does not count that as time away, or "Immediately" would lock again
//   right after an unlock.
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

interface AppLockState {
  engaged: boolean;
  ownerPrompts: number;
}

export const appLockState = createStore<AppLockState>(() => ({ engaged: false, ownerPrompts: 0 }));

export function setAppLockEngaged(engaged: boolean): void {
  if (appLockState.getState().engaged !== engaged) appLockState.setState({ engaged });
}

/** Runs the owner's proof, marked as open while it runs. */
export async function whileOwnerPrompt<T>(prove: () => Promise<T>): Promise<T> {
  appLockState.setState((s) => ({ ownerPrompts: s.ownerPrompts + 1 }));
  try {
    return await prove();
  } finally {
    appLockState.setState((s) => ({ ownerPrompts: s.ownerPrompts - 1 }));
  }
}

export function ownerPromptOpen(): boolean {
  return appLockState.getState().ownerPrompts > 0;
}

export function useAppLockEngaged(): boolean {
  return useStore(appLockState, (s) => s.engaged);
}
