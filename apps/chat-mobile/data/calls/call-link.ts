// How often a call's media link drops and whether it comes back (review "no-in-call-reconnecting-ui"), counted per
// build like the call's connect: a drop LiveKit recovered from, with how long it took, and one the room never came
// back from. components/calls/use-call-link.ts feeds it from the room's events; the person sees the same drop on the
// call screen and in the ongoing notification.
import { track, type ProductEvent } from "../analytics";

export interface CallLinkTrackerEnv {
  track: (event: ProductEvent) => void;
  now: () => number;
}

export function createCallLinkTracker(env: CallLinkTrackerEnv) {
  let since: number | null = null;
  return {
    /** The link dropped; a second notice of the same drop (signal, then media) keeps the first time. */
    reconnecting(): void {
      if (since === null) since = env.now();
    },
    reconnected(): void {
      if (since === null) return;
      env.track({ name: "call_reconnect", result: "recovered", duration_ms: env.now() - since });
      since = null;
    },
    /** The room let go: a drop still under way did not recover. */
    disconnected(): void {
      if (since === null) return;
      env.track({ name: "call_reconnect", result: "dropped" });
      since = null;
    },
  };
}

export type CallLinkTracker = ReturnType<typeof createCallLinkTracker>;

export const callLinkTracker: CallLinkTracker = createCallLinkTracker({ track, now: () => Date.now() });
