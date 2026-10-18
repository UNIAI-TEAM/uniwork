/**
 * Pure unit tests for `save-observe.mjs` (G7-08 w2e, review r2 findings
 * G708-R2-1, R2-2, R2-3, R2-5, R2-6, R2-7, R2-9). No browser, no live server:
 * every case feeds the helper what the driver would have seen and asserts the
 * scored field or the BLOCKED reason (contract w1b: an absent scored field is
 * BLOCKED, never a default).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listVersions } from '../g7-04/cross-host.mjs';
import {
  InterruptedAiTurnError,
  buildEditSaveObservation,
  buildUndoRedoObserved,
  evaluateWireObservation,
  extractWireUsage,
  interruptionFromTurn,
  isFrameAiPath,
  isModelCompletionPath,
  isSaveIntentPath,
  modelRouteShape,
  observeModelWire,
  observeOldVersionAfterSave,
  parseCommitBaseRevision,
  readVersionBytes,
  readVersionCount,
  toolCallNamesFromSseText,
  usageFromModelResponseBody,
  usageFromSseText,
} from './save-observe.mjs';

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

describe('G7-08 w2e save-observe pure helpers', () => {
  it('R2-2: isSaveIntentPath matches the frame upload/commit routes and the legacy version route only', () => {
    // The three real routes: host upload (docs-frame-api.ts:246), frame commit
    // (:249), legacy version create (handler documents.go).
    assert.equal(isSaveIntentPath('/api/v1/office-frame/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/uploads'), true);
    assert.equal(isSaveIntentPath('/api/v1/office-frame/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/versions/commit'), true);
    assert.equal(isSaveIntentPath('/api/v1/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/versions'), true);
    // Not save intents: reads, the AI turn itself, an unrelated POST.
    assert.equal(isSaveIntentPath('/api/v1/office-frame/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/content'), false);
    assert.equal(isSaveIntentPath('/api/v1/office-frame/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/ai/uniwork/chat/completions'), false);
    // The Documents commit route (router/documents.go:164) is a save intent too.
    assert.equal(isSaveIntentPath('/api/v1/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/versions/commit'), true);
    assert.equal(isSaveIntentPath('/api/v1/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/versions/3'), false);
    assert.equal(isSaveIntentPath(''), false);
    assert.equal(isSaveIntentPath(undefined), false);
  });

  it('R2-3: parseCommitBaseRevision reads the commit base or reports nothing (never a default)', () => {
    assert.equal(parseCommitBaseRevision('{"upload_id":"u1","base_revision":2}'), '2');
    assert.equal(parseCommitBaseRevision('{"base_revision":"7"}'), '7');
    assert.equal(parseCommitBaseRevision(null), null);
    assert.equal(parseCommitBaseRevision(''), null);
    assert.equal(parseCommitBaseRevision('{}'), null);
    assert.equal(parseCommitBaseRevision('{"base_revision":null}'), null);
    assert.equal(parseCommitBaseRevision('not json'), null);
  });

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

  it('R2-6: readVersionCount asks for the strict list and BLOCKs when the array is absent', async () => {
    const seen = [];
    const ok = await readVersionCount(async (args) => (seen.push(args), 3), { apiOrigin: 'http://a', documentId: 'D1', token: 't' });
    assert.deepEqual(ok, { ok: true, count: 3 });
    assert.equal(seen[0].strict, true, 'the g7-08 side asks for the strict form');

    const missing = await readVersionCount(async () => {
      throw new Error('missing_version_list: the body carries no versions array');
    }, { apiOrigin: 'http://a', documentId: 'D1', token: 't' });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, 'missing_version_list');
  });

  it('R2-6: listVersions keeps its lenient default and throws only for the strict g7-08 caller', async () => {
    const fetchWith = (body) => async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    const args = { apiOrigin: 'http://api.test', documentId: 'D1', token: 't' };
    // G7-04 semantics unchanged: a 200 without a versions array is still 0.
    assert.equal(await listVersions({ ...args, fetchImpl: fetchWith({}) }), 0);
    assert.equal(await listVersions({ ...args, fetchImpl: fetchWith({ versions: [{}, {}] }) }), 2);
    // The strict form: no array is an absent scored field, an empty array is a real 0.
    await assert.rejects(listVersions({ ...args, fetchImpl: fetchWith({}), strict: true }), /missing_version_list/);
    await assert.rejects(listVersions({ ...args, fetchImpl: fetchWith({ versions: null }), strict: true }), /missing_version_list/);
    assert.equal(await listVersions({ ...args, fetchImpl: fetchWith({ versions: [] }), strict: true }), 0);
    const blocked = await readVersionCount(listVersions, { ...args, fetchImpl: fetchWith({}) });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'missing_version_list');
  });

  it('R3-4: the lenient default keeps its old expression for a non-array versions body; strict rejects it', async () => {
    const fetchWith = (body) => async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    const args = { apiOrigin: 'http://api.test', documentId: 'D1', token: 't' };
    // The shape the review named: a non-array object that still carries a length.
    assert.equal(await listVersions({ ...args, fetchImpl: fetchWith({ versions: { length: 3 } }) }), 3);
    assert.equal(await listVersions({ ...args, fetchImpl: fetchWith({ versions: 'abc' }) }), 3);
    assert.equal(await listVersions({ ...args, fetchImpl: fetchWith({}) }), 0);
    // Only the strict G7-08 caller turns any non-array body into the absent scored field.
    await assert.rejects(listVersions({ ...args, fetchImpl: fetchWith({ versions: { length: 3 } }), strict: true }), /missing_version_list/);
    await assert.rejects(listVersions({ ...args, fetchImpl: fetchWith({ versions: 'abc' }), strict: true }), /missing_version_list/);
  });

  it('R2-4: the old version is read again by number; no number or a failed GET is BLOCKED', async () => {
    const seen = [];
    const ok = await observeOldVersionAfterSave({ readBytes: async (v) => (seen.push(v), { bytes: new Uint8Array([1]), sha256: 'abc' }), version: 3 });
    assert.deepEqual({ ok: ok.ok, sha256: ok.sha256, version: ok.version }, { ok: true, sha256: 'abc', version: 3 });
    assert.deepEqual(seen, [3]);
    for (const version of [null, undefined, '3']) {
      const noNumber = await observeOldVersionAfterSave({ readBytes: async () => assert.fail('no GET without a number'), version });
      assert.equal(noNumber.reason, 'missing_old_version_bytes_after_save');
    }
    const failed = await observeOldVersionAfterSave({ readBytes: async () => { throw new Error('HTTP 404'); }, version: 1 });
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, 'missing_old_version_bytes_after_save');
    assert.match(failed.detail, /404/);
  });

  it('R2-4: readVersionBytes asks the owner download route for that version and hashes the bytes', async () => {
    const urls = [];
    const fetchImpl = async (url) => { urls.push(String(url)); return new Response(new Uint8Array([7, 8, 9]), { status: 200 }); };
    const out = await readVersionBytes({ apiOrigin: 'http://api.test', fetchImpl, documentId: 'D1', token: 't', version: 2 });
    assert.deepEqual(urls, ['http://api.test/api/v1/documents/D1/download?version=2']);
    assert.deepEqual([...out.bytes], [7, 8, 9]);
    assert.match(out.sha256, /^[0-9a-f]{64}$/);
  });

  it('R2-5: undo/redo observation never infers visibility from executed tools', () => {
    // executedTools alone (dirty false, nothing reverted) is not visibility.
    assert.deepEqual(
      buildUndoRedoObserved({ contentChanged: false, dirtyAfterEdit: false, undoReverted: false, redoRestored: false, undoControl: true, redoControl: true }),
      { aiChangeVisibleBeforeSave: false, aiChangeUndoableBeforeSave: false, missingControl: null },
    );
    // Visible but the undo/redo round trip did not hold: not undoable.
    assert.deepEqual(
      buildUndoRedoObserved({ contentChanged: true, dirtyAfterEdit: true, undoReverted: true, redoRestored: false, undoControl: true, redoControl: true }),
      { aiChangeVisibleBeforeSave: true, aiChangeUndoableBeforeSave: false, missingControl: null },
    );
    // The full round trip: undo reverted, redo restored.
    assert.deepEqual(
      buildUndoRedoObserved({ contentChanged: true, dirtyAfterEdit: true, undoReverted: true, redoRestored: true, undoControl: true, redoControl: true }),
      { aiChangeVisibleBeforeSave: true, aiChangeUndoableBeforeSave: true, missingControl: null },
    );
    // A canvas module with no readable text surface: the host dirty flag speaks.
    assert.deepEqual(
      buildUndoRedoObserved({ contentChanged: null, dirtyAfterEdit: true, undoReverted: true, redoRestored: true, undoControl: true, redoControl: true }),
      { aiChangeVisibleBeforeSave: true, aiChangeUndoableBeforeSave: true, missingControl: null },
    );
    // Missing controls: BLOCKED for the caller, owner F.
    assert.deepEqual(
      buildUndoRedoObserved({ contentChanged: true, dirtyAfterEdit: true, undoControl: false, redoControl: false }),
      { aiChangeVisibleBeforeSave: false, aiChangeUndoableBeforeSave: false, missingControl: 'undo' },
    );
    assert.equal(buildUndoRedoObserved({ undoControl: true, redoControl: false }).missingControl, 'redo');
  });

  it('R2-1/R2-3: buildEditSaveObservation scores the SECOND Save delta, never the first', () => {
    const base = {
      doubleSave: { presses: 2, first: { status: 'saved' }, second: { status: 'saved' } },
      versionsAfterFirstSave: 2, versionsAfterSecondSave: 2,
      revisionAfterAiTurn: '2', lastCommitBaseRevision: '2',
    };
    const ok = buildEditSaveObservation(base);
    assert.equal(ok.ok, true);
    assert.equal(ok.observed.doubleClickVersionsCreated, 0, 'two Saves of one edit add no second version');
    assert.equal(ok.observed.versionsAfterSave, 2);
    assert.equal(ok.observed.saveUsedCurrentBaseRevision, true);

    // A second Save that DID create a version is scored as the duplicate it is.
    assert.equal(buildEditSaveObservation({ ...base, versionsAfterSecondSave: 3 }).observed.doubleClickVersionsCreated, 1);

    // A single Save is never the first delta: BLOCKED.
    assert.equal(buildEditSaveObservation({ ...base, doubleSave: { presses: 1, first: { status: 'saved' } } }).reason, 'missing_double_click_save');
    assert.equal(buildEditSaveObservation({ ...base, doubleSave: null }).reason, 'missing_double_click_save');

    // A second Save that never committed (skipped, timed out, errored) is a lost Save, not a +0.
    for (const second of [{ status: 'timeout', dirty: false }, { status: 'timeout', dirty: true }, { status: 'error', httpStatus: 500 }, null]) {
      assert.equal(
        buildEditSaveObservation({ ...base, doubleSave: { presses: 2, first: { status: 'saved' }, second } }).reason,
        'missing_double_click_save',
      );
    }

    // A failed first Save names its own reason.
    assert.equal(
      buildEditSaveObservation({ ...base, doubleSave: { presses: 2, first: { status: 'error', httpStatus: 409 }, second: { status: 'saved' } } }).reason,
      'web_save_failed_after_ai_edit',
    );

    // No commit base captured (R2-3): BLOCKED, never "used the current revision".
    assert.equal(buildEditSaveObservation({ ...base, lastCommitBaseRevision: null }).reason, 'missing_save_base_revision');
    assert.equal(buildEditSaveObservation({ ...base, lastCommitBaseRevision: undefined }).reason, 'missing_save_base_revision');

    // A stale base is reported as the failure it is, not as a pass.
    assert.equal(
      buildEditSaveObservation({ ...base, lastCommitBaseRevision: '1' }).observed.saveUsedCurrentBaseRevision,
      false,
    );

    // A missing version count is BLOCKED (R2-6), not a delta of 0.
    assert.equal(buildEditSaveObservation({ ...base, versionsAfterSecondSave: undefined }).reason, 'missing_version_list');
    assert.equal(buildEditSaveObservation({ ...base, versionsAfterFirstSave: undefined }).reason, 'missing_version_list');
  });

  it('R3-1: the model route matcher and the response-body readers read both providers', () => {
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
    const { settle } = observeModelWire(page, { requests, responses });

    page.emit('request', fakeRequest('POST', 'http://web.test/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions', JSON.stringify({ tools: [{ function: { name: 'read_range' } }, { function: { name: 'edit_block' } }] })));
    page.emit('request', fakeRequest('GET', 'http://web.test/api/v1/office-frame/documents/D1/content'));
    page.emit('request', fakeRequest('POST', 'http://web.test/api/v1/office-frame/documents/D1/uploads', '{}'));

    page.emit('response', fakeResponse(200, 'http://web.test/api/v1/office-frame/documents/D1/ai/uniwork/chat/completions', 'data: {"usage":{"prompt_tokens":100,"completion_tokens":20}}\n\ndata: [DONE]\n'));
    page.emit('response', fakeResponse(200, 'http://web.test/api/v1/office-frame/documents/D1/content', 'not a model response'));
    assert.equal(await settle(), 0, 'the observer settles every in-flight body before the caller reads it');

    assert.equal(requests.length, 1, 'only the model route is recorded');
    assert.deepEqual(requests[0].body.tools.map((t) => t.function.name), ['read_range', 'edit_block']);
    assert.equal(responses.length, 1);
    assert.deepEqual(responses[0], { status: 200, shape: 'openai', usage: { prompt_tokens: 100, completion_tokens: 20 }, toolCallNames: [] });

    const wire = evaluateWireObservation({ requests, responses, sawTurnEffects: true });
    assert.equal(wire.unobserved, false);
    assert.equal(wire.outputTokens, 20);
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
});
