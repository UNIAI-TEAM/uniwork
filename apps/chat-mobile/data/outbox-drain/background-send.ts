// What keeps the outbox going once UniChat is off screen (docs/engineering/unichat-mobile/offline-first.md › Gửi tiếp
// ở nền), as top messengers do: a message written just before the switch, or on the wire then, still goes, and one
// queued offline goes when the network comes back, the app away.
//
// - iOS: as the app leaves the screen with something owed, time borrowed from the system (beginBackgroundTask, about
//   30 s) to drain, given back at once; and a scheduled task (scheduled-drain.ts) kept while something is still owed —
//   best effort, iOS decides when it runs (often only on Wi-Fi, charging, or not at all for an app seldom used) and
//   drops it when the person swipes the app away. A suspended iPhone app runs nothing else. A run of that task that
//   finds nothing owed leaves its drop for the screen's return (scheduled-drain.ts says why).
// - Android: the WorkManager job (modules/unichat-background › OutboxDrain.kt), which needs a connected network: now,
//   expedited (Android 12+), when there is one, or the moment one comes back, a reboot included; it runs the drain
//   task in the running app or a headless one and comes back on its backoff while something is still owed.
//
// Both stand down when nothing is owed or the server's switches (outbox re-send, background send) are off. Back on
// screen, the screens send (use-account-sync.ts), Android's waiting job goes and iOS's task goes if a run left it
// owing nothing. The drain itself is drain.ts; the
// tasks that run it off screen are drain-tasks.ts.
import { Platform } from "react-native";
import { createLogger } from "../logger";
import { bestEffort } from "../report";
import { drainOwed, stillOwed, type DrainEnv, type DrainOutcome } from "./drain";
import { backgroundSendOn, owesNow, runningDrainEnv } from "./drain-env";
import { nativeDrain, type NativeDrain } from "./native-drain";
import { scheduledDrain, type ScheduledDrain } from "./scheduled-drain";

const log = createLogger("outbox");

/** The name iOS shows for the borrowed time (in its logs and the debugger). */
const GRACE_NAME = "unichat-outbox";

export interface BackgroundSendEnv {
  os: string;
  native: NativeDrain;
  scheduled: ScheduledDrain;
  enabled: () => boolean;
  owes: (userId: string) => boolean;
  /** The drain of the running app for this person, within the borrowed time. */
  running: (userId: string) => DrainEnv;
}

export const appBackgroundSendEnv: BackgroundSendEnv = {
  get os() {
    return Platform.OS;
  },
  native: nativeDrain,
  scheduled: scheduledDrain,
  enabled: backgroundSendOn,
  owes: owesNow,
  running: runningDrainEnv,
};

/**
 * UniChat leaves the screen (or an action ran with it off screen): what this person owes keeps going. Resolves once
 * iOS's borrowed time is given back; Android only schedules. Rejects only with a failure of the platform's own call.
 */
export async function keepSendingOffScreen(userId: string, env: BackgroundSendEnv = appBackgroundSendEnv): Promise<void> {
  if (!env.enabled() || !env.owes(userId)) {
    if (env.os === "android") env.native.cancelDrain();
    if (env.os === "ios") await env.scheduled.drop();
    return;
  }
  if (env.os === "android") {
    env.native.scheduleDrain(true);
    return;
  }
  if (env.os !== "ios") return;
  const grace = await env.native.beginGrace(GRACE_NAME);
  let outcome: DrainOutcome = "failed";
  try {
    // Kept first: the borrowed time may end with the app suspended before the drain answers. A refusal (a simulator,
    // background refresh off) only loses the later chance; the drain goes on.
    await env.scheduled.keep().catch(bestEffort("outbox", "scheduled drain not kept", "breadcrumb"));
    outcome = await drainOwed(env.running(userId));
  } finally {
    if (grace !== null) await env.native.endGrace(grace);
  }
  log.info("outbox drained leaving the screen", { outcome });
  if (!stillOwed(outcome)) await env.scheduled.drop();
}

/**
 * Back on screen: the screens send now, so Android's job waiting for a network goes, and iOS's scheduled task goes
 * if its last run found nothing owed. Rejects only with a failure of the platform's own call.
 */
export async function backInFront(env: BackgroundSendEnv = appBackgroundSendEnv): Promise<void> {
  if (env.os === "android") env.native.cancelDrain();
  if (env.os === "ios") await env.scheduled.settle();
}
