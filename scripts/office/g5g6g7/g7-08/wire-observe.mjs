// G7-08 (UNI-1385) w2f/w2g: the AI-turn wire observation of the web driver -
// the frame's registered model-CALL routes, the per-shape usage readers, the
// real-run observer (routes the model calls to read each answer to completion, w2k)
// and the fail-closed reading of a whole turn
// (review r3 findings G708-R2-7, R3-1, R3-3; review r4 findings G708-R4-1,
// R4-3; review r5 finding G708-R5-1). Pure by contract: no filesystem, no
// Playwright import - the driver
// hands the observer an injected page, so every scored field
// is either measured or BLOCKED, never defaulted (contract w1b). The Save /
// version side of the same driver lives in `save-observe.mjs`.

import { VERDICT, failVerdict } from './ooxml.mjs';

/**
 * w2p: the UniWork AI refusals that spend nothing - 409 with one of these error codes.
 * real6 X-R1: the 10th POST was answered in 30 ms with 409 run_limit_reached (fields.limit =
 * tool_rounds, run row 8/8) and was counted as a model call without usage. The server refuses
 * before it reserves anything: `server/internal/ai/run_store_pg.go` `runTurnRefusal` ("a turn
 * that reserved nothing"), `server/internal/ai/run_store.go:39-59` (`ErrRunExpired`,
 * `RunLimitReached`, all 409), and `server/internal/handler/ai_uniwork.go:135` (the refusal's
 * `fields` reach the `error` envelope). Matched on status AND the parsed `error.code`, never on
 * timing; any other status, code or an unparseable body is not a refusal.
 */
const UNIWORK_REFUSAL_CODES = Object.freeze(['run_limit_reached', 'run_expired', 'conversation_expired']);

export function uniworkRefusalFromResponse(status, text) {
  if (status !== 409) return null;
  let doc;
  try {
    doc = JSON.parse(String(text ?? ''));
  } catch {
    return null;
  }
  const code = doc?.error?.code;
  if (!UNIWORK_REFUSAL_CODES.includes(code)) return null;
  const limit = doc.error.fields?.limit;
  return { status, code, limit: typeof limit === 'string' ? limit : null };
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
    if (res?.refusal) continue; // w2p: a refusal reserved nothing, so it is no model call
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
 * R3-1 + R4-1: the frame's model-CALL route, exactly as the router registers it
 * (`server/internal/handler/router/office_frame_ai.go`): the UniWork turn at
 * `/ai/uniwork/chat/completions`. The `.../uniwork/models` route is a GET
 * listing, not a model call, so it is deliberately absent here; so is
 * `/ai/{provider}/chat/completions`, which no route serves.
 *
 * Each route is paired with the response shape its usage block is read in
 * (`usagePairFromDoc`): the UniWork turn is built by `ai/openai_facade.go`,
 * so it is `openai`.
 */
const MODEL_CALL_ROUTES = Object.freeze([
  { re: /\/office-frame\/documents\/[^/]+\/ai\/uniwork\/chat\/completions$/, globPath: '/api/v1/office-frame/documents/*/ai/uniwork/chat/completions', shape: 'openai' },
]);

function normalizeHttpOrigin(rawOrigin) {
  try {
    const u = new URL(String(rawOrigin ?? ''));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
  } catch {
    return '';
  }
}

/**
 * R4-1 + w2i + w2j: the model-CALL routes as Playwright `page.route` globs on the origin the
 * frame POSTs to - the app (web) origin, since the frame is same-origin (connect-src 'self') and
 * the app proxies the route to the API. Never `**`, so a POST to any other origin is not intercepted.
 */
export function modelCallRouteGlobs(frameAiOrigin) {
  const base = normalizeHttpOrigin(frameAiOrigin);
  if (!base) return Object.freeze([]);
  return Object.freeze(MODEL_CALL_ROUTES.map((route) => `${base}${route.globPath}`));
}

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
 * R4-1: the (input, output) pair one JSON document reports, in the UniWork
 * route's OpenAI shape: `usage.prompt_tokens` / `usage.completion_tokens` (the
 * facade's `UniworkUsage`, `ai/openai_facade.go:213-215`, written into the SSE
 * chunk at `:382`). Either count may come back null: a chunk often carries
 * only one of them.
 */
