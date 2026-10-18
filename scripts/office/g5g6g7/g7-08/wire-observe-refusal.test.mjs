/**
 * G7-08 w2p: a UniWork AI refusal is a known zero-usage answer, not a model call with missing usage.
 *
 * real6 (smoke X-R1): the frame made 10 AI POSTs; the first 9 are model calls and match ai_usage_events.
 * The 10th was answered in 30 ms with 409 run_limit_reached (fields.limit = tool_rounds, run row 8/8).
 * The observer counted it as a response with no usage -> BLOCKED missing_usage_on_model_call and the
 * runner stopped. The refusal spends nothing, so it is recorded as `refusals[{status, code, limit}]`
 * and the turn is scored. Anything that is not exactly that (status AND parsed code) stays fail-closed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { VERDICT, failVerdict, passVerdict } from './oracles.mjs';
import { ROW_EXIT, getRowById } from './rows.mjs';
import { runG708Matrix } from './run-g7-08.mjs';
import { evaluateWireObservation, observeModelWire, scoreRefusalEnd } from './wire-observe.mjs';

const WEB = 'http://web.test';
const MODEL_URL = `${WEB}/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions`;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const sseText = (promptTokens, completionTokens) => `data: ${JSON.stringify({
  choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
})}\n\ndata: [DONE]\n\n`;

// The server's error envelope (handler/ai_uniwork.go:135-147 -> respondErrorFields -> sdo.NewErrorSDO).
const envelope = (code, fields) => JSON.stringify({ error: { code, message: 'm', error_class: 'conflict', ...(fields ? { fields } : {}) } });
const RUN_LIMIT = envelope('run_limit_reached', { limit: 'tool_rounds' });

function makeFakePage({ routed = true } = {}) {
  const listeners = new Map();
  const routes = [];
  const page = {
    on(event, handler) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      return page;
    },
    emit(event, payload) { for (const handler of listeners.get(event) ?? []) handler(payload); },
    routes,
  };
  if (routed) page.route = async (glob, handler) => { routes.push({ glob, handler }); };
  return page;
}

const fakeRequest = () => ({ method: () => 'POST', url: () => MODEL_URL, postData: () => '{}' });

/** One frame POST answered with `status` + `text` after `ms`, through the route (real run) or the response event. */
async function frameCall(page, { status = 200, text, ms = 0 }) {
  const request = fakeRequest();
  page.emit('request', request);
  const routed = page.routes.find((r) => r.glob.includes('/ai/uniwork/chat/completions'));
  if (routed) {
    let answered;
    const frameAnswered = new Promise((resolve) => { answered = resolve; });
    routed.handler({
      request: () => request,
      continue: async () => {},
      abort: async () => answered(),
      fetch: async () => {
        await sleep(ms);
        return { status: () => status, headers: () => ({ 'content-type': 'application/json' }), body: async () => Buffer.from(text) };
      },
      fulfill: async () => answered(),
    });
    await frameAnswered;
    return;
  }
  await sleep(ms);
  page.emit('response', { status: () => status, url: () => MODEL_URL, request: () => request, text: async () => text });
}

async function observeTurn(calls, { routed = true } = {}) {
  const page = makeFakePage({ routed });
  const requests = [];
  const responses = [];
  const aiPaths = [];
  const observer = observeModelWire(page, { requests, responses, aiPaths, frameAiOrigin: WEB, responseTimeoutMs: 400 });
  await observer.ready;
  for (const call of calls) await frameCall(page, call);
  await observer.settle();
  return evaluateWireObservation({ requests, responses, aiPaths, frameAiOrigin: WEB, sawTurnEffects: true });
}

