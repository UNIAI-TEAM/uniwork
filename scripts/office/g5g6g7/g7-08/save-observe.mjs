// G7-08 (UNI-1385) w2e/w2f: the Save / AI-turn observation helpers of the web driver
// (review r2, findings G708-R2-1, R2-2, R2-3, R2-5, R2-6, R2-7, R2-9; review r3,
// findings G708-R3-1, R3-3). Pure by contract: no filesystem, no Playwright import -
// the driver feeds them what it saw, or hands the wire observer an injected page it
// only listens on, so every scored field is either measured or BLOCKED, never
// defaulted (contract w1b).
//
// Settled field meanings (G708-R2-1; driver, builder and oracle agree):
//   versionsAfterFirstSave     - version count after the FIRST Save's commit.
//   versionsAfterSecondSave    - version count after the second Save of the same
//                                gesture settled. `versionsAfterSave` in the row
//                                observation is this count.
//   doubleClickVersionsCreated - versions the SECOND Save added
//                                (versionsAfterSecondSave - versionsAfterFirstSave):
//                                0 when the double click stays a single version,
//                                never the first Save's delta.

import { callTracerApi } from '../g7-10/tracer.mjs';
import { sha256Hex } from '../harness/fixture-files.mjs';

/**
 * R2-2: is this POST pathname a Save intent of the frame?
 * The host stages the bytes at `POST /api/v1/office-frame/documents/{id}/uploads`
 * and commits them at `.../versions/commit`
 * (server/internal/handler/router/office_frame.go:28,74,79; packages/core/office/docs-frame-api.ts:246,249);
 * the legacy version route `POST /api/v1/documents/{id}/versions` still exists.
 */
export function isSaveIntentPath(pathname) {
  const p = String(pathname ?? '');
  return (
    /\/office-frame\/documents\/[^/]+\/uploads$/.test(p) ||
    /\/versions\/commit$/.test(p) ||
    /\/documents\/[^/]+\/versions$/.test(p)
  );
}

/**
 * R2-3: the commit's `base_revision` out of the frame's own POST body, or null
 * when the body was absent, empty, not JSON, or carried no base - the caller
 * turns null into BLOCKED `missing_save_base_revision` (absent scored field).
 */
export function parseCommitBaseRevision(postData) {
  if (typeof postData !== 'string' || postData.trim() === '') return null;
  let body;
  try {
    body = JSON.parse(postData);
  } catch {
    return null;
  }
  const base = body?.base_revision;
  return base === undefined || base === null ? null : String(base);
}

/**
 * R2-7: usage of every recorded model response. A response without both token
 * counts is an unknown, not a zero: it is counted in `missingUsageCalls` and
 * adds nothing to the totals, so the budget fail-closes instead of trusting 0.
 */
export function extractWireUsage(responses = []) {
  let modelCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let missingUsageCalls = 0;
  for (const res of responses) {
    modelCalls += 1;
    const input = res?.usage?.prompt_tokens ?? res?.usage?.input_tokens;
    const output = res?.usage?.completion_tokens ?? res?.usage?.output_tokens;
    if (typeof input !== 'number' || typeof output !== 'number') {
      missingUsageCalls += 1;
      continue;
    }
    inputTokens += Number(input) || 0;
    outputTokens += Number(output) || 0;
  }
  return { modelCalls, inputTokens, outputTokens, missingUsageCalls };
}

/**
 * R3-3: a row runner threw after a model request may have begun, so what that turn
 * consumed is unknown. The error carries that unknown usage (`missingUsageCalls >= 1`)
 * so the run stops the matrix instead of starting the next row on a trusted zero.
 * A failure that provably happened before any model request is thrown as-is, and
 * the caller keeps its separate `row_runner_threw` error for it.
 */