function usagePairFromDoc(doc) {
  const u = doc?.usage;
  if (!u || typeof u !== 'object') return { input: null, output: null };
  return {
    input: typeof u.prompt_tokens === 'number' ? u.prompt_tokens : null,
    output: typeof u.completion_tokens === 'number' ? u.completion_tokens : null,
  };
}

/**
 * R3-1 + R4-1: a model response body without both token counts is an unknown,
 * not a zero. A body that reports no usage block, or only one of the two counts, is null.
 */
export function usageFromModelResponseBody(body) {
  const { input, output } = usagePairFromDoc(body);
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  return { prompt_tokens: input, completion_tokens: output };
}

/**
 * R3-1 + R4-1 + R5-1: the usage of one SSE stream, or null when the stream
 * carried no complete usage. Latest value of each count wins. A stream is
 * complete only with a complete JSON chunk with both usage counts AND a later
 * `data: [DONE]` (UniWork facade writes the pair then `[DONE]` at
 * `openai_facade.go:382-396`). A non-stream JSON body is unchanged. A line cut
 * mid-JSON is not a chunk.
 */
export function usageFromSseText(text) {
  const raw = String(text ?? '');
  if (raw.trim() === '') return null;
  let input = null;
  let output = null;
  let sawChunk = false;
  let openaiCompleteUsage = false;
  let openaiDoneAfterUsage = false;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '') continue;
    if (payload === '[DONE]') {
      if (openaiCompleteUsage) openaiDoneAfterUsage = true;
      continue;
    }
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue; // a partial or non-JSON line is not a usage chunk
    }
    sawChunk = true;
    const pair = usagePairFromDoc(chunk);
    if (pair.input !== null) input = pair.input;
    if (pair.output !== null) output = pair.output;
    if (typeof pair.input === 'number' && typeof pair.output === 'number') {
      openaiCompleteUsage = true;
      openaiDoneAfterUsage = false;
    }
  }
  if (!sawChunk) {
    try {
      return usageFromModelResponseBody(JSON.parse(raw));
    } catch {
      return null; // not JSON either
    }
  }
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  if (!openaiCompleteUsage || !openaiDoneAfterUsage) return null;
  return { prompt_tokens: input, completion_tokens: output };
}

/**
 * R3-1 + R4-1: the tool names one stream reports. OpenAI-shaped deltas carry
 * `choices[0].delta.tool_calls[].function.name` (`ai/openai_facade.go:229` names
 * `delta`, `:206-209` the `tool_calls` array).
 */
