/**
 * G7-08 w2k: the wire observer against the shape of the real3 smoke (X-R1, model gpt-6-luna): one turn
 * makes three model calls, the last one slow, and the frame stops reading each stream at `data: [DONE]`
 * (`for await ... if (b.raw === '[DONE]') break`, which cancels the body reader). Playwright then
 * cannot read the cancelled body (`Network.getResponseBody: No data found for resource`), so a passive
 * `page.on('response')` + `res.text()` observer saw three responses and usage on two of them.
 *
 * The fake page below models exactly that: a request with no route is answered through a `response`
 * event whose `text()` rejects when the frame cancelled the stream; a request with a route is answered
 * by the route handler, which reads the whole body through `route.fetch` (the frame's cancel then only
 * reaches the fulfilled copy). Every case asserts the scored usage or the fail-closed BLOCKED reason.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateWireObservation, observeModelWire } from './wire-observe.mjs';

const WEB = 'http://web.test';
const MODEL_URL = `${WEB}/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions`;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const sseText = (promptTokens, completionTokens) => `data: ${JSON.stringify({
  choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
})}\n\ndata: [DONE]\n\n`;

/** A Playwright-shaped page: `on`/`emit`, plus `route` (globs are matched by prefix of the model route). */
function makeFakePage() {
  const listeners = new Map();
  const routes = [];
  const page = {
    on(event, handler) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      return page;
    },
    async route(glob, handler) { routes.push({ glob, handler }); },
    emit(event, payload) { for (const handler of listeners.get(event) ?? []) handler(payload); },
    routes,
  };
  return page;
}

const fakeRequest = (url) => ({
  method: () => 'POST', url: () => url, postData: () => '{}', headers: () => ({}),
});

/**
 * One frame POST. `upstreamMs` is how long the server holds the answer; `cancelsAtDone` is the frame's
 * `break` at `[DONE]`. Resolves once the frame has what it asked for (or an abort).
 */
async function frameCall(page, { text, upstreamMs = 0, cancelsAtDone = true }) {
  const request = fakeRequest(MODEL_URL);
  page.emit('request', request);
  const routed = page.routes.find((r) => r.glob.includes('/ai/uniwork/chat/completions'));
  if (routed) {
    const frameSaw = {};
    // Playwright does not await the handler: the frame has its answer once the route is fulfilled or aborted.
    let answered;
    const frameAnswered = new Promise((resolve) => { answered = resolve; });
    routed.handler({
      request: () => request,
      continue: async () => { frameSaw.continued = true; },
      abort: async () => { frameSaw.aborted = true; answered(); },
      fetch: async ({ timeout } = {}) => {
        if (upstreamMs > (timeout ?? Infinity)) {
          await sleep(Math.min(upstreamMs, timeout ?? upstreamMs));
          throw new Error('route.fetch: timeout');
        }
        await sleep(upstreamMs);
        return {
          status: () => 200,
          headers: () => ({ 'content-type': 'text/event-stream', 'content-encoding': 'gzip', 'content-length': '1' }),
          body: async () => Buffer.from(text),
          text: async () => text,
        };
      },
      fulfill: async (opts) => { frameSaw.fulfilled = opts; answered(); },
    });
    await frameAnswered;
    return frameSaw;
  }
  await sleep(upstreamMs);
  page.emit('response', {
    status: () => 200,
    url: () => MODEL_URL,
    request: () => request,
    text: async () => {
      if (cancelsAtDone) throw new Error('response.text: Protocol error (Network.getResponseBody): No data found for resource with given identifier');
      return text;
    },
  });
  return {};
}

/** The real3 turn: two fast tool rounds, then the largest and slowest final answer. */
async function realThreeCallTurn(page, { observer, last = {} } = {}) {
  await frameCall(page, { text: sseText(5430, 16), upstreamMs: 5, cancelsAtDone: false });
  await frameCall(page, { text: sseText(5651, 224), upstreamMs: 10, cancelsAtDone: false });
  const lastCall = frameCall(page, { text: sseText(9075, 246), upstreamMs: 120, ...last });
  return { lastCall, observer };
}

const observe = (page, overrides = {}) => {
  const requests = [];
  const responses = [];
  const aiPaths = [];
  const observer = observeModelWire(page, {
    requests, responses, aiPaths, frameAiOrigin: WEB, responseTimeoutMs: 400, ...overrides,
  });
  return { observer, requests, responses, aiPaths };
};

