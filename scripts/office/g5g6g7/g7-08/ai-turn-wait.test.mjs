/**
 * G7-08 w2n: the AI turn wait. real5 X-R1 scored the panel's in-progress text ("Đang xử lý…" + the tool
 * steps) as the answer because the driver gave up at 45 s while the real model was still in its tool
 * rounds (three calls, each bounded by the server's 55 s UniworkDeadline). A turn the panel still shows
 * as busy at the deadline is a timeout with its own reason, never a content verdict; the turn ends when
 * the panel's own done state shows, not when a timer says so.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VERDICT } from './oracles.mjs';
import { AI_TURN_TIMEOUT_MS, turnNotFinishedVerdict, waitForAiTurnDone } from './ai-turn-wait.mjs';

const SEL = Object.freeze({ busy: 'button.ai-stop-btn, .ai-work-group-summary.running', assistantMsg: '.ai-msg-assistant' });

/** A virtual clock plus a panel that is busy until `doneAtMs` and has one assistant message from `msgAtMs`. */
function makeTurn({ doneAtMs, msgAtMs = 0 }) {
  let t = 0;
  const frame = {
    async $(selector) {
      assert.equal(selector, SEL.busy);
      return t < doneAtMs ? { busy: true } : null;
    },
    async $$eval(selector) {
      assert.equal(selector, SEL.assistantMsg);
      return t >= msgAtMs ? 1 : 0;
    },
  };
  return { frame, now: () => t, sleep: async (ms) => { t += ms; } };
}

describe('G7-08 w2n: waitForAiTurnDone', () => {
  it('a final answer after the old 45 s deadline is still waited for and finishes', async () => {
    const { frame, now, sleep } = makeTurn({ doneAtMs: 100_000 });
    const res = await waitForAiTurnDone(frame, { selectors: SEL, now, sleep });
    assert.equal(res.finished, true);
    assert.ok(res.elapsedMs >= 100_000 && res.elapsedMs < AI_TURN_TIMEOUT_MS);
  });

  it('a turn still busy at the bound is not finished (never an answer)', async () => {
    const { frame, now, sleep } = makeTurn({ doneAtMs: Number.POSITIVE_INFINITY });
    const res = await waitForAiTurnDone(frame, { selectors: SEL, now, sleep, timeoutMs: 60_000 });
    assert.equal(res.finished, false);
    assert.ok(res.elapsedMs >= 60_000);
  });

  it('an idle panel with no assistant message yet is not a finished turn', async () => {
    const { frame, now, sleep } = makeTurn({ doneAtMs: 0, msgAtMs: Number.POSITIVE_INFINITY });
    const res = await waitForAiTurnDone(frame, { selectors: SEL, now, sleep, timeoutMs: 5_000 });
    assert.equal(res.finished, false);
  });

  it('the bound fits several 55 s model calls (server UniworkDeadline)', () => {
    assert.ok(AI_TURN_TIMEOUT_MS >= 3 * 55_000);
    assert.equal(AI_TURN_TIMEOUT_MS, 180_000);
  });
});

describe('G7-08 w2n: turnNotFinishedVerdict', () => {
  it('is BLOCKED turn_not_finished with the usage observation, never FAIL', () => {
    const usage = { modelCalls: 3, inputTokens: 20156, outputTokens: 397, missingUsageCalls: 0, missingObservationCalls: 0 };
    const v = turnNotFinishedVerdict({ timeoutMs: AI_TURN_TIMEOUT_MS, elapsedMs: 180_250, usage });
    assert.equal(v.status, VERDICT.BLOCKED);
    assert.equal(v.reason, 'turn_not_finished');
    assert.notEqual(v.status, VERDICT.FAIL);
    assert.equal(v.details.timeoutMs, AI_TURN_TIMEOUT_MS);
    assert.equal(v.details.modelCalls, 3);
    assert.deepEqual(v.usage, usage);
  });
});
