// A stub of the UniWork AI façade for the G7-12 runner tests: a node http server that answers the sign-in, document and
// frame-token routes the runner uses and the chat completions route with a scripted "model". It makes the runner
// testable without the Go server, a database or an upstream, and deterministic: the model is a function of the request.
//
// scriptedModel(cases) is the reference model: it finds the case by its question, calls one offered tool for every
// operation the case requires, then answers with the case's reference answer in the runner's reporting format. It reads
// the cases at runtime, so nothing of a case is copied into a test.

import http from 'node:http';

import { ANSWER_MARKER } from './holdout-answer.mjs';
import { WRITE_OPERATIONS, modulesOfCase, opsOfTool } from './holdout-backend.mjs';

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const sse = (res, chunks, headers) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers });
  res.end(`${chunks.map((c) => `data: ${JSON.stringify(c)}`).join('\n\n')}\n\ndata: [DONE]\n\n`);
};

/** The reply line of a reference answer, in the runner's format. */
export function referenceLine(caseDoc) {
  const ref = caseDoc.referenceAnswer;
  const kinds = new Set(ref.structural.map((s) => s.kind));
  return `${ANSWER_MARKER} ${JSON.stringify({
    numbers: Object.values(ref.numeric),
    items: ref.structural.filter((s) => ['cell', 'formula', 'heading', 'table_cell', 'count'].includes(s.kind)),
    refused: kinds.has('refusal'),
    not_found: kinds.has('not_found'),
    caveats: kinds.has('caveat') ? ['stated'] : [],
  })}`;
}

/** The tool names to call for a case: one offered tool per required operation (first match), deduplicated. */
export function toolsToCall(caseDoc, offered) {
  const modules = modulesOfCase(caseDoc);
  const names = [];
  for (const op of caseDoc.tools.required) {
    const hit = offered.map((t) => t.function.name).find((name) => opsOfTool(modules, name)?.includes(op));
    if (hit && !names.includes(hit)) names.push(hit);
  }
  return names;
}

/**
 * Arguments for a call of the reference model: a write carries the reference edit, so the edit is provable from them. Every
 * value the reference answer reports (cell, formula, heading, table cell) is written at its anchor, a percent probe as a
 * format beside the cell's address, and the reference text stands for the new text of an edit that names no value.
 */
export function argumentsFor(caseDoc, name) {
  const isWrite = opsOfTool(modulesOfCase(caseDoc), name)?.some((op) => WRITE_OPERATIONS.has(op));
  if (!isWrite) return '{}';
  const edits = [];
  for (const { kind, anchor, value } of caseDoc.referenceAnswer.structural) {
    if (!['cell', 'formula', 'heading', 'table_cell'].includes(kind) || String(value).trim() === '') continue;
    const probe = /^(.+)#numberFormat$/.exec(anchor);
    edits.push(probe ? { anchor: probe[1], format: value } : { anchor, value });
  }
  return JSON.stringify({ note: 'reference edit', text: caseDoc.referenceAnswer.text, edits });
}

/** The reference model as a façade handler: (request, state) -> { content, toolCalls, status? }. */
export function scriptedModel(cases) {
  const byQuery = new Map(cases.flatMap((c) => [[c.query.vi, c], [c.query.en, c]]));
  return ({ body, state }) => {
    if (state.step === 0) {
      const user = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const caseDoc = [...byQuery].find(([q]) => user.includes(q))?.[1];
      if (!caseDoc) return { content: `no case for this question ${ANSWER_MARKER} {}` };
      state.caseDoc = caseDoc;
      const names = toolsToCall(caseDoc, body.tools ?? []);
      if (names.length > 0) {
        return { toolCalls: names.map((name, i) => ({ id: `call_${i}`, type: 'function', function: { name, arguments: argumentsFor(caseDoc, name) } })) };
      }
    }
    return { content: `${state.caseDoc.referenceAnswer.text}\n${referenceLine(state.caseDoc)}` };
  };
}

/**
 * Starts the stub. `model` decides each chat reply; `hooks.before(requestIndex)` may return { status, headers } to force
 * an error for that request (429 / 5xx tests). `sessionExpiresAfterCalls` / `frameExpiresAfterCalls` make the stub
 * behave like the D server past a credential's window: an access token that has served that many calls, or a frame token
 * that has served that many chat calls, answers 401 with error_class session until it is renewed. `setRefreshCookie:
 * false` models a sign-in that left no refresh cookie, so the runner has to renew through POST /api/v1/auth/login.
 * `hooks.mint(docId, mintIndex)` may answer a frame-token request with a status instead (404 says the document is gone,
 * G712-63). `mintDelayMs` holds a frame-token answer back, so a test can widen the window in which a second ask's
 * renewal joins the first one's mint (G712-60). Returns { url, requests, stats, close }.
 */
