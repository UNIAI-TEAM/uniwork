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
    };
  }
}

/**
 * R3-3: a turn that threw after a model request had begun consumed an unknown
 * amount, so the caller must stop on `missing_usage_on_model_call`; a failure that
 * provably happened before any request keeps its own error for `row_runner_threw`.
 */
export function interruptionFromTurn(turnError, { requests = [], responses = [] } = {}) {
  if (!turnError) return null;
  if (requests.length === 0 && responses.length === 0) return turnError;
  return new InterruptedAiTurnError(turnError, extractWireUsage(responses));
}

/**
 * R3-1: the frame's model completion route - the same path the dry-run stub
 * intercepts (`page.route('**\/api\/v1\/office-frame\/documents\/*\/ai\/*\/chat\/completions')`).
 * Both providers answer through it: `/ai/uniwork/chat/completions` and
 * `/ai/{aiProvider}/chat/completions` (router/office_frame_ai.go:74,126).
 */
export const MODEL_COMPLETION_PATH_RE = /\/office-frame\/documents\/[^/]+\/ai\/[^/]+\/chat\/completions$/;

export function isModelCompletionPath(pathname) {
  return MODEL_COMPLETION_PATH_RE.test(String(pathname ?? ''));
}

/** R3-1: the tools a model request offered, so a real run carries tool-surface evidence too. */
export function offeredToolsFromRequestBody(body) {
  const tools = body?.tools;
  if (!Array.isArray(tools)) return [];
  const names = [];
  for (const tool of tools) {
    const name = tool?.function?.name ?? tool?.name;
    if (typeof name === 'string' && name.trim()) names.push(name.trim());
  }
  return names;
}

/**
 * R3-1: a model response body without both token counts is an unknown, not a zero.
 * OpenAI-shaped bodies carry `usage.prompt_tokens`/`completion_tokens`; an
 * Anthropic-shaped one carries `input_tokens`/`output_tokens`.
 */
export function usageFromModelResponseBody(body) {
  const usage = body?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const input = usage.prompt_tokens ?? usage.input_tokens;
  const output = usage.completion_tokens ?? usage.output_tokens;
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  return { prompt_tokens: input, completion_tokens: output };
}

/**
 * R3-1: the usage of one SSE stream, or null when the stream carried no usage
 * chunk. Text that is not an SSE stream is tried as a JSON body first.
 */
export function usageFromSseText(text) {
  const raw = String(text ?? '');
  if (raw.trim() === '') return null;
  let usage = null;
  let sawChunk = false;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    try {
      const chunk = JSON.parse(payload);
      sawChunk = true;
      if (chunk?.usage) usage = chunk.usage;
    } catch {
      /* a partial or non-JSON line is not a usage chunk */
    }
  }
  if (usage) return usageFromModelResponseBody({ usage }) ?? usage;
  if (!sawChunk) {
    try {
      return usageFromModelResponseBody(JSON.parse(raw));
    } catch {
      /* not JSON either */
    }
  }
  return null;
}

/** R3-1: the tool names one SSE stream executed, for the wire tool-surface evidence. */
export function toolCallNamesFromSseText(text) {
  const names = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    try {
      const chunk = JSON.parse(payload);
      for (const tc of chunk?.choices?.[0]?.delta?.tool_calls ?? []) {
        if (tc?.function?.name) names.push(tc.function.name);
      }
    } catch {
      /* ignore */
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
      reason: 'missing_usage_on_model_call',
      detail: { requests: requests.length, responses: responses.length, missingUsageCalls: usage.missingUsageCalls },
    };
  }
  if (requests.length === 0) {
    return {
      ...usage,
      unobserved: true,
      reason: 'missing_model_call_observation',
      detail: { requests: 0, responses: responses.length, sawTurnEffects },
    };
  }
  return { ...usage, unobserved: false, reason: null, detail: null };
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
export function observeModelWire(page, { requests, responses, onError } = {}) {
  if (!page || typeof page.on !== 'function') return;
  const fail = (err) => {
    if (typeof onError === 'function') onError(err);
  };
  page.on('request', (req) => {
    try {
      if (req.method() !== 'POST') return;
      const pathname = new URL(req.url()).pathname;
      if (!isModelCompletionPath(pathname)) return;
      let body = null;
      try { body = JSON.parse(req.postData() || '{}'); } catch { body = null; }
      requests.push({ path: pathname, body });
    } catch (err) {
      fail(err);
    }
  });
  page.on('response', async (res) => {
    try {
      const req = res.request();
      if (req?.method() !== 'POST') return;
      const pathname = new URL(res.url()).pathname;
      if (!isModelCompletionPath(pathname)) return;
      let text = '';
      try { text = await res.text(); } catch { text = ''; }
      responses.push({
        status: res.status(),
        usage: usageFromSseText(text),
        toolCallNames: toolCallNamesFromSseText(text),
      });
    } catch (err) {
      fail(err);
    }
  });
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