describe('G7-08 w2k: the wire observer on the real3 three-call turn', () => {
  it('counts the last slow call whose stream the frame cancels at [DONE] (real3: missingUsageCalls 1 -> 0)', async () => {
    const page = makeFakePage();
    const { observer, requests, responses, aiPaths } = observe(page);
    await observer.ready;
    const { lastCall } = await realThreeCallTurn(page);
    await lastCall;
    await observer.settle();

    const wire = evaluateWireObservation({ requests, responses, aiPaths, frameAiOrigin: WEB, sawTurnEffects: true });
    assert.deepEqual(
      { modelCalls: wire.modelCalls, missingUsageCalls: wire.missingUsageCalls, inputTokens: wire.inputTokens, outputTokens: wire.outputTokens },
      { modelCalls: 3, missingUsageCalls: 0, inputTokens: 5430 + 5651 + 9075, outputTokens: 16 + 224 + 246 },
    );
    assert.equal(wire.unobserved, false);
  });

  it('waits for a model call still in flight when the turn is evaluated (the turn can end between tool rounds)', async () => {
    const page = makeFakePage();
    const { observer, requests, responses, aiPaths } = observe(page);
    await observer.ready;
    const { lastCall } = await realThreeCallTurn(page);
    // The turn-effect wait ended before the third answer: only the settle of the observer stands between
    // the evaluation and a half-read turn.
    assert.equal(responses.length, 2, 'the third answer is not in yet');
    await observer.settle();
    assert.equal(responses.length, 3, 'settle read the in-flight call to completion');
    await lastCall;

    const wire = evaluateWireObservation({ requests, responses, aiPaths, frameAiOrigin: WEB, sawTurnEffects: true });
    assert.equal(wire.missingUsageCalls, 0);
    assert.equal(wire.modelCalls, 3);
  });

  it('hands the frame the same answer it would have got, without the hop-by-hop framing headers', async () => {
    const page = makeFakePage();
    const { observer } = observe(page);
    await observer.ready;
    const saw = await frameCall(page, { text: sseText(10, 2), upstreamMs: 1, cancelsAtDone: false });

    assert.equal(saw.fulfilled.status, 200);
    assert.equal(Buffer.from(saw.fulfilled.body).toString('utf8'), sseText(10, 2));
    assert.equal(saw.fulfilled.headers['content-type'], 'text/event-stream');
    for (const dropped of ['content-encoding', 'content-length', 'transfer-encoding']) {
      assert.equal(dropped in saw.fulfilled.headers, false, `${dropped} no longer describes the replayed body`);
    }
  });

  it('fail closed: a call that never completes stays BLOCKED missing_usage_on_model_call, never a zero-token success', async () => {
    const page = makeFakePage();
    const errors = [];
    const { observer, requests, responses, aiPaths } = observe(page, { responseTimeoutMs: 60, onError: (e) => errors.push(e) });
    await observer.ready;
    await frameCall(page, { text: sseText(5430, 16), upstreamMs: 1, cancelsAtDone: false });
    const stuck = await frameCall(page, { text: sseText(9075, 246), upstreamMs: 10_000 });
    await observer.settle();

    assert.equal(stuck.aborted, true, 'the frame request fails instead of hanging for ever');
    const wire = evaluateWireObservation({ requests, responses, aiPaths, frameAiOrigin: WEB, sawTurnEffects: true });
    assert.equal(wire.unobserved, true);
    assert.equal(wire.reason, 'missing_usage_on_model_call');
    assert.equal(responses.length, 1);
    assert.equal(requests.length, 2);
    assert.equal(errors.length, 1, 'the failed read is reported, not swallowed');
  });

  it('fail closed: a completed answer that truly carries no usage stays BLOCKED', async () => {
    const page = makeFakePage();
    const { observer, requests, responses, aiPaths } = observe(page);
    await observer.ready;
    await frameCall(page, {
      text: 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', upstreamMs: 1, cancelsAtDone: false,
    });
    await observer.settle();

    const wire = evaluateWireObservation({ requests, responses, aiPaths, frameAiOrigin: WEB, sawTurnEffects: true });
    assert.equal(wire.reason, 'missing_usage_on_model_call');
    assert.equal(wire.missingUsageCalls, 1);
    assert.equal(wire.outputTokens, 0);
  });

  it('a request on a third origin is not waited for and is not routed (frame_ai_wrong_origin stays prompt)', async () => {
    const page = makeFakePage();
    const { observer, requests, responses, aiPaths } = observe(page, { responseTimeoutMs: 5_000 });
    await observer.ready;
    page.emit('request', { method: () => 'POST', url: () => 'http://elsewhere.test/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions', postData: () => '{}' });
    const started = Date.now();
    await observer.settle();

    assert.ok(Date.now() - started < 1_000, 'settle did not wait for a request the route can never see');
    const wire = evaluateWireObservation({ requests, responses, aiPaths, frameAiOrigin: WEB, sawTurnEffects: true });
    assert.equal(wire.reason, 'frame_ai_wrong_origin');
  });
});
