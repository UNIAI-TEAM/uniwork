/**
 * Matrix-level tests for the G7-08 real-run wire observation (review r3 findings
 * G708-R3-1, R3-3; review r4 findings G708-R4-1, R4-3), split out of
 * `run-g7-08.test.mjs` to keep every module under the repo's 500-line limit. The
 * observer itself is unit-tested through an injected fake page in
 * `wire-observe.test.mjs`; here its result drives the matrix: a row with an
 * unknown-usage model call stops the run before the next row, and a row runner
 * that threw after the observer was attached is that same unknown-usage stop
 * unless the observer can prove no frame AI POST happened at all.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { VERDICT, blockedVerdict, failVerdict, passVerdict } from './oracles.mjs';
import { ROW_EXIT, getRowById } from './rows.mjs';
import { runG708Matrix } from './run-g7-08.mjs';
import { runWebMatrixRow } from './web-driver.mjs';
import { evaluateWireObservation, InterruptedAiTurnError, interruptionFromTurn } from './wire-observe.mjs';

const fakePage = () => {
  const listeners = new Map();
  return {
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    },
    emit(event, payload) {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
  };
};
const fakeReq = (url) => ({ method: () => 'POST', url: () => url, postData: () => '{}' });
const MODEL_URL = 'http://web.test/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions';

const makeTempRunDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'g708-wire-test-'));

const matrixArgs = (runDir) => ({
  rows: [getRowById('X-R1'), getRowById('D-E1')],
  providers: ['uniwork'],
  host: 'web',
  runDir,
  dryRun: true,
  maxOutputTokens: 100_000,
  guardOutputTokens: 90_000,
});

describe('G7-08 real-run wire observation drives the matrix stop', () => {
  it('G708-R3-1: a completion without usage stops the matrix before the next row', async () => {
    // The wire a real run would have observed: one model request, one response with no usage.
    const requests = [{ body: { tools: [{ function: { name: 'read_range' } }] } }];
    const responses = [{ status: 200, usage: null }];
    const wire = evaluateWireObservation({ requests, responses, sawTurnEffects: true });
    assert.equal(wire.reason, 'missing_usage_on_model_call');
    assert.equal(wire.missingUsageCalls, 1);

    const tmp = makeTempRunDir();
    try {
      let calls = 0;
      const res = await runG708Matrix(matrixArgs(tmp), {
        evidenceFn: () => null,
        log: () => {},
        rowRunner: async () => {
          calls += 1;
          return { ...blockedVerdict(wire.reason, wire.detail), usage: wire };
        },
      });
      assert.equal(calls, 1, 'the second row runner is never called');
      assert.equal(res.runs[0].reason, 'missing_usage_on_model_call');
      assert.equal(res.runs[1].reason, 'missing_usage_on_model_call');
      assert.equal(res.runs[1].usage.missingUsageCalls, 1, 'the stopped row still reports the unknown');
      assert.equal(res.status, VERDICT.BLOCKED);
      assert.equal(res.exitCode, ROW_EXIT.BLOCKED);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('G708-R3-1: a turn with effects and no observed model request stops on the missing observation', async () => {
    const wire = evaluateWireObservation({ requests: [], responses: [], sawTurnEffects: true });
    assert.equal(wire.reason, 'missing_model_call_observation');

    const tmp = makeTempRunDir();
    try {
      let calls = 0;
      const res = await runG708Matrix(matrixArgs(tmp), {
        evidenceFn: () => null,
        log: () => {},
        rowRunner: async () => {
          calls += 1;
          return { ...blockedVerdict(wire.reason, wire.detail), usage: wire };
        },
      });
      assert.equal(calls, 1);
      assert.equal(res.runs[0].reason, 'missing_model_call_observation');
      assert.equal(res.runs[1].reason, 'missing_model_call_observation');
      assert.equal(res.exitCode, ROW_EXIT.BLOCKED);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('G708-R3-3: a row runner that threw after a model request stops the matrix with unknown usage', async () => {
    const tmp = makeTempRunDir();
    try {
      let calls = 0;
      const res = await runG708Matrix(matrixArgs(tmp), {
        evidenceFn: () => null,
        log: () => {},
        rowRunner: async () => {
          calls += 1;
          // The first row: a model request had begun when the runner threw.
          if (calls === 1) {
            throw interruptionFromTurn(new Error('frame navigated away'), { requests: [{ body: {} }], responses: [] });
          }
          return { ...passVerdict('should_not_run'), usage: { modelCalls: 1, inputTokens: 1, outputTokens: 1 } };
        },
      });
      assert.equal(calls, 1, 'the next row is not started');
      assert.equal(res.runs[0].status, VERDICT.BLOCKED);
      assert.equal(res.runs[0].reason, 'missing_usage_on_model_call');
      assert.equal(res.runs[0].usage.missingUsageCalls, 1);
      assert.equal(res.runs[1].reason, 'missing_usage_on_model_call');
      assert.equal(res.exitCode, ROW_EXIT.BLOCKED);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('G708-R3-3: a row runner that threw before any model request keeps its own crash error', async () => {
    const tmp = makeTempRunDir();
    try {
      let calls = 0;
      const res = await runG708Matrix(matrixArgs(tmp), {
        evidenceFn: () => null,
        log: () => {},
        rowRunner: async () => {
          calls += 1;
          // The driver RETURNS this verdict itself, and only when its observer saw no frame AI
          // POST at all - a throw never reaches the matrix as a bare crash any more (R4-3).
          if (calls === 1) return { ...failVerdict('row_runner_threw', { error: 'composer detached' }), usage: null };
          return { ...passVerdict('second_row_ok'), usage: { modelCalls: 1, inputTokens: 1, outputTokens: 1 } };
        },
      });
      assert.equal(calls, 2, 'no model call began, so the run is not stopped');
      assert.equal(res.runs[0].status, VERDICT.FAIL);
      assert.equal(res.runs[0].reason, 'row_runner_threw');
      assert.equal(res.runs[1].status, VERDICT.PASS);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('G708-R4-3: a plain Error after a model request stops the matrix with unknown usage', async () => {
    // Test (1) of the finding: a plain Error - not an `InterruptedAiTurnError` - from a row runner
    // that had already pushed a request. It must never read as a trusted-zero crash.
    const tmp = makeTempRunDir();
    try {
      let calls = 0;
      const res = await runG708Matrix(matrixArgs(tmp), {
        evidenceFn: () => null,
        log: () => {},
        rowRunner: async () => {
          calls += 1;
          if (calls === 1) throw new Error('edit stage blew up');
          return { ...passVerdict('should_not_run'), usage: { modelCalls: 1, inputTokens: 1, outputTokens: 1 } };
        },
      });
      assert.equal(calls, 1, 'the second row runner is not called');
      assert.equal(res.runs[0].status, VERDICT.BLOCKED);
      assert.equal(res.runs[0].reason, 'missing_usage_on_model_call');
      assert.equal(res.runs[0].usage.missingUsageCalls, 1, 'a generic throw is unknown usage, never 0');
      assert.equal(res.runs[1].reason, 'missing_usage_on_model_call');
      assert.equal(res.exitCode, ROW_EXIT.BLOCKED);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('G708-R4-3: a missed route seen by the broader observer is an unknown-usage stop, not a crash', () => {
    // Test (2) of the finding: the matched list is empty, so the old rule read "no request began";
    // the observer's own AI-mount record proves a BYOK POST did begin.
    const seen = interruptionFromTurn(new Error('frame navigated away'), {
      requests: [],
      responses: [],
      aiPaths: [{ path: '/api/v1/office-frame/documents/D1/ai/byok/openai/chat/completions' }],
    });
    assert.equal(seen.name, 'InterruptedAiTurnError');
    assert.equal(seen.usage.missingUsageCalls, 1);

    // The provable case still keeps its own error, because the observer saw nothing at all.
    const provable = interruptionFromTurn(new Error('composer detached'), { requests: [], responses: [], aiPaths: [] });
    assert.equal(provable.name, 'Error');
    assert.equal(provable.message, 'composer detached');
  });

  it('G708-R5-2: a plain Error after a driver-observed request is BLOCKED unknown usage', async () => {
    const page = fakePage();
    await assert.rejects(
      () => runWebMatrixRow({ rowId: 'X-R1', host: 'web' }, {
        injectedPage: page,
        injectedRowBody: async () => {
          page.emit('request', fakeReq(MODEL_URL));
          throw new Error('edit stage blew up');
        },
      }),
      (err) => {
        assert.equal(err instanceof InterruptedAiTurnError, true);
        assert.ok(err.usage.missingUsageCalls >= 1);
        return true;
      },
    );

    const tmp = makeTempRunDir();
    try {
      let calls = 0;
      const res = await runG708Matrix(matrixArgs(tmp), {
        evidenceFn: () => null,
        log: () => {},
        rowRunner: async () => {
          calls += 1;
          const p = fakePage();
          return runWebMatrixRow({ rowId: 'X-R1', host: 'web' }, {
            injectedPage: p,
            injectedRowBody: async () => {
              p.emit('request', fakeReq(MODEL_URL));
              throw new Error('edit stage blew up');
            },
          });
        },
      });
      assert.equal(calls, 1, 'the second row does not start');
      assert.equal(res.runs[0].status, VERDICT.BLOCKED);
      assert.equal(res.runs[0].reason, 'missing_usage_on_model_call');
      assert.ok(res.runs[0].usage.missingUsageCalls >= 1);
      assert.equal(res.runs[1].reason, 'missing_usage_on_model_call');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('w2i: a driver-observed frame-AI POST to the web origin is BLOCKED frame_ai_wrong_origin naming both origins and never counted as a model call', async () => {
    const p = fakePage();
    const verdict = await runWebMatrixRow({ rowId: 'X-R1', host: 'web' }, {
      apiOrigin: 'http://api.test',
      injectedPage: p,
      injectedRowBody: async () => {
        p.emit('request', fakeReq(MODEL_URL));
      },
    });
    assert.equal(verdict.status, VERDICT.BLOCKED);
    assert.equal(verdict.exitCode, ROW_EXIT.BLOCKED);
    assert.equal(verdict.reason, 'frame_ai_wrong_origin');
    assert.equal(verdict.details.expectedOrigin, 'http://api.test');
    assert.equal(verdict.details.observedOrigin, 'http://web.test');
    assert.equal(verdict.usage.modelCalls, 0);
  });
});
