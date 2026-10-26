// The drain's wiring to the running app (drain.ts holds the policy): the server switches, what the person owes and
// the drain of the time iOS lends as the app leaves the screen, in the app the person just left (their id is known
// and nothing is read). Kept light on purpose: the screens load it (use-account-sync.ts), and a task's headless
// boot lives apart in task-env.ts.
import { deliverOwed, owesServer } from "../owed";
import { queryClient } from "../query-client";
import { readMobileFlag } from "../remote-config";
import { GRACE_BUDGET_MS, type DrainEnv } from "./drain";

/** The automatic re-send (unichat_mobile_outbox_flush) and its background half (unichat_mobile_background_send). */
export function backgroundSendOn(): boolean {
  return readMobileFlag(queryClient, "unichat_mobile_outbox_flush") && readMobileFlag(queryClient, "unichat_mobile_background_send");
}

export const owesNow = (userId: string): boolean => owesServer(userId);

export const deliverNow = (userId: string): Promise<void> => deliverOwed(queryClient, userId);

export function runningDrainEnv(userId: string): DrainEnv {
  return { prepare: () => Promise.resolve(userId), enabled: backgroundSendOn, deliver: deliverNow, owes: owesNow, budgetMs: GRACE_BUDGET_MS };
}
