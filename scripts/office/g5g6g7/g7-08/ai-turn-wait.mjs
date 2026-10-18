// G7-08 w2n: how long the driver waits for one AI turn, and what a turn that did not finish is.
// Kept apart from web-driver.mjs so the wait is testable with a fake frame and a virtual clock.

import { sleep as realSleep } from '../harness/app-steps.mjs';
import { blockedVerdict } from './oracles.mjs';

/**
 * The whole-turn bound. A real turn is several model calls (tool rounds, then the answer), and the server
 * caps each at UniworkDeadline = 55 s (server/internal/service/ai_uniwork.go), so the old 45 s bound cut a
 * turn off in the middle of its second round (real5 X-R1). Three calls of 55 s fit in 180 s. The panel's
 * own done state ends the wait earlier; this only bounds a turn that never finishes.
 */
export const AI_TURN_TIMEOUT_MS = 180_000;

const POLL_MS = 250;
// Two idle polls in a row: a render gap between two tool rounds is not the end of the turn.
const IDLE_POLLS_TO_FINISH = 2;

/**
 * Waits for the panel's done state: no busy marker (stop button, streaming message, typing row, running
 * work group) and an assistant message on screen, seen on two consecutive polls. Returns `finished: false`
 * when the bound passes first, so the caller never scores an in-progress panel.
 */
export async function waitForAiTurnDone(frame, {
  selectors, timeoutMs = AI_TURN_TIMEOUT_MS, now = Date.now, sleep = realSleep,
} = {}) {
  const start = now();
  let idlePolls = 0;
  while (now() - start < timeoutMs) {
    const busy = await frame.$(selectors.busy);
    const msgCount = await frame.$$eval(selectors.assistantMsg, (els) => els.length).catch(() => 0);
    idlePolls = !busy && msgCount > 0 ? idlePolls + 1 : 0;
    if (idlePolls >= IDLE_POLLS_TO_FINISH) return { finished: true, elapsedMs: now() - start };
    await sleep(POLL_MS);
  }
  return { finished: false, elapsedMs: now() - start };
}

/** A turn the panel still showed as in progress at the bound: a timeout with its own reason, usage kept. */
export function turnNotFinishedVerdict({ timeoutMs, elapsedMs, usage }) {
  return {
    ...blockedVerdict('turn_not_finished', {
      timeoutMs, elapsedMs, modelCalls: usage?.modelCalls, missingUsageCalls: usage?.missingUsageCalls,
    }),
    usage,
  };
}