export function toolCallNamesFromSseText(text) {
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
    for (const tc of chunk?.choices?.[0]?.delta?.tool_calls ?? []) push(tc?.function?.name);
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
export function evaluateWireObservation({
  requests = [], responses = [], aiPaths = [], frameAiOrigin = null, sawTurnEffects = false,
} = {}) {
  // w2j: the frame POSTs to the app (web) origin; a direct API-origin POST is not the frame path.
  const expectedOrigin = normalizeHttpOrigin(frameAiOrigin);
  if (expectedOrigin) {
    const wrong = [...aiPaths, ...requests].find((entry) => entry?.origin && entry.origin !== expectedOrigin);
    if (wrong) {
      return {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        missingUsageCalls: 0,
        unobserved: true,
        missingObservationCalls: 1,
        reason: 'frame_ai_wrong_origin',
        detail: {
          expectedOrigin,
          observedOrigin: wrong.origin,
          path: wrong.path ?? null,
          requests: requests.length,
          responses: responses.length,
        },
      };
    }
  }
  const usage = extractWireUsage(responses);
  const refusals = responses.filter((res) => res?.refusal).map((res) => ({ ...res.refusal }));
  const endedByRefusal = Boolean(responses[responses.length - 1]?.refusal);
  const missingResponses = Math.max(0, requests.length - responses.length);
  if (missingResponses > 0 || usage.missingUsageCalls > 0) {
    return {
      ...usage,
      refusals,
      endedByRefusal: false,
      unobserved: true,
      missingObservationCalls: 0,
      reason: 'missing_usage_on_model_call',
      detail: { requests: requests.length, responses: responses.length, missingUsageCalls: usage.missingUsageCalls },
    };
  }
  if (requests.length === 0) {
    return {
      ...usage,
      refusals,
      endedByRefusal: false,
      unobserved: true,
      missingObservationCalls: 1,
      reason: 'missing_model_call_observation',
      detail: { requests: 0, responses: responses.length, sawTurnEffects },
    };
  }
  return { ...usage, refusals, endedByRefusal, unobserved: false, missingObservationCalls: 0, reason: null, detail: null };
}

/** w2p: the reason a turn that ended on a refusal is scored with. */
function refusalReason({ code, limit }) {
  return code === 'run_limit_reached' ? `uniwork_run_limit_reached:${limit ?? 'unknown'}` : `uniwork_${code}`;
}

/** w2p: a turn that ended on a refusal and shows no final reply to judge is FAIL, not BLOCKED. */
export function refusalFailVerdict({ refusals = [] } = {}, details = {}) {
  const last = refusals[refusals.length - 1];
  return failVerdict(refusalReason(last), { ...details, refusals });
}

/**
 * w2p: a turn that ENDED on a refusal is scored: unless its oracle passed on the final reply
 * (PASS stays PASS), a FAIL carries the refusal as its reason. BLOCKED is left alone - an
 * unknown is still an unknown - and so is a turn that did not end on the refusal.
 */
export function scoreRefusalEnd(verdict, { endedByRefusal = false, refusals = [] } = {}) {
  if (!endedByRefusal || refusals.length === 0 || verdict?.status !== VERDICT.FAIL) return verdict;
  const scored = refusalFailVerdict({ refusals }, { ...verdict.details, oracleReason: verdict.reason });
  return { ...verdict, ...scored, details: scored.details };
}

/**
 * The frame's own proxy timeout (`proxyTimeout: 65000` of the app's rewrite to the API): a model call
 * that has not completed by then is not going to, so it is the bound of every body read below.
 */
export const MODEL_RESPONSE_TIMEOUT_MS = 65_000;

// Headers that describe the wire framing of the body route.fetch decoded, not the body handed back.
const REPLAY_DROPPED_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection']);

function replayHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !REPLAY_DROPPED_HEADERS.has(name.toLowerCase())));
}

/**
 * R3-1 + w2k: the observer of the frame's model route for a REAL run.
 *
 * `page.on('request')` records what the frame offered. The answer is read in one of two ways:
 * - with `frameAiOrigin` and a page that can `route` (the real run), the four model routes are routed
 *   on that origin: the handler reads the WHOLE answer through `route.fetch` (bounded by
 *   `responseTimeoutMs`), records its usage, and only then fulfils the frame with the same bytes.
 *   A passive `page.on('response')` + `res.text()` cannot do this: the frame stops reading a stream at
 *   `data: [DONE]` (`break` in its `for await`), which cancels the body reader, and Playwright then
 *   cannot read the cancelled body - the real3 smoke counted two of three calls (w2k). A call whose
 *   body cannot be read to completion records no response, so the row is BLOCKED, never a zero;
 * - otherwise (an injected page with no `route`) the finished body is read from `page.on('response')`.
 *
 * `requests` and `responses` are the same arrays the row builds its observation from; a listener
 * failure must never take the turn down, so every read is guarded. `ready` resolves once the routes
 * are registered (await it before navigating); `settle` waits, bounded, for every model call seen on
 * the frame origin to be read to completion before the caller evaluates the turn.
 */