export async function startStubFacade({
  model, hooks = {}, model_name = 'stub-model', delayMs = 0, mintDelayMs = 0,
  sessionExpiresAfterCalls = Infinity, frameExpiresAfterCalls = Infinity, setRefreshCookie = true,
}) {
  const requests = [];
  const stats = { inflight: 0, maxInflight: 0, registers: 0, logins: 0, refreshes: 0, uploads: 0, mints: 0, mintRequests: 0 };
  const conversations = new Map();
  const frames = new Map();
  let docCount = 0;
  let traceCount = 0;
  let serial = 0;
  let session = null;
  let refreshToken = null;

  const unauthorized = (res) => json(res, 401, { error: { code: 'unauthorized', message: 'invalid token', error_class: 'session' } });
  const bearer = (req) => (req.headers.authorization ?? '').replace(/^Bearer /, '');
  /** The live access token, while it has not served more calls than the stub's window allows. */
  const sessionOk = (req) => {
    if (!session || bearer(req) !== session.token || session.uses >= sessionExpiresAfterCalls) return false;
    session.uses += 1;
    return true;
  };
  const issueSession = (res) => {
    serial += 1;
    session = { token: `stub-access-${serial}`, uses: 0 };
    refreshToken = setRefreshCookie ? `stub-refresh-${serial}` : null;
    return json(res, 200, { access_token: session.token, user: { id: 'stub-user' } },
      refreshToken ? { 'Set-Cookie': `uniwork_refresh=${refreshToken}; Path=/api/v1/auth; HttpOnly` } : {});
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = req.url ?? '';
      if (url === '/api/v1/auth/register') { stats.registers += 1; return issueSession(res); }
      if (url === '/api/v1/auth/login') { stats.logins += 1; return issueSession(res); }
      if (url === '/api/v1/auth/refresh') {
        stats.refreshes += 1;
        const sent = /(?:^|;\s*)uniwork_refresh=([^;]*)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
        if (refreshToken === null || sent !== refreshToken) return unauthorized(res);
        return issueSession(res);
      }
      if (url === '/api/v1/orgs') return json(res, 200, { organization: { id: 'stub-org' } });
      if (/^\/api\/v1\/orgs\/[^/]+\/workspaces$/.test(url)) return json(res, 200, { workspace: { id: 'stub-ws' } });
      if (/\/documents\/files$/.test(url)) {
        if (!sessionOk(req)) return unauthorized(res);
        docCount += 1;
        stats.uploads += 1;
        return json(res, 200, { document: { id: `stub-doc-${docCount}` } });
      }
      const mint = /\/documents\/([^/]+)\/office\/frame-token$/.exec(url);
      if (mint) {
        if (!sessionOk(req)) return unauthorized(res);
        stats.mintRequests += 1;
        const forced = hooks.mint?.(mint[1], stats.mintRequests);
        if (forced && forced !== 200) return json(res, forced, { error: `forced ${forced}` });
        stats.mints += 1;
        serial += 1;
        const token = `stub-frame-${mint[1]}-${serial}`;
        frames.set(token, { doc: mint[1], uses: 0 });
        const send = () => json(res, 200, { token });
        return mintDelayMs > 0 ? setTimeout(send, mintDelayMs) : send();
      }
      const chat = /\/office-frame\/documents\/([^/]+)\/ai\/uniwork\/chat\/completions$/.exec(url);
      if (!chat) return json(res, 404, { error: 'not found' });
      const index = requests.length;
      const body = JSON.parse(raw);
      stats.inflight += 1;
      stats.maxInflight = Math.max(stats.maxInflight, stats.inflight);
      res.on('close', () => { stats.inflight -= 1; });
      requests.push({ index, doc: chat[1], authorization: req.headers.authorization, headers: req.headers, body });
      const trace = `trace-${(traceCount += 1)}`;
      const forced = hooks.before?.(index, body);
      if (forced) return json(res, forced.status, { error: forced.code ?? 'forced' }, { 'X-Trace-Id': trace, ...(forced.headers ?? {}) });
      const frame = frames.get(bearer(req));
      if (!frame || frame.doc !== chat[1] || frame.uses >= frameExpiresAfterCalls) return unauthorized(res);
      frame.uses += 1;
      const convId = req.headers['x-uniwork-ai-conversation'] || `conv-${index}`;
      const state = conversations.get(convId) ?? { step: 0 };
      conversations.set(convId, state);
      const reply = model({ body, state, request: requests[index] });
      state.step += 1;
      const answer = () => respond(reply, state, convId, trace, res);
      return delayMs > 0 ? setTimeout(answer, delayMs) : answer();
    });
  });
  function respond(reply, state, convId, trace, res) {
      const headers = { 'X-Trace-Id': trace, 'X-UniWork-AI-Conversation': convId, 'X-UniWork-AI-Run': `run-${convId}` };
      const message = { role: 'assistant', content: reply.content ?? '', ...(reply.toolCalls ? { tool_calls: reply.toolCalls } : {}) };
      sse(res, [
        { model: model_name, choices: [{ delta: message, finish_reason: reply.toolCalls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 }, x_uniwork: { step: state.step - 1, limit: 10, dropped_tool_calls: reply.dropped ?? [] } },
      ], headers);
  }
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: ['http', '://', '127.0.0.1', ':', String(port)].join(''),
    requests,
    stats,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }),
  };
}
