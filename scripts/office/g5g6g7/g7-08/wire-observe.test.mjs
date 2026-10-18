/**
 * Pure unit tests for `wire-observe.mjs` (G7-08 w2f/w2g, review r3 findings
 * G708-R2-7, R3-1, R3-3; review r4 findings G708-R4-1, R4-3). No browser, no live
 * server: the observer is driven through an injected Playwright-shaped fake page,
 * and every case asserts the scored usage or the BLOCKED reason (contract w1b: an
 * absent scored field is BLOCKED, never a default). The Save half of the same
 * driver is `save-observe.test.mjs`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  InterruptedAiTurnError,
  MODEL_CALL_ROUTE_GLOBS,
  evaluateWireObservation,
  extractWireToolCalls,
  extractWireUsage,
  interruptionFromTurn,
  isFrameAiPath,
  isModelCompletionPath,
  modelRouteShape,
  observeModelWire,
  toolCallNamesFromSseText,
  usageFromModelResponseBody,
  usageFromSseText,
} from './wire-observe.mjs';

/** A Playwright-shaped event emitter: `on` and `emit`, like the page the driver listens on. */
function makeFakePage() {
  const listeners = new Map();
  const page = {
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
      return page;
    },
    emit(event, payload) {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
  };
  return page;
}

const fakeRequest = (method, url, postData = null) => ({ method: () => method, url: () => url, postData: () => postData });
const fakeResponse = (status, url, text) => ({
  status: () => status,
  url: () => url,
  request: () => fakeRequest('POST', url),
  text: async () => text,
});

const ANTHROPIC_URL = 'http://web.test/api/v1/office-frame/documents/D1/ai/byok/anthropic/messages';
const OPENAI_URL = 'http://web.test/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions';
const GEMINI_URL = 'http://web.test/api/v1/office-frame/documents/D1/ai/byok/gemini/generate';

async function observeSseTurn(url, sseText) {
  const page = makeFakePage();
  const requests = [];
  const responses = [];
  const { settle } = observeModelWire(page, { requests, responses });
  page.emit('request', fakeRequest('POST', url, '{}'));
  page.emit('response', fakeResponse(200, url, sseText));
  await settle();
  return { requests, responses, wire: evaluateWireObservation({ requests, responses, sawTurnEffects: true }) };
}