export function observeModelWire(page, {
  requests, responses, aiPaths = [], onError, recordResponses = true,
  frameAiOrigin = null, responseTimeoutMs = MODEL_RESPONSE_TIMEOUT_MS,
} = {}) {
  const pending = new Set();
  const routeOrigin = normalizeHttpOrigin(frameAiOrigin);
  const routed = recordResponses && Array.isArray(responses) && routeOrigin !== ''
    && typeof page?.route === 'function';
  let seenOnFrameOrigin = 0;
  let routeHandled = 0;
  let ready = Promise.resolve();
  const settle = async ({ timeoutMs = responseTimeoutMs + 5_000 } = {}) => {
    await ready;
    const deadline = Date.now() + timeoutMs;
    // A routed call is waited for from the moment its request is seen, not only once its handler runs.
    while ((pending.size > 0 || (routed && routeHandled < seenOnFrameOrigin)) && Date.now() < deadline) {
      await Promise.race([
        Promise.all([...pending]),
        new Promise((resolve) => { setTimeout(resolve, 50).unref?.(); }),
      ]);
    }
    return pending.size;
  };
  if (!page || typeof page.on !== 'function') return { settle: async () => 0, ready };
  const fail = (err) => {
    if (typeof onError === 'function') onError(err);
  };
  page.on('request', (req) => {
    try {
      if (req.method() !== 'POST') return;
      const { origin, pathname } = new URL(req.url());
      // R4-3 + w2i: the broad net - any AI-mount POST records its origin and path.
      if (isFrameAiPath(pathname)) aiPaths.push({ origin, path: pathname });
      const shape = modelRouteShape(pathname);
      if (!shape || !Array.isArray(requests)) return;
      if (origin === routeOrigin) seenOnFrameOrigin += 1;
      let body = null;
      try { body = JSON.parse(req.postData() || '{}'); } catch { body = null; }
      requests.push({ origin, path: pathname, shape, body });
    } catch (err) {
      fail(err);
    }
  });
  if (!recordResponses || !Array.isArray(responses)) return { settle, ready };
  const record = (origin, status, shape, text) => {
    // w2p: a 409 UniWork refusal reserved nothing; it carries no usage and is not a model call.
    const refusal = uniworkRefusalFromResponse(status, text);
    responses.push({
      origin,
      status,
      shape,
      ...(refusal ? { refusal } : {}),
      usage: usageFromSseText(text),
      toolCallNames: toolCallNamesFromSseText(text),
    });
  };
  const track = (task) => {
    pending.add(task);
    task.catch(fail).finally(() => pending.delete(task));
  };
  if (routed) {
    const handle = (route) => {
      routeHandled += 1;
      track((async () => {
        const req = route.request();
        if (req.method() !== 'POST') {
          await route.continue();
          return;
        }
        const { origin, pathname } = new URL(req.url());
        const shape = modelRouteShape(pathname);
        let fetched;
        let body;
        try {
          fetched = await route.fetch({ timeout: responseTimeoutMs });
          body = await fetched.body();
        } catch (err) {
          // Never completed: no response is recorded, so the row is BLOCKED, and the frame is not left hanging.
          fail(err);
          await route.abort('failed').catch(() => {});
          return;
        }
        record(origin, fetched.status(), shape, body.toString('utf8'));
        await route.fulfill({ status: fetched.status(), headers: replayHeaders(fetched.headers()), body });
      })());
    };
    ready = Promise.all(modelCallRouteGlobs(routeOrigin).map((glob) => page.route(glob, handle)));
    ready.catch(fail);
    return { settle, ready };
  }
  page.on('response', (res) => {
    // body still in flight is not mistaken for a response that never arrived.
    track((async () => {
      const req = res.request();
      if (req?.method() !== 'POST') return;
      const { origin, pathname } = new URL(res.url());
      const shape = modelRouteShape(pathname);
      if (!shape) return;
      let text = '';
      try { text = await res.text(); } catch { text = ''; }
      record(origin, res.status(), shape, text);
    })());
  });
  return { settle, ready };
}

/**
 * R3-1: the tool surface the wire proves - what the frame OFFERED
 * (`requests[].body.tools`) and what it EXECUTED (the assistant's own
 * `tool_calls` replayed on a later request, plus the tool names the response
 * streams). The frame's request bodies are the evidence, so no second parser is
 * needed to name the tools of a real run.
 */
export function extractWireToolCalls(requests = [], responses = []) {
  const offeredSet = new Set();
  const executedSet = new Set();
  const callToolCalls = [];
  for (const req of requests) {
    for (const tool of req?.body?.tools ?? []) {
      const name = tool?.function?.name ?? tool?.name;
      if (typeof name === 'string' && name.trim()) offeredSet.add(name.trim());
    }
    for (const msg of req?.body?.messages ?? []) {
      for (const tc of (msg?.role === 'assistant' && Array.isArray(msg.tool_calls) ? msg.tool_calls : [])) {
        const name = tc?.function?.name;
        if (typeof name === 'string' && name.trim()) executedSet.add(name.trim());
      }
    }
  }
  for (const res of responses) {
    if (res?.refusal) continue;
    const names = [];
    for (const name of res?.toolCallNames ?? []) {
      if (typeof name === 'string' && name.trim()) {
        const trimmed = name.trim();
        executedSet.add(trimmed);
        names.push(trimmed);
      }
    }
    callToolCalls.push(names);
  }
  return { offeredTools: [...offeredSet], executedTools: [...executedSet], callToolCalls };
}
