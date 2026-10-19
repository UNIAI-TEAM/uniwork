/**
 * G7-08 w2n: the AI turn wait. real5 X-R1 scored the panel's in-progress text ("Đang xử lý…" + the tool
 * steps) as the answer because the driver gave up at 45 s while the real model was still in its tool
 * rounds (three calls, each bounded by the server's 55 s UniworkDeadline). A turn the panel still shows
 * as busy at the deadline is a timeout with its own reason, never a content verdict; the turn ends when
 * the panel's own done state shows, not when a timer says so.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { VERDICT } from './oracles.mjs';
import { getRowById } from './rows.mjs';
import { runG708Matrix } from './run-g7-08.mjs';
import { AI_TURN_TIMEOUT_MS, observeAiPanelState, turnNotFinishedVerdict, waitForAiTurnDone } from './ai-turn-wait.mjs';
import { FRAME_AI_SELECTORS, runWebMatrixRow } from './web-driver.mjs';
import { extractWireToolCalls } from './wire-observe.mjs';
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

describe('G7-08 w2q: turn_not_finished evidence (wire tool calls, end screenshot, panel state)', () => {
  it('extracts per-call tool-call names in order alongside offeredTools and executedTools', () => {
    const requests = [
      {
        body: {
          tools: [
            { function: { name: 'get_workbook_context' } },
            { function: { name: 'read_range' } },
            { function: { name: 'propose_operations' } },
            { function: { name: 'ask_clarification' } },
          ],
        },
      },
    ];
    const responses = [
      { toolCallNames: ['get_workbook_context'] },
      { toolCallNames: ['read_range'] },
      { toolCallNames: ['propose_operations'] },
      { toolCallNames: ['ask_clarification'] },
    ];
    const wire = extractWireToolCalls(requests, responses);
    assert.deepEqual(wire.offeredTools, ['get_workbook_context', 'read_range', 'propose_operations', 'ask_clarification']);
    assert.deepEqual(wire.executedTools, ['get_workbook_context', 'read_range', 'propose_operations', 'ask_clarification']);
    assert.deepEqual(wire.callToolCalls, [
      ['get_workbook_context'],
      ['read_range'],
      ['propose_operations'],
      ['ask_clarification'],
    ]);
  });

  it('observes clarification prompt/buttons, running tool-step label, and plan/preview control via FRAME_AI_SELECTORS', async () => {
    assert.ok(FRAME_AI_SELECTORS.clarifyPrompt, 'clarifyPrompt selector defined');
    assert.ok(FRAME_AI_SELECTORS.clarifyAnswerBtn, 'clarifyAnswerBtn selector defined');
    assert.ok(FRAME_AI_SELECTORS.runningStep, 'runningStep selector defined');
    assert.ok(FRAME_AI_SELECTORS.planPreviewApply, 'planPreviewApply selector defined');

    const makeDomFrame = (map) => ({
      async $$eval(selector, fn) {
        const els = map[selector] ?? [];
        return fn(els);
      },
    });

    const clarifyState = await observeAiPanelState(
      makeDomFrame({
        [FRAME_AI_SELECTORS.clarifyPrompt]: [{ textContent: 'Cột nào chứa doanh thu ròng?' }],
        [FRAME_AI_SELECTORS.clarifyAnswerBtn]: [{ textContent: 'Cột G' }, { textContent: 'Bỏ qua' }],
        [FRAME_AI_SELECTORS.runningStep]: [{ textContent: 'ask clarification', getAttribute: (k) => (k === 'data-tip' ? 'ask_clarification' : null) }],
      }),
      { selectors: FRAME_AI_SELECTORS },
    );
    assert.deepEqual(clarifyState, {
      clarificationShown: true,
      clarificationAnswerButtonsShown: true,
      runningStepShown: true,
      runningStepLabel: 'ask clarification',
      planPreviewApplyShown: false,
    });

    const previewHangState = await observeAiPanelState(
      makeDomFrame({
        [FRAME_AI_SELECTORS.runningStep]: [{ textContent: 'propose operations', getAttribute: (k) => (k === 'data-tip' ? 'propose_operations' : null) }],
        [FRAME_AI_SELECTORS.planPreviewApply]: [{ textContent: 'Thay đổi đề xuất' }],
      }),
      { selectors: FRAME_AI_SELECTORS },
    );
    assert.deepEqual(previewHangState, {
      clarificationShown: false,
      clarificationAnswerButtonsShown: false,
      runningStepShown: true,
      runningStepLabel: 'propose operations',
      planPreviewApplyShown: true,
    });
  });

  it('records per-call tool names, *-ai-panel-end.png screenshot, and panelState on BLOCKED turn_not_finished without scoring content', async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g708-w2q-test-'));
    try {
      const listeners = new Map();
      const page = {
        on(event, handler) {
          listeners.set(event, [...(listeners.get(event) ?? []), handler]);
        },
        emit(event, payload) {
          for (const h of listeners.get(event) ?? []) h(payload);
        },
        async screenshot({ path: p }) {
          fs.writeFileSync(p, Buffer.from('PNG_END_BOUND'));
        },
      };
      const frame = {
        async $$eval(selector, fn) {
          if (selector === FRAME_AI_SELECTORS.clarifyPrompt) return fn([{ textContent: 'Ghi vào cột AA hay G?' }]);
          if (selector === FRAME_AI_SELECTORS.clarifyAnswerBtn) return fn([{ textContent: 'AA2:AA7' }]);
          if (selector === FRAME_AI_SELECTORS.runningStep) return fn([{ textContent: 'ask clarification' }]);
          return fn([]);
        },
      };
      const modelUrl = 'http://web.test/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions';
      const sixCalls = [
        'get_workbook_context',
        'read_range',
        'load_guide',
        'read_range',
        'propose_operations',
        'ask_clarification',
      ];

      const res = await runG708Matrix(
        {
          rows: [getRowById('X-E1')],
          providers: ['uniwork'],
          host: 'web',
          runDir,
          dryRun: true,
          maxOutputTokens: 100_000,
          guardOutputTokens: 90_000,
        },
        {
          evidenceFn: () => null,
          log: () => {},
          rowRunner: (entry) =>
            runWebMatrixRow(entry, {
              runDir,
              webOrigin: 'http://web.test',
              turnTimeoutMs: 180_000,
              injectedPage: page,
              injectedRowBody: async () => {
                for (const toolName of sixCalls) {
                  page.emit('request', {
                    method: () => 'POST',
                    url: () => modelUrl,
                    postData: () =>
                      JSON.stringify({
                        tools: [{ function: { name: 'propose_operations' } }, { function: { name: 'ask_clarification' } }],
                      }),
                  });
                  const sse = [
                    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { name: toolName } }] } }] })}`,
                    `data: ${JSON.stringify({ usage: { prompt_tokens: 1000, completion_tokens: 50 } })}`,
                    'data: [DONE]',
                    '',
                  ].join('\n\n');
                  page.emit('response', {
                    status: () => 200,
                    url: () => modelUrl,
                    request: () => ({ method: () => 'POST', url: () => modelUrl }),
                    text: async () => sse,
                  });
                }
                return { finished: false, elapsedMs: 180_069, frame };
              },
            }),
        },
      );

      assert.equal(res.status, VERDICT.BLOCKED);
      assert.equal(res.exitCode, 77);
      const rowJson = JSON.parse(
        fs.readFileSync(path.join(runDir, 'g7-08', 'X-E1-uniwork-web.json'), 'utf8'),
      );
      assert.equal(rowJson.status, VERDICT.BLOCKED);
      assert.equal(rowJson.reason, 'turn_not_finished');
      assert.deepEqual(rowJson.verdicts, {}, 'never scores content on turn_not_finished');
      assert.equal(rowJson.usage.modelCalls, 6);
      assert.equal(rowJson.usage.inputTokens, 6000);
      assert.equal(rowJson.usage.outputTokens, 300);
      assert.equal(rowJson.usage.missingUsageCalls, 0);

      assert.deepEqual(rowJson.details.callToolCalls, [
        ['get_workbook_context'],
        ['read_range'],
        ['load_guide'],
        ['read_range'],
        ['propose_operations'],
        ['ask_clarification'],
      ]);
      assert.deepEqual(rowJson.details.offeredTools, ['propose_operations', 'ask_clarification']);
      assert.deepEqual(rowJson.details.executedTools, [
        'get_workbook_context',
        'read_range',
        'load_guide',
        'propose_operations',
        'ask_clarification',
      ]);

      const expectedEndPng = path.join(runDir, 'g7-08', 'artifacts', 'X-E1-uniwork-web-ai-panel-end.png');
      assert.equal(rowJson.details.endScreenshotPath, expectedEndPng);
      assert.equal(fs.existsSync(expectedEndPng), true);

      assert.deepEqual(rowJson.details.panelState, {
        clarificationShown: true,
        clarificationAnswerButtonsShown: true,
        runningStepShown: true,
        runningStepLabel: 'ask clarification',
        planPreviewApplyShown: false,
      });
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});