describe('G7-08 w2g wire-observe pure helpers', () => {
  it('R2-7: extractWireUsage counts a response without usage as unknown, never as 0', () => {
    assert.deepEqual(extractWireUsage([]), { modelCalls: 0, inputTokens: 0, outputTokens: 0, missingUsageCalls: 0 });
    assert.deepEqual(
      extractWireUsage([
        { usage: { prompt_tokens: 120, completion_tokens: 30 } },
        { usage: { input_tokens: 80, output_tokens: 20 } },
      ]),
      { modelCalls: 2, inputTokens: 200, outputTokens: 50, missingUsageCalls: 0 },
    );
    // The review's case: a 200 with no usage must not be a trusted 0-token call.
    assert.deepEqual(extractWireUsage([{ status: 200 }]), {
      modelCalls: 1, inputTokens: 0, outputTokens: 0, missingUsageCalls: 1,
    });
    // One count without the other is unknown too.
    assert.equal(extractWireUsage([{ usage: { prompt_tokens: 10 } }]).missingUsageCalls, 1);
    assert.deepEqual(extractWireUsage([{ usage: { prompt_tokens: 10, completion_tokens: 5 } }, {}]), {
      modelCalls: 2, inputTokens: 10, outputTokens: 5, missingUsageCalls: 1,
    });
  });

  it('R3-1: the model route matcher and the response-body readers read every registered route', () => {
    // G708-R4-2: the matcher pins the routes the server actually registers
    // (router/office_frame_ai.go:74,79,84,126), not a shape it does not serve.
    assert.equal(isModelCompletionPath('/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions'), true);
    assert.equal(isModelCompletionPath('/api/v1/office-frame/documents/D1/ai/byok/openai/chat/completions'), true);
    assert.equal(isModelCompletionPath('/api/v1/office-frame/documents/D1/ai/byok/anthropic/messages'), true);
    assert.equal(isModelCompletionPath('/api/v1/office-frame/documents/D1/ai/byok/gemini/generate'), true);
    assert.equal(isModelCompletionPath('/api/v1/office-frame/documents/D1/ai/openai/chat/completions'), false, 'no such route is registered');
    assert.equal(isModelCompletionPath('/api/v1/office-frame/documents/D1/ai/byok/x/models'), false, '/models is a GET listing, not a model call');
    assert.equal(isModelCompletionPath('/api/v1/office-frame/documents/D1/ai/uniwork/models'), false);
    assert.equal(isModelCompletionPath('/api/v1/office-frame/documents/D1/uploads'), false);
    assert.equal(isModelCompletionPath(undefined), false);

    // R4-1: each registered route is read in the shape its own handler answers with
    // (handler/ai_mount.go:71-73 -> ai/proxy.go:61-63,223-236; uniwork -> openai_facade).
    assert.equal(modelRouteShape('/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions'), 'openai');
    assert.equal(modelRouteShape('/api/v1/office-frame/documents/D1/ai/byok/openai/chat/completions'), 'openai');
    assert.equal(modelRouteShape('/api/v1/office-frame/documents/D1/ai/byok/anthropic/messages'), 'anthropic');
    assert.equal(modelRouteShape('/api/v1/office-frame/documents/D1/ai/byok/gemini/generate'), 'gemini');
    assert.equal(modelRouteShape('/api/v1/office-frame/documents/D1/uploads'), null);
    // The broad net for R4-3: any POST under the frame's AI mount, whatever shape.
    assert.equal(isFrameAiPath('/api/v1/office-frame/documents/D1/ai/byok/openai/chat/completions'), true);
    assert.equal(isFrameAiPath('/api/v1/office-frame/documents/D1/ai/uniwork/models'), true);
    assert.equal(isFrameAiPath('/api/v1/office-frame/documents/D1/uploads'), false);

    // R4-1: the dry-run stub globs are the same four routes, so the stub cannot miss one the
    // matcher counts. A Playwright glob is `*`-per-segment; check each against its own URL.
    assert.deepEqual(MODEL_CALL_ROUTE_GLOBS, [
      '**/api/v1/office-frame/documents/*/ai/uniwork/chat/completions',
      '**/api/v1/office-frame/documents/*/ai/byok/*/chat/completions',
      '**/api/v1/office-frame/documents/*/ai/byok/*/messages',
      '**/api/v1/office-frame/documents/*/ai/byok/*/generate',
    ]);
    // Playwright glob semantics: `**` crosses segments, `*` stays within one.
    const globRe = (glob) => new RegExp(`^${glob
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')}$`);
    const routeUrls = [
      'http://web.test/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions',
      'http://web.test/api/v1/office-frame/documents/D1/ai/byok/openai/chat/completions',
      'http://web.test/api/v1/office-frame/documents/D1/ai/byok/anthropic/messages',
      'http://web.test/api/v1/office-frame/documents/D1/ai/byok/gemini/generate',
    ];
    for (const url of routeUrls) {
      assert.equal(MODEL_CALL_ROUTE_GLOBS.some((glob) => globRe(glob).test(url)), true, `${url} is stubbed by a glob`);
      assert.equal(isModelCompletionPath(new URL(url).pathname), true, `${url} is counted by the matcher`);
    }
    assert.equal(
      MODEL_CALL_ROUTE_GLOBS.some((glob) => globRe(glob).test('http://web.test/api/v1/office-frame/documents/D1/ai/openai/chat/completions')),
      false,
      'the stub does not arm on a path no route serves',
    );

    assert.deepEqual(usageFromModelResponseBody({ usage: { prompt_tokens: 12, completion_tokens: 4 } }), { prompt_tokens: 12, completion_tokens: 4 });
    assert.deepEqual(usageFromModelResponseBody({ usage: { input_tokens: 12, output_tokens: 4 } }), { prompt_tokens: 12, completion_tokens: 4 });
    assert.equal(usageFromModelResponseBody({ usage: { prompt_tokens: 12 } }), null);
    assert.equal(usageFromModelResponseBody({}), null);

    const sse = 'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"usage":{"prompt_tokens":30,"completion_tokens":7},"choices":[{"delta":{}}]}\n\ndata: [DONE]\n';
    assert.deepEqual(usageFromSseText(sse), { prompt_tokens: 30, completion_tokens: 7 });
    assert.deepEqual(usageFromSseText('{"usage":{"prompt_tokens":1,"completion_tokens":2}}'), { prompt_tokens: 1, completion_tokens: 2 });
    assert.equal(usageFromSseText('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: [DONE]\n'), null, 'a stream with no usage chunk is an unknown');
    assert.equal(usageFromSseText(''), null);
    assert.equal(usageFromSseText('<html>502</html>'), null);

    // R4-1: the Anthropic `/messages` stream - input on message_start, output on
    // message_delta, both cumulative (ai/proxy.go:433-441).
    const anthropicSse = 'data: {"type":"message_start","message":{"usage":{"input_tokens":41}}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":9}}\n\ndata: [DONE]\n';
    assert.deepEqual(usageFromSseText(anthropicSse, 'anthropic'), { prompt_tokens: 41, completion_tokens: 9 });
    assert.deepEqual(
      usageFromModelResponseBody({ usage: { input_tokens: 6, output_tokens: 3 } }, 'anthropic'),
      { prompt_tokens: 6, completion_tokens: 3 },
    );
    // R4-1: the Gemini `/generate` body (ai/proxy.go:426-432); thoughts count as output.
    assert.deepEqual(
      usageFromModelResponseBody({ usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 5, thoughtsTokenCount: 2 } }, 'gemini'),
      { prompt_tokens: 7, completion_tokens: 7 },
    );
    assert.deepEqual(
      usageFromSseText('data: {"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":4}}\n', 'gemini'),
      { prompt_tokens: 8, completion_tokens: 4 },
    );
    // A shape whose own block is absent is an unknown, never 0 - the wrong-shape body
    // must not be read as a zero-token call.
    assert.equal(usageFromSseText('data: {"choices":[{"delta":{}}]}\n\ndata: [DONE]\n', 'anthropic'), null);
    assert.equal(usageFromModelResponseBody({ usage: { prompt_tokens: 3, completion_tokens: 1 } }, 'anthropic'), null);
    assert.equal(usageFromModelResponseBody({ usage: { input_tokens: 3, output_tokens: 1 } }, 'gemini'), null);

    assert.deepEqual(
      toolCallNamesFromSseText('data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"read_range"}}]}}]}\n\ndata: [DONE]\n'),
      ['read_range'],
    );
    assert.deepEqual(toolCallNamesFromSseText('not an sse'), []);
    // R4-1: the tool names of the other two protocols come from their own frames.
    assert.deepEqual(
      toolCallNamesFromSseText('data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"edit_block"}}\n', 'anthropic'),
      ['edit_block'],
    );
    assert.deepEqual(
      toolCallNamesFromSseText('data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"propose_operations"}}]}}]}\n', 'gemini'),
      ['propose_operations'],
    );
  });

  it('R3-1: the wire tool surface names what the frame offered and what it executed', () => {
    const wire = extractWireToolCalls(
      [
        {
          body: {
            tools: [{ function: { name: 'read_range' } }, { function: { name: 'aggregate_range' } }],
            messages: [{ role: 'assistant', tool_calls: [{ function: { name: 'aggregate_range' } }] }],
          },
        },
      ],
      [{ toolCallNames: ['read_range'] }],
    );
    assert.deepEqual(wire.offeredTools, ['read_range', 'aggregate_range']);
    assert.deepEqual(wire.executedTools, ['aggregate_range', 'read_range']);
  });

  it('R3-1: an observed turn is fail-closed - an empty collection is never a zero-token run', () => {
    // Nothing observed at all: BLOCKED, never a trusted zero.
    const empty = evaluateWireObservation({ requests: [], responses: [], sawTurnEffects: false });
    assert.equal(empty.unobserved, true);
    assert.equal(empty.reason, 'missing_model_call_observation');
    assert.equal(empty.modelCalls, 0);
    assert.equal(empty.missingObservationCalls, 1, 'the budget must fail closed on it too');

    // A request with no response at all.
    const noResponse = evaluateWireObservation({ requests: [{ body: {} }], responses: [], sawTurnEffects: true });
    assert.equal(noResponse.reason, 'missing_usage_on_model_call');
    assert.equal(noResponse.missingUsageCalls, 0);
    assert.deepEqual(noResponse.detail, { requests: 1, responses: 0, missingUsageCalls: 0 });

    // A response that arrived without usage (the review's case).
    const noUsage = evaluateWireObservation({
      requests: [{ body: { tools: [{ function: { name: 'read_range' } }] } }],
      responses: [{ status: 200, usage: null }],
      sawTurnEffects: true,
    });
    assert.equal(noUsage.reason, 'missing_usage_on_model_call');
    assert.equal(noUsage.missingUsageCalls, 1);

    // The turn showed effects (a panel reply) but no request was observed: the observer missed the route.
    const missedRoute = evaluateWireObservation({ requests: [], responses: [], sawTurnEffects: true });
    assert.equal(missedRoute.reason, 'missing_model_call_observation');
    assert.equal(missedRoute.detail.sawTurnEffects, true);

    // A normal completion with usage is counted.
    const counted = evaluateWireObservation({
      requests: [{ body: {} }],
      responses: [{ status: 200, usage: { prompt_tokens: 100, completion_tokens: 20 } }],
      sawTurnEffects: true,
    });
    assert.deepEqual(counted, {
      modelCalls: 1, inputTokens: 100, outputTokens: 20, missingUsageCalls: 0,
      unobserved: false, missingObservationCalls: 0, reason: null, detail: null,
    });
  });

  it('R3-1: the injected page observer records requests, offered tools and every response', async () => {
    const page = makeFakePage();
    const requests = [];
    const responses = [];
    const aiPaths = [];
    const { settle } = observeModelWire(page, { requests, responses, aiPaths });

    page.emit('request', fakeRequest('POST', 'http://web.test/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions', JSON.stringify({ tools: [{ function: { name: 'read_range' } }, { function: { name: 'edit_block' } }] })));
    page.emit('request', fakeRequest('GET', 'http://web.test/api/v1/office-frame/documents/D1/content'));
    page.emit('request', fakeRequest('POST', 'http://web.test/api/v1/office-frame/documents/D1/uploads', '{}'));

    page.emit('response', fakeResponse(200, 'http://web.test/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions', 'data: {"usage":{"prompt_tokens":100,"completion_tokens":20}}\n\ndata: [DONE]\n'));
    page.emit('response', fakeResponse(200, 'http://web.test/api/v1/office-frame/documents/D1/content', 'not a model response'));
    assert.equal(await settle(), 0, 'the observer settles every in-flight body before the caller reads it');

    assert.equal(requests.length, 1, 'only the model route is recorded');
    assert.deepEqual(requests[0].body.tools.map((t) => t.function.name), ['read_range', 'edit_block']);
    assert.equal(requests[0].shape, 'openai', 'the route carries the shape its usage is read in');
    assert.equal(responses.length, 1);
    assert.deepEqual(responses[0], { status: 200, shape: 'openai', usage: { prompt_tokens: 100, completion_tokens: 20 }, toolCallNames: [] });
    assert.deepEqual(aiPaths, [{ path: '/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions' }], 'the broad net sees the frame AI POST');

    const wire = evaluateWireObservation({ requests, responses, sawTurnEffects: true });
    assert.equal(wire.unobserved, false);
    assert.equal(wire.outputTokens, 20);
  });

  it('G708-R4-1: the observer counts a BYOK vendor turn in its own shape', async () => {
    const page = makeFakePage();
    const requests = [];
    const responses = [];
    const aiPaths = [];
    const { settle } = observeModelWire(page, { requests, responses, aiPaths });
    const byokUrl = 'http://web.test/api/v1/office-frame/documents/D1/ai/byok/anthropic/messages';
    page.emit('request', fakeRequest('POST', byokUrl, '{}'));
    page.emit('response', fakeResponse(200, byokUrl, 'data: {"type":"message_start","message":{"usage":{"input_tokens":41}}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":9}}\n'));
    await settle();

    assert.equal(requests.length, 1, 'the registered BYOK route is matched');
    assert.equal(responses.length, 1);
    assert.deepEqual(responses[0].usage, { prompt_tokens: 41, completion_tokens: 9 });
    const wire = evaluateWireObservation({ requests, responses, sawTurnEffects: true });
    assert.equal(wire.unobserved, false, 'a BYOK turn is counted, not dropped');
    assert.deepEqual({ inputTokens: wire.inputTokens, outputTokens: wire.outputTokens }, { inputTokens: 41, outputTokens: 9 });
  });

  it('R3-1: a completion without usage through the injected page is BLOCKED, never counted', async () => {
    const page = makeFakePage();
    const requests = [];
    const responses = [];
    const { settle } = observeModelWire(page, { requests, responses });
    page.emit('request', fakeRequest('POST', 'http://web.test/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions', '{}'));
    page.emit('response', fakeResponse(200, 'http://web.test/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions', 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n'));
    await settle();

    const wire = evaluateWireObservation({ requests, responses, sawTurnEffects: true });
    assert.equal(wire.reason, 'missing_usage_on_model_call');
    assert.equal(wire.missingUsageCalls, 1);
    assert.equal(wire.outputTokens, 0);
  });

  it('R3-1: a model request the observer never answered is BLOCKED, and a listener failure never throws into the page', async () => {
    const page = makeFakePage();
    const requests = [];
    const responses = [];
    const errors = [];
    const { settle } = observeModelWire(page, { requests, responses, onError: (err) => errors.push(err) });
    page.emit('request', fakeRequest('POST', 'http://web.test/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions', '{}'));
    page.emit('response', fakeResponse(200, 'http://web.test/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions', 'data: [DONE]\n'));
    await settle();

    assert.equal(requests.length, 1);
    assert.equal(responses.length, 1, 'a stream with no usage is still a recorded response');
    assert.equal(responses[0].usage, null);
    assert.equal(evaluateWireObservation({ requests, responses, sawTurnEffects: true }).reason, 'missing_usage_on_model_call');

    // A listener that throws must not take the turn down.
    const broken = makeFakePage();
    const brokenErrors = [];
    const brokenObserver = observeModelWire(broken, { requests: [], responses: [], onError: (err) => brokenErrors.push(err) });
    broken.emit('request', { method: () => 'POST', url: () => 'not a url', postData: () => '{}' });
    await brokenObserver.settle();
    assert.equal(brokenErrors.length, 1);
    assert.equal(observeModelWire(null).settle() instanceof Promise, true, 'a missing page is a no-op, not a crash');
  });

  it('R3-3: a turn that threw after a model request is an unknown-usage stop, not a bare crash', () => {
    const beforeAnyRequest = interruptionFromTurn(new Error('composer detached'), { requests: [], responses: [] });
    assert.equal(beforeAnyRequest instanceof InterruptedAiTurnError, false, 'no request began: the caller keeps row_runner_threw');
    assert.equal(beforeAnyRequest.message, 'composer detached');

    const afterRequest = interruptionFromTurn(new Error('frame navigated away'), {
      requests: [{ body: {} }], responses: [],
    });
    assert.equal(afterRequest instanceof InterruptedAiTurnError, true);
    assert.equal(afterRequest.usage.missingUsageCalls, 1);
    assert.match(afterRequest.message, /frame navigated away/);

    const afterCountedResponse = interruptionFromTurn(new Error('panel closed'), {
      requests: [{ body: {} }], responses: [{ status: 200, usage: { prompt_tokens: 50, completion_tokens: 10 } }],
    });
    assert.equal(afterCountedResponse.usage.missingUsageCalls, 1, 'the thrown turn is still unknown');
    assert.equal(afterCountedResponse.usage.outputTokens, 10);
    assert.equal(interruptionFromTurn(null, { requests: [], responses: [] }), null);

    // G708-R4-3: an empty MATCHED list is not a proof - the matcher can miss a route.
    // A frame AI POST the broader observer saw makes the turn an unknown-usage stop.
    const byokMissed = interruptionFromTurn(new Error('frame navigated away'), {
      requests: [], responses: [], aiPaths: [{ path: '/api/v1/office-frame/documents/D1/ai/byok/openai/chat/completions' }],
    });
    assert.equal(byokMissed instanceof InterruptedAiTurnError, true, 'a missed route is not "no request began"');
    assert.equal(byokMissed.usage.missingUsageCalls, 1);
    assert.equal(isFrameAiPath('/api/v1/office-frame/documents/D1/ai/byok/openai/chat/completions'), true);
  });

  it('G708-R5-1 (a): Anthropic message_start only is unknown usage', async () => {
    const { responses, wire } = await observeSseTurn(
      ANTHROPIC_URL,
      'data: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":1}}}\n',
    );
    assert.equal(responses[0].usage, null, 'message_start output_tokens is not a complete stream');
    assert.ok(wire.missingUsageCalls >= 1);
    assert.equal(wire.reason, 'missing_usage_on_model_call');
  });

  it('G708-R5-1 (b): Anthropic start + partial message_delta is unknown usage', async () => {
    const { responses, wire } = await observeSseTurn(
      ANTHROPIC_URL,
      'data: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":1}}}\n\ndata: {"type":"message_delta","usage":{"output_tok\n',
    );
    assert.equal(responses[0].usage, null, 'a cut message_delta is not a complete stream');
    assert.ok(wire.missingUsageCalls >= 1);
  });

  it('G708-R5-1 (c): Anthropic start + delta + stop is counted', async () => {
    const { responses, wire } = await observeSseTurn(
      ANTHROPIC_URL,
      'data: {"type":"message_start","message":{"usage":{"input_tokens":25}}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":9}}\n\ndata: {"type":"message_stop"}\n',
    );
    assert.deepEqual(responses[0].usage, { prompt_tokens: 25, completion_tokens: 9 });
    assert.equal(wire.missingUsageCalls, 0);
    assert.equal(wire.unobserved, false);
  });

  it('G708-R5-1 (d): OpenAI usage is counted only from a complete chunk before [DONE]', async () => {
    const counted = await observeSseTurn(
      OPENAI_URL,
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"usage":{"prompt_tokens":30,"completion_tokens":7}}\n\ndata: [DONE]\n',
    );
    assert.deepEqual(counted.responses[0].usage, { prompt_tokens: 30, completion_tokens: 7 });
    assert.equal(counted.wire.missingUsageCalls, 0);

    const cutBefore = await observeSseTurn(OPENAI_URL, 'data: {"choices":[{"delta":{"content":"a"}}]}\n');
    assert.equal(cutBefore.responses[0].usage, null, 'cut before the usage chunk');
    assert.ok(cutBefore.wire.missingUsageCalls >= 1);

    const cutInside = await observeSseTurn(OPENAI_URL, 'data: {"usage":{"prompt_tokens":30,"completion_tok\n');
    assert.equal(cutInside.responses[0].usage, null, 'cut inside the usage chunk');
    assert.ok(cutInside.wire.missingUsageCalls >= 1);

    const noDone = await observeSseTurn(OPENAI_URL, 'data: {"usage":{"prompt_tokens":30,"completion_tokens":7}}\n');
    assert.equal(noDone.responses[0].usage, null, 'a complete usage chunk without [DONE] is still incomplete');
    assert.ok(noDone.wire.missingUsageCalls >= 1);
  });

  it('G708-R5-1 (e): Gemini usage counts only when the last usage chunk has finishReason', async () => {
    const noFinish = await observeSseTurn(
      GEMINI_URL,
      'data: {"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":4}}\n',
    );
    assert.equal(noFinish.responses[0].usage, null, 'cumulative usage without finishReason is a cut stream');
    assert.ok(noFinish.wire.missingUsageCalls >= 1);

    const withFinish = await observeSseTurn(
      GEMINI_URL,
      'data: {"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":4},"candidates":[{"finishReason":"STOP"}]}\n',
    );
    assert.deepEqual(withFinish.responses[0].usage, { prompt_tokens: 8, completion_tokens: 4 });
    assert.equal(withFinish.wire.missingUsageCalls, 0);
    assert.equal(withFinish.wire.unobserved, false);
  });
});
