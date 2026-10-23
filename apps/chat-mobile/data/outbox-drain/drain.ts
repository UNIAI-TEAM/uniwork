// One drain of the outbox while UniChat is off screen (docs/engineering/unichat-mobile/offline-first.md › Gửi tiếp ở
// nền): the person's queues read (a headless runtime boots first: drain-env.ts), what they owe delivered — messages,
// reads, reactions, votes, edits, deletes, every workspace (owed.ts) — until nothing is on the wire, and an answer
// the platform acts on (background-send.ts): nothing left, still owed (Android's job comes back on its backoff, iOS
// keeps its scheduled task), or nothing to do. The same client_msg_id and the same per-line queues as on screen: a
// drain that runs beside a foreground flush joins it, and a send both make lands once.
//
// Bounded: past its budget the drain answers "timeout" and lets the OS have its time back; what was on the wire goes
// on as long as the runtime does. Never throws into a task: a failure is a breadcrumb and counts as still owed.
import { bestEffort } from "../report";

/** The JavaScript task the Android job runs (modules/unichat-background › OutboxDrain.TASK_KEY). */
export const DRAIN_TASK = "UniChatOutboxDrain";
/** The expo-background-task name of iOS's scheduled drain (BGProcessingTask, best effort). */
export const SCHEDULED_DRAIN_TASK = "unichat-outbox-drain";
/** iOS lends about 30 s as the app leaves the screen; the drain gives it back before the system takes it. */
export const GRACE_BUDGET_MS = 25_000;
/** An Android job or an iOS scheduled task: room for an upload. The native job waits 150 s (HeadlessDrainRunner). */
export const DRAIN_BUDGET_MS = 120_000;

export interface DrainEnv {
  /** The signed-in person with their queues read and the server switches known; null when nobody is signed in. */
  prepare: () => Promise<string | null>;
  /** The server's switches for the automatic re-send and the background send are both on. */
  enabled: () => boolean;
  /** Everything owed delivered or back in line; resolves once nothing is on the wire (owed.ts › deliverOwed). */
  deliver: (userId: string) => Promise<void>;
  owes: (userId: string) => boolean;
  budgetMs: number;
}

export type DrainOutcome = "drained" | "owed" | "timeout" | "failed" | "signed-out" | "paused";

/** Whether the platform should come back for more (an Android retry, iOS's task kept). */
export function stillOwed(outcome: DrainOutcome): boolean {
  return outcome === "owed" || outcome === "timeout" || outcome === "failed";
}

export async function drainOwed(env: DrainEnv): Promise<DrainOutcome> {
  const work = (async (): Promise<DrainOutcome> => {
    const userId = await env.prepare();
    if (!userId) return "signed-out";
    if (!env.enabled()) return "paused";
    if (env.owes(userId)) await env.deliver(userId);
    return env.owes(userId) ? "owed" : "drained";
  })().catch((error: unknown): DrainOutcome => {
    bestEffort("outbox", "outbox not drained in the background", "breadcrumb")(error);
    return "failed";
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<DrainOutcome>((resolve) => {
    timer = setTimeout(() => resolve("timeout"), env.budgetMs);
  });
  const outcome = await Promise.race([work, budget]);
  clearTimeout(timer);
  return outcome;
}