describe('G7-08 w2p: a UniWork AI refusal is a known zero-usage non-model response', () => {
  for (const routed of [true, false]) {
    it(`real6 X-R1 shape (${routed ? 'routed' : 'passive'} observer): 9 counted model calls then a 30 ms 409 run_limit_reached`, async () => {
      const calls = Array.from({ length: 9 }, () => ({ text: sseText(100, 10), ms: 1 }));
      calls.push({ status: 409, text: RUN_LIMIT, ms: 30 });
      const wire = await observeTurn(calls, { routed });
      assert.equal(wire.modelCalls, 9, 'the refusal is not a model call');
      assert.equal(wire.missingUsageCalls, 0, 'and not a model call with missing usage');
      assert.equal(wire.inputTokens, 900);
      assert.equal(wire.outputTokens, 90);
      assert.equal(wire.unobserved, false);
      assert.equal(wire.reason, null);
      assert.deepEqual(wire.refusals, [{ status: 409, code: 'run_limit_reached', limit: 'tool_rounds' }]);
      assert.equal(wire.endedByRefusal, true);
    });
  }

  it('run_expired and conversation_expired are refusals too; their limit is null', async () => {
    const wire = await observeTurn([
      { status: 409, text: envelope('run_expired'), ms: 1 },
      { status: 409, text: envelope('conversation_expired'), ms: 1 },
    ]);
    assert.equal(wire.modelCalls, 0);
    assert.equal(wire.missingUsageCalls, 0);
    assert.equal(wire.unobserved, false);
    assert.deepEqual(wire.refusals, [
      { status: 409, code: 'run_expired', limit: null },
      { status: 409, code: 'conversation_expired', limit: null },
    ]);
  });

  it('a refusal in the middle of the turn is recorded, but a later model call means the turn did not end on it', async () => {
    const wire = await observeTurn([
      { status: 409, text: RUN_LIMIT, ms: 1 },
      { text: sseText(50, 5), ms: 1 },
    ]);
    assert.equal(wire.modelCalls, 1);
    assert.equal(wire.refusals.length, 1);
    assert.equal(wire.endedByRefusal, false);
  });

  it('(d) the reading is tied to status + parsed code, never to timing: a fast and a slow refusal read the same', async () => {
    for (const ms of [0, 30, 150]) {
      const wire = await observeTurn([{ status: 409, text: RUN_LIMIT, ms }]);
      assert.equal(wire.refusals.length, 1, `refusal at ${ms} ms`);
      assert.equal(wire.unobserved, false, `refusal at ${ms} ms`);
    }
    // A fast 200 with no usage is still a model call with missing usage.
    const fastNoUsage = await observeTurn([{ text: 'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n', ms: 0 }]);
    assert.equal(fastNoUsage.reason, 'missing_usage_on_model_call');
    assert.equal(fastNoUsage.missingUsageCalls, 1);
  });

  describe('(c) everything else stays fail-closed, exactly as today', () => {
    const closed = [
      ['409 with another code', 409, envelope('revision_conflict')],
      ['409 with an unparseable body', 409, 'upstream says no'],
      ['409 with a JSON body that has no error.code', 409, '{"detail":"run_limit_reached"}'],
      ['409 whose code is only a top-level key', 409, '{"code":"run_limit_reached"}'],
      ['409 with an empty body', 409, ''],
      ['403 carrying a refusal code', 403, RUN_LIMIT],
      ['429 carrying a refusal code', 429, RUN_LIMIT],
      ['500 carrying a refusal code', 500, RUN_LIMIT],
      ['500 with no body', 500, ''],
      ['200 carrying a refusal-shaped body (no usage)', 200, RUN_LIMIT],
      ['504 ai_provider_timeout', 504, envelope('ai_provider_timeout')],
    ];
    for (const [label, status, text] of closed) {
      it(`${label} -> BLOCKED missing_usage_on_model_call, no refusal recorded`, async () => {
        const wire = await observeTurn([{ status, text, ms: 30 }]);
        assert.equal(wire.reason, 'missing_usage_on_model_call');
        assert.equal(wire.unobserved, true);
        assert.equal(wire.missingUsageCalls, 1);
        assert.deepEqual(wire.refusals, []);
        assert.equal(wire.endedByRefusal, false);
      });
    }

    it('a request that never got a response stays missing even beside a refusal', async () => {
      const wire = evaluateWireObservation({
        requests: [{ origin: WEB, path: '/x' }, { origin: WEB, path: '/y' }],
        responses: [{ status: 409, usage: null, refusal: { status: 409, code: 'run_limit_reached', limit: 'tool_rounds' } }],
        frameAiOrigin: WEB,
        sawTurnEffects: true,
      });
      assert.equal(wire.reason, 'missing_usage_on_model_call');
      assert.equal(wire.unobserved, true);
    });
  });
});

