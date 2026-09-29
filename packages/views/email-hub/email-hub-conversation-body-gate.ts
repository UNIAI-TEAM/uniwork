import { useEffect, useState } from "react";

/** Caps concurrent IMAP body fetches across stacked conversation messages. */

export const EMAIL_HUB_CONVERSATION_BODY_MAX = 2;

let active = 0;
const waiters: Array<() => void> = [];

function tryDequeue() {
  while (active < EMAIL_HUB_CONVERSATION_BODY_MAX && waiters.length > 0) {
    active++;
    const run = waiters.shift();
    run?.();
  }
}

function acquireSlot(onGranted: () => void): () => void {
  let released = false;
  let granted = false;

  const grant = () => {
    if (released || granted) return;
    granted = true;
    onGranted();
  };

  const release = () => {
    if (released) return;
    released = true;
    if (granted) {
      active = Math.max(0, active - 1);
      tryDequeue();
      return;
    }
    const idx = waiters.indexOf(grant);
    if (idx >= 0) waiters.splice(idx, 1);
  };

  if (active < EMAIL_HUB_CONVERSATION_BODY_MAX) {
    active++;
    grant();
  } else {
    waiters.push(grant);
  }

  return release;
}

/** True once this message may start a body fetch (respects global cap). */
export function useEmailHubConversationBodySlot(wantsSlot: boolean): boolean {
  const [hasSlot, setHasSlot] = useState(false);

  useEffect(() => {
    if (!wantsSlot) {
      setHasSlot(false);
      return;
    }
    setHasSlot(false);
    return acquireSlot(() => setHasSlot(true));
  }, [wantsSlot]);

  return hasSlot;
}

/** Test-only: module gate state does not reset between vitest cases. */
export function resetEmailHubConversationBodyGateForTests() {
  active = 0;
  waiters.length = 0;
}
