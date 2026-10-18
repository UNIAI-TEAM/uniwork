// G7-08 (UNI-1385) w2f/w2g: the AI-turn wire observation of the web driver -
// the frame's registered model-CALL routes, the per-shape usage readers, the
// passive real-run observer and the fail-closed reading of a whole turn
// (review r3 findings G708-R2-7, R3-1, R3-3; review r4 findings G708-R4-1,
// R4-3; review r5 finding G708-R5-1). Pure by contract: no filesystem, no
// Playwright import - the driver
// hands the observer an injected page it only listens on, so every scored field
// is either measured or BLOCKED, never defaulted (contract w1b). The Save /
// version side of the same driver lives in `save-observe.mjs`.

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
  { re: /\/office-frame\/documents\/[^/]+\/ai\/uniwork\/chat\/completions$/, globPath: '/api/v1/office-frame/documents/*/ai/uniwork/chat/completions', shape: 'openai' },
  { re: /\/office-frame\/documents\/[^/]+\/ai\/byok\/[^/]+\/chat\/completions$/, globPath: '/api/v1/office-frame/documents/*/ai/byok/*/chat/completions', shape: 'openai' },
  { re: /\/office-frame\/documents\/[^/]+\/ai\/byok\/[^/]+\/messages$/, globPath: '/api/v1/office-frame/documents/*/ai/byok/*/messages', shape: 'anthropic' },
  { re: /\/office-frame\/documents\/[^/]+\/ai\/byok\/[^/]+\/generate$/, globPath: '/api/v1/office-frame/documents/*/ai/byok/*/generate', shape: 'gemini' },
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
 * R4-1 + w2i + w2j: the four model-CALL routes as Playwright `page.route` globs on the origin the
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

function geminiChunkHasFinishReason(chunk) {
  const cands = Array.isArray(chunk?.candidates) ? chunk.candidates : [];
  return cands.some((c) => typeof c?.finishReason === 'string' && c.finishReason !== '');
}

/**
 * R3-1 + R4-1 + R5-1: the usage of one SSE stream, or null when the stream
 * carried no complete usage. Latest value of each count wins. A stream is
 * complete only with its terminal marker:
 * - anthropic: a `message_delta` with `usage.output_tokens` AND a later
 *   `message_stop` (a cut after `message_start` is unknown, not the start's
 *   initial `output_tokens`);
 * - openai: a complete JSON chunk with both usage counts AND a later
 *   `data: [DONE]` (UniWork facade writes the pair then `[DONE]` at
 *   `openai_facade.go:382-396`; BYOK `/chat/completions` is the vendor body
 *   through `proxy.go:193,219`, same `[DONE]` trailer);
 * - gemini: the last usage-bearing chunk also carries a candidate
 *   `finishReason` (usageMetadata is cumulative, so a cut undercounts).
 * A non-stream JSON body is unchanged. A line cut mid-JSON is not a chunk.
 */
export function usageFromSseText(text, shape = null) {
  const raw = String(text ?? '');
  if (raw.trim() === '') return null;
  let input = null;
  let output = null;
  let sawChunk = false;
  let anthropicDeltaOutput = false;
  let anthropicStopAfterDelta = false;
  let openaiCompleteUsage = false;
  let openaiDoneAfterUsage = false;
  let lastUsageHasFinish = false;
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
    const pair = usagePairFromDoc(chunk, shape);
    if (pair.input !== null) input = pair.input;
    if (pair.output !== null) output = pair.output;
    if (chunk?.type === 'message_delta' && typeof chunk?.usage?.output_tokens === 'number') {
      anthropicDeltaOutput = true;
    }
    if (chunk?.type === 'message_stop' && anthropicDeltaOutput) anthropicStopAfterDelta = true;
    if (typeof pair.input === 'number' && typeof pair.output === 'number') {
      openaiCompleteUsage = true;
      openaiDoneAfterUsage = false;
    }
    if (pair.input !== null || pair.output !== null) {
      lastUsageHasFinish = geminiChunkHasFinishReason(chunk);
    }
  }
  if (!sawChunk) {
    try {
      return usageFromModelResponseBody(JSON.parse(raw), shape);
    } catch {
      return null; // not JSON either
    }
  }
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  if (shape === 'anthropic' && (!anthropicDeltaOutput || !anthropicStopAfterDelta)) return null;
  if (shape === 'openai' && (!openaiCompleteUsage || !openaiDoneAfterUsage)) return null;
  if (shape === 'gemini' && !lastUsageHasFinish) return null;
  return { prompt_tokens: input, completion_tokens: output };
}

/**
 * R3-1 + R4-1: the tool names one stream reports, read in the route's response
 * shape. OpenAI-shaped deltas carry `choices[0].delta.tool_calls[].function.name`
 * (`ai/openai_facade.go:229` names `delta`, `:206-209` the `tool_calls` array);
 * an Anthropic stream names the tool on a `content_block_start` with
 * `content_block.type='tool_use'`; a Gemini stream names it under
 * `candidates[0].content.parts[].functionCall.name`.
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
export function observeModelWire(page, { requests, responses, aiPaths = [], onError, recordResponses = true } = {}) {
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
      const { origin, pathname } = new URL(req.url());
      // R4-3 + w2i: the broad net - any AI-mount POST records its origin and path.
      if (isFrameAiPath(pathname)) aiPaths.push({ origin, path: pathname });
      const shape = modelRouteShape(pathname);
      if (!shape || !Array.isArray(requests)) return;
      let body = null;
      try { body = JSON.parse(req.postData() || '{}'); } catch { body = null; }
      requests.push({ origin, path: pathname, shape, body });
    } catch (err) {
      fail(err);
    }
  });
  if (!recordResponses || !Array.isArray(responses)) return { settle };
  page.on('response', (res) => {
    // body still in flight is not mistaken for a response that never arrived.
    const task = (async () => {
      const req = res.request();
      if (req?.method() !== 'POST') return;
      const { origin, pathname } = new URL(res.url());
      const shape = modelRouteShape(pathname);
      if (!shape) return;
      let text = '';
      try { text = await res.text(); } catch { text = ''; }
      responses.push({
        origin,
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
 * R3-1: the tool surface the wire proves - what the frame OFFERED
 * (`requests[].body.tools`) and what it EXECUTED (the assistant's own
 * `tool_calls` replayed on a later request, plus the tool names the response
 * streams). The frame's request bodies are the evidence, so no second parser is
 * needed to name the tools of a real run.
 */
export function extractWireToolCalls(requests = [], responses = []) {
  const offeredSet = new Set();
  const executedSet = new Set();
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
    for (const name of res?.toolCallNames ?? []) {
      if (typeof name === 'string' && name.trim()) executedSet.add(name.trim());
    }
  }
  return { offeredTools: [...offeredSet], executedTools: [...executedSet] };
}