describe('G7-08 w2p: a turn that ends on a refusal is scored, not BLOCKED', () => {
  const ended = (limit, code = 'run_limit_reached') => ({ endedByRefusal: true, refusals: [{ status: 409, code, limit }] });

  it('FAIL uniwork_run_limit_reached:<limit> when the oracle did not pass on the final reply', () => {
    const scored = scoreRefusalEnd(failVerdict('answer_wrong', { x: 1 }), ended('tool_rounds'));
    assert.equal(scored.status, VERDICT.FAIL);
    assert.equal(scored.reason, 'uniwork_run_limit_reached:tool_rounds');
    assert.equal(scored.details.x, 1);
    assert.equal(scored.details.oracleReason, 'answer_wrong');
  });

  it('FAIL uniwork_<code> for run_expired and conversation_expired', () => {
    assert.equal(scoreRefusalEnd(failVerdict('answer_wrong'), ended(null, 'run_expired')).reason, 'uniwork_run_expired');
    assert.equal(scoreRefusalEnd(failVerdict('answer_wrong'), ended(null, 'conversation_expired')).reason, 'uniwork_conversation_expired');
  });

  it('a PASS from the oracle on the final reply stays PASS', () => {
    const pass = passVerdict('ok');
    assert.equal(scoreRefusalEnd(pass, ended('tool_rounds')), pass);
  });

  it('a BLOCKED verdict and a turn that did not end on a refusal are left as they were', () => {
    const blocked = { ...failVerdict('x'), status: VERDICT.BLOCKED };
    assert.equal(scoreRefusalEnd(blocked, ended('tool_rounds')), blocked);
    const fail = failVerdict('answer_wrong');
    assert.equal(scoreRefusalEnd(fail, { endedByRefusal: false, refusals: [{ status: 409, code: 'run_limit_reached', limit: 'tool_rounds' }] }), fail);
    assert.equal(scoreRefusalEnd(fail, { endedByRefusal: false, refusals: [] }), fail);
  });
});

describe('G7-08 w2p: the matrix continues past a refusal row and records refusals in the row JSON', () => {
  it('X-R1 FAIL uniwork_run_limit_reached:tool_rounds does not stop D-E1; refusals reach the row file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g708-w2p-'));
    try {
      const refusals = [{ status: 409, code: 'run_limit_reached', limit: 'tool_rounds' }];
      let calls = 0;
      const res = await runG708Matrix({
        rows: [getRowById('X-R1'), getRowById('D-E1')], providers: ['uniwork'], host: 'web', runDir: tmp,
        dryRun: true, maxOutputTokens: 100_000, guardOutputTokens: 90_000,
      }, {
        evidenceFn: () => null,
        log: () => {},
        rowRunner: async () => {
          calls += 1;
          const usage = { modelCalls: 9, inputTokens: 900, outputTokens: 90, missingUsageCalls: 0, missingObservationCalls: 0, refusals };
          return calls === 1
            ? { ...failVerdict('uniwork_run_limit_reached:tool_rounds'), usage }
            : { ...passVerdict('ok'), usage: { modelCalls: 1, inputTokens: 1, outputTokens: 1 } };
        },
      });
      assert.equal(calls, 2, 'the next row is started');
      assert.equal(res.runs[0].status, VERDICT.FAIL);
      assert.equal(res.runs[0].reason, 'uniwork_run_limit_reached:tool_rounds');
      assert.deepEqual(res.runs[0].refusals, refusals);
      assert.deepEqual(res.runs[1].refusals, []);
      const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'g7-08', `${res.runs[0].rowId}-uniwork-web.json`), 'utf8'));
      assert.deepEqual(onDisk.refusals, refusals);
      assert.equal(res.exitCode, ROW_EXIT.FAIL);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