export class InterruptedAiTurnError extends Error {
  constructor(cause, usage = {}) {
    super(`interrupted AI turn: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'InterruptedAiTurnError';
    this.cause = cause;
    this.usage = {
      modelCalls: Number(usage?.modelCalls ?? 0) || 0,
      inputTokens: Number(usage?.inputTokens ?? 0) || 0,
      outputTokens: Number(usage?.outputTokens ?? 0) || 0,
      missingUsageCalls: Math.max(1, Number(usage?.missingUsageCalls ?? 0) || 0),
      missingObservationCalls: Number(usage?.missingObservationCalls ?? 0) || 0,
    };
  }
}

/**
 * R3-3 + R4-3: a row runner threw after a model request MAY have begun, so what
 * that turn consumed is unknown. The error carries that unknown usage
 * (`missingUsageCalls >= 1`) so the run stops the matrix instead of starting the
 * next row on a trusted zero.
 *
 * R4-3: "provably no request began" is not the matched arrays being empty - the
 * matcher can miss a route. It is provable only when the observer saw no POST to
 * any registered model route AND no POST under the frame's AI mount at all
 * (`aiPaths`). Then the raw error is returned and the caller keeps its separate
 * `row_runner_threw`.
 */
export function interruptionFromTurn(turnError, { requests = [], responses = [], aiPaths = [] } = {}) {
  if (!turnError) return null;
  if (requests.length === 0 && responses.length === 0 && aiPaths.length === 0) return turnError;
  return new InterruptedAiTurnError(turnError, extractWireUsage(responses));
}

/**
 * R3-1 + R4-1: the frame's model-CALL routes, exactly as the router registers
 * them (`server/internal/handler/router/office_frame_ai.go`): the UniWork turn
 * at `:126` and the three BYOK vendor calls at `:74` (`chat/completions`),
 * `:79` (`messages`) and `:84` (`generate`). The `:89` `.../models` route is a
 * GET listing of vendor models, not a model call, so it is deliberately absent
 * here; so is `/ai/{provider}/chat/completions`, which no route serves (the
 * BYOK path always carries the `byok` segment).
 *
 * Each route is paired with the response shape its usage block is read in
 * (`usagePairFromDoc`). The shape is the protocol that route is wired to:
 * `handler/ai_mount.go:71-73` binds the three BYOK routes to
 * `ai.ProxyChatCompletions` / `ProxyMessages` / `ProxyGenerate`, and
 * `server/internal/ai/proxy.go:61-63,223-236` pins those to
 * openai-compatible / anthropic / gemini. The BYOK proxy streams the vendor's
 * body through untouched (`proxy.go:193,219`), so the frame sees the vendor's
 * native shape; the UniWork turn is built by `ai/openai_facade.go:377-383`.
 */
const MODEL_CALL_ROUTES = Object.freeze([
  { re: /\/office-frame\/documents\/[^/]+\/ai\/uniwork\/chat\/completions$/, shape: 'openai' },
  { re: /\/office-frame\/documents\/[^/]+\/ai\/byok\/[^/]+\/chat\/completions$/, shape: 'openai' },
  { re: /\/office-frame\/documents\/[^/]+\/ai\/byok\/[^/]+\/messages$/, shape: 'anthropic' },
  { re: /\/office-frame\/documents\/[^/]+\/ai\/byok\/[^/]+\/generate$/, shape: 'gemini' },
]);

/** R4-1: the response shape of one registered model route, or null when the path is not one. */
export function modelRouteShape(pathname) {
  const p = String(pathname ?? '');
  for (const route of MODEL_CALL_ROUTES) if (route.re.test(p)) return route.shape;
  return null;
}

export function isModelCompletionPath(pathname) {
  return modelRouteShape(pathname) !== null;
}

/**
 * R4-3: any path under the frame's AI mount, whatever the shape. The
 * interruption check uses this broader net: a POST here means a model call may
 * have begun even when no registered model route was matched.
 */
const FRAME_AI_PATH_RE = /\/office-frame\/documents\/[^/]+\/ai\//;

export function isFrameAiPath(pathname) {
  return FRAME_AI_PATH_RE.test(String(pathname ?? ''));
}

/**
 * R4-1: the (input, output) pair one JSON document reports, read in the shape of
 * the route it came from - the same three shapes the server's own usage tap
 * reads (`server/internal/ai/proxy.go:425-447`):
 * - `openai`    - `usage.prompt_tokens` / `usage.completion_tokens`: the UniWork
 *   facade's `UniworkUsage` (`ai/openai_facade.go:213-215`, written into the SSE
 *   chunk at `:382`) and the OpenAI-compatible BYOK proxy (`proxy.go:442-446`);
 * - `anthropic` - `usage.input_tokens` / `usage.output_tokens`, and the same pair
 *   under `message.usage` on a `message_start` (`proxy.go:433-441`);
 * - `gemini`    - `usageMetadata.promptTokenCount` / `usageMetadata.candidatesTokenCount`
 *   plus `usageMetadata.thoughtsTokenCount` (`proxy.go:426-432`).
 * With no shape the three are tried in turn, which is what a bare body read means.
 * Either count may come back null: a chunk often carries only one of them.
 */
function usagePairFromDoc(doc, shape = null) {
  let input = null;
  let output = null;
  for (const s of shape ? [shape] : ['openai', 'anthropic', 'gemini']) {
    if (s === 'gemini') {
      const m = doc?.usageMetadata;
      if (!m || typeof m !== 'object') continue;
      if (typeof m.promptTokenCount === 'number') input = m.promptTokenCount;
      const cand = m.candidatesTokenCount;
      const thoughts = m.thoughtsTokenCount;
      if (typeof cand === 'number' || typeof thoughts === 'number') {
        output = (typeof cand === 'number' ? cand : 0) + (typeof thoughts === 'number' ? thoughts : 0);
      }
    } else if (s === 'anthropic') {
      // A streamed message reports input on `message_start` and the final output on
      // `message_delta`; a non-stream body carries one `usage` block.
      for (const u of [doc?.message?.usage, doc?.usage]) {
        if (!u || typeof u !== 'object') continue;
        if (typeof u.input_tokens === 'number') input = u.input_tokens;
        if (typeof u.output_tokens === 'number') output = u.output_tokens;
      }
    } else {
      const u = doc?.usage;
      if (!u || typeof u !== 'object') continue;
      if (typeof u.prompt_tokens === 'number') input = u.prompt_tokens;
      if (typeof u.completion_tokens === 'number') output = u.completion_tokens;
    }
  }
  return { input, output };
}

/**
 * R3-1 + R4-1: a model response body without both token counts is an unknown,
 * not a zero. The counts are read in the shape of the route they came from; a
 * body whose shape reports no block, or only one of the two counts, is null.
 */
export function usageFromModelResponseBody(body, shape = null) {
  const { input, output } = usagePairFromDoc(body, shape);
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  return { prompt_tokens: input, completion_tokens: output };
}

/**
 * R3-1 + R4-1: the usage of one SSE stream, or null when the stream carried no
 * complete usage. Every chunk is read in the route's shape and the latest value
 * of each count wins, because each protocol reports cumulative counts and may
 * split them across chunks (Anthropic's `message_start` / `message_delta`).
 * Text that is not an SSE stream is tried as a single JSON body.
 */
export function usageFromSseText(text, shape = null) {
  const raw = String(text ?? '');
  if (raw.trim() === '') return null;
  let input = null;
  let output = null;
  let sawChunk = false;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue; // a partial or non-JSON line is not a usage chunk
    }
    sawChunk = true;
    const pair = usagePairFromDoc(chunk, shape);
    if (pair.input !== null) input = pair.input;
    if (pair.output !== null) output = pair.output;
  }
  if (!sawChunk) {
    try {
      return usageFromModelResponseBody(JSON.parse(raw), shape);
    } catch {
      return null; // not JSON either
    }
  }
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  return { prompt_tokens: input, completion_tokens: output };
}

/**
 * R3-1 + R4-1: the tool names one stream reports, read in the route's response
 * shape. OpenAI-shaped deltas carry `choices[0].delta.tool_calls[].function.name`
 * (`ai/openai_facade.go:229` names `delta`, `:206-209` the `tool_calls` array); an Anthropic stream names the tool on a
 * `content_block_start` with `content_block.type='tool_use'`; a Gemini stream
 * names it under `candidates[0].content.parts[].functionCall.name`.
 */
export function toolCallNamesFromSseText(text, shape = null) {
  const names = [];
  const push = (name) => { if (typeof name === 'string' && name.trim()) names.push(name.trim()); };
  for (const line of String(text ?? '').split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    if (!shape || shape === 'openai') {
      for (const tc of chunk?.choices?.[0]?.delta?.tool_calls ?? []) push(tc?.function?.name);
    }
    if (!shape || shape === 'anthropic') {
      const block = chunk?.content_block;
      if (block?.type === 'tool_use') push(block?.name);
    }
    if (!shape || shape === 'gemini') {
      for (const part of chunk?.candidates?.[0]?.content?.parts ?? []) push(part?.functionCall?.name);
    }
  }
  return names;
}

/**
 * R3-1: `extractWireUsage` plus the fail-closed reading of a whole turn. The
 * budget is only as honest as the observation behind it:
 * - `missing_usage_on_model_call`  - at least one model request was seen and at
 *   least one model response reported no usage (or never arrived);
 * - `missing_model_call_observation` - the turn showed effects (a panel reply,
 *   executed tools or a write) yet no model request was observed at all, which
 *   means the observer missed the route, not that the turn cost zero tokens.
 * An empty response collection is never a successful zero-token run.
 */
export function evaluateWireObservation({ requests = [], responses = [], sawTurnEffects = false } = {}) {
  const usage = extractWireUsage(responses);
  const missingResponses = Math.max(0, requests.length - responses.length);
  if (missingResponses > 0 || usage.missingUsageCalls > 0) {
    return {
      ...usage,
      unobserved: true,
      missingObservationCalls: 0,
      reason: 'missing_usage_on_model_call',
      detail: { requests: requests.length, responses: responses.length, missingUsageCalls: usage.missingUsageCalls },
    };
  }
  if (requests.length === 0) {
    return {
      ...usage,
      unobserved: true,
      missingObservationCalls: 1,
      reason: 'missing_model_call_observation',
      detail: { requests: 0, responses: responses.length, sawTurnEffects },
    };
  }
  return { ...usage, unobserved: false, missingObservationCalls: 0, reason: null, detail: null };
}

/**
 * R3-1: a passive observer of the frame's model route for a REAL run. It only
 * listens: `page.on('request')` records what the frame offered, and
 * `page.on('response')` reads the finished body. Nothing is routed, buffered or
 * delayed, so the stream the frame sees is untouched - unlike the dry-run stub,
 * which does `route.fetch` + fulfill on its own route.
 *
 * `requests` and `responses` are the same arrays the row builds its observation
 * from; a listener failure must never take the turn down, so every read is
 * guarded.
 */
export function observeModelWire(page, { requests, responses, aiPaths = [], onError } = {}) {
  const pending = new Set();
  const settle = async ({ timeoutMs = 5_000 } = {}) => {
    const deadline = Date.now() + timeoutMs;
    while (pending.size > 0 && Date.now() < deadline) {
      await Promise.race([
        Promise.all([...pending]),
        new Promise((resolve) => { setTimeout(resolve, 50).unref?.(); }),
      ]);
    }
    return pending.size;
  };
  if (!page || typeof page.on !== 'function') return { settle: async () => 0 };
  const fail = (err) => {
    if (typeof onError === 'function') onError(err);
  };
  page.on('request', (req) => {
    try {
      if (req.method() !== 'POST') return;
      const pathname = new URL(req.url()).pathname;
      // R4-3: the broad net - any AI-mount POST means a model call may have begun,
      // even when the path is not one of the registered model routes.
      if (isFrameAiPath(pathname)) aiPaths.push({ path: pathname });
      const shape = modelRouteShape(pathname);
      if (!shape) return;
      let body = null;
      try { body = JSON.parse(req.postData() || '{}'); } catch { body = null; }
      requests.push({ path: pathname, shape, body });
    } catch (err) {
      fail(err);
    }
  });
  page.on('response', (res) => {
    // Reading the finished body is async: the caller settles this before it reads the usage, so a
    // body still in flight is not mistaken for a response that never arrived.
    const task = (async () => {
      const req = res.request();
      if (req?.method() !== 'POST') return;
      const pathname = new URL(res.url()).pathname;
      const shape = modelRouteShape(pathname);
      if (!shape) return;
      let text = '';
      try { text = await res.text(); } catch { text = ''; }
      responses.push({
        status: res.status(),
        shape,
        // R4-1: the usage is read in the route's own response shape, so an Anthropic
        // `/messages` stream and a Gemini `/generate` body are counted, not dropped.
        usage: usageFromSseText(text, shape),
        toolCallNames: toolCallNamesFromSseText(text, shape),
      });
    })();
    pending.add(task);
    task.catch(fail).finally(() => pending.delete(task));
  });
  return { settle };
}

/**
 * R2-6: one strict version count. `listVersions` (g7-04/cross-host.mjs) keeps its
 * own semantics; the g7-08 side asks for the strict form and turns the throw into
 * the row's BLOCKED reason - a 200 without a `versions` array is an absent scored
 * field, never a count of 0.
 */
export async function readVersionCount(listVersionsFn, args) {
  try {
    return { ok: true, count: await listVersionsFn({ ...args, strict: true }) };
  } catch (err) {
    return { ok: false, reason: 'missing_version_list', detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * R2-5: what undo, then redo, through the frame actually showed. `executedTools`
 * is deliberately not an input: a tool call that ran is not evidence that the
 * change is visible or undoable. `contentChanged` is null when the module has no
 * readable text surface (canvas editors), and then only the host's dirty flag
 * speaks. Visible = the change is there; undoable = undo took it away AND redo
 * brought it back.
 */
export function buildUndoRedoObserved({
  contentChanged, dirtyAfterEdit, undoReverted, redoRestored, undoControl, redoControl,
} = {}) {
  if (!undoControl || !redoControl) {
    return {
      aiChangeVisibleBeforeSave: false,
      aiChangeUndoableBeforeSave: false,
      missingControl: undoControl ? 'redo' : 'undo',
    };
  }
  const visible = contentChanged === true || dirtyAfterEdit === true;
  return {
    aiChangeVisibleBeforeSave: visible,
    aiChangeUndoableBeforeSave: visible && undoReverted === true && redoRestored === true,
    missingControl: null,
  };
}

/**
 * R2-1 + R2-3 + R2-9: the edit rows' Save observations from what the driver saw,
 * or the BLOCKED reason when a scored field is absent. `doubleSave` is what the
 * two Saves of one gesture answered. A second Save that is skipped or does not
 * answer `saved` is BLOCKED `missing_double_click_save`: the dry run showed the
 * frame commits a second Save even of a clean document, so a skipped one is a lost
 * Save, not a measured +0.
 */
export function buildEditSaveObservation({
  doubleSave = null, versionsAfterFirstSave, versionsAfterSecondSave,
  revisionAfterAiTurn, lastCommitBaseRevision,
} = {}) {
  if (!doubleSave || doubleSave.presses !== 2) {
    return { ok: false, reason: 'missing_double_click_save', detail: 'the second Save was not sent' };
  }
  if (doubleSave.first?.status !== 'saved') {
    return { ok: false, reason: 'web_save_failed_after_ai_edit', saved: doubleSave.first ?? null };
  }
  if (!Number.isInteger(versionsAfterFirstSave) || !Number.isInteger(versionsAfterSecondSave)) {
    return { ok: false, reason: 'missing_version_list', versionsAfterFirstSave, versionsAfterSecondSave };
  }
  if (doubleSave.second?.status !== 'saved') {
    return { ok: false, reason: 'missing_double_click_save', saved: doubleSave.second ?? null };
  }
  if (lastCommitBaseRevision === null || lastCommitBaseRevision === undefined) {
    return { ok: false, reason: 'missing_save_base_revision' };
  }
  return {
    ok: true,
    observed: {
      versionsAfterSave: versionsAfterSecondSave,
      doubleClickVersionsCreated: versionsAfterSecondSave - versionsAfterFirstSave,
      saveUsedCurrentBaseRevision: String(lastCommitBaseRevision) === String(revisionAfterAiTurn),
    },
  };
}

/** The frame's head (revision, current version) plus the bytes the content route serves. */
export async function readFrameHead({ apiOrigin, fetchImpl = fetch, documentId, token }) {
  const tokenRes = await callTracerApi({ apiOrigin, fetchImpl, name: 'mintOfficeFrameToken', params: { documentID: documentId }, token });
  const frameToken = tokenRes.data?.token;
  if (!frameToken) throw new Error('mintOfficeFrameToken returned no token');
  const openRes = await callTracerApi({ apiOrigin, fetchImpl, name: 'openOfficeFrameDocument', params: { documentID: documentId }, token: frameToken });
  const contentRes = await callTracerApi({
    apiOrigin, fetchImpl, name: 'getOfficeFrameDocumentContent', params: { documentID: documentId }, token: frameToken, expectBinary: true,
  });
  return {
    versionId: openRes.data?.file?.version_id ?? null,
    version: openRes.data?.file?.version ?? null,
    revision: openRes.data?.revision ?? null,
    bytes: new Uint8Array(contentRes.bytes),
    sha256: sha256Hex(contentRes.bytes),
  };
}

/**
 * R2-4: the bytes of one earlier file version, as the document owner downloads it
 * (`GET /api/v1/documents/{id}/download?version=N`, router/documents.go:224). The
 * frame's content route only serves the live version, so this is the one place
 * the old version is read again after a Save.
 */
export async function readVersionBytes({ apiOrigin, fetchImpl = fetch, documentId, token, version }) {
  const res = await callTracerApi({
    apiOrigin, fetchImpl, name: 'downloadDocument', params: { documentID: documentId }, query: { version }, token, expectBinary: true,
  });
  return { bytes: new Uint8Array(res.bytes), sha256: sha256Hex(res.bytes) };
}

/**
 * R2-4: re-read the previous version after the Save. A missing version number or a
 * failed GET is BLOCKED `missing_old_version_bytes_after_save`; the caller never
 * falls back to the pre-save head's hash as the "old version" evidence.
 */
export async function observeOldVersionAfterSave({ readBytes, version }) {
  const blocked = (detail) => ({ ok: false, reason: 'missing_old_version_bytes_after_save', detail });
  if (!Number.isInteger(version)) return blocked('the pre-save head carries no version number to read again');
  try {
    const { bytes, sha256 } = await readBytes(version);
    return { ok: true, bytes, sha256, version };
  } catch (err) {
    return blocked(err instanceof Error ? err.message : String(err));
  }
}
