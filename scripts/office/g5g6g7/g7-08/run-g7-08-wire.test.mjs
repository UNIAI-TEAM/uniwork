/**
 * Matrix-level tests for the G7-08 real-run wire observation (review r3 findings
 * G708-R3-1, R3-3), split out of `run-g7-08.test.mjs` to keep every module under
 * the repo's 500-line limit. The observer itself is unit-tested through an
 * injected fake page in `save-observe.test.mjs`; here its result drives the
 * matrix: a row with an unknown-usage model call stops the run before the next
 * row, and a row runner that threw after a model request had begun is that same
 * unknown-usage stop rather than a bare crash.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { VERDICT, blockedVerdict, passVerdict } from './oracles.mjs';
import { ROW_EXIT, getRowById } from './rows.mjs';
import { runG708Matrix } from './run-g7-08.mjs';
import { evaluateWireObservation, interruptionFromTurn } from './save-observe.mjs';

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
          if (calls === 1) throw interruptionFromTurn(new Error('composer detached'), { requests: [], responses: [] });
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
});
