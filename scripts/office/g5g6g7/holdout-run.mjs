#!/usr/bin/env node
// G7-12 holdout eval runner (UNI-1384): asks every holdout case in vi and en through the UniWork AI façade, grades the
// answers with holdout-score.mjs and writes one JSON file per run. Run it N times (default 3) and read the result with
// holdout-report.mjs; no run is ever preferred over another.
//
//   node scripts/office/g5g6g7/holdout-run.mjs --server-url <origin> --redis on|off [--db-url <postgres-url>] \
//     [--runs 3] [--threads 1|2] [--out <dir>] [--server-sha <sha>] [--tool-schemas <file>]
//
// Cases are read at runtime from docs/office/g5g6g7/holdout/cases; no question, answer or marker is copied into code.
// The run files may echo reference values, so they go OUTSIDE the repo (default ~/office-g5g6g7/reports/g6-ai_server/
// g712-runs/); an --out inside the repo (symlinks resolved) is refused unless --allow-in-repo is given (tests use a temp
// dir). One invocation writes ONE session folder <out>/<sessionId>/ holding run-NN.json and manifest.json (session id,
// case-set hash, the sha256 of every run file): the report counts exactly the runs the manifest lists.

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { execPsql, parseUniworkFacadeResponse, uploadFixtureAndMintFrameToken } from '../devset-run.mjs';
import { deriveAnswer, reportingFooter } from './holdout-answer.mjs';
import { createBackend, modulesOfCase, offeredTools, toolCatalogue, toolSurface, unobtainableOps } from './holdout-backend.mjs';
import { readPin, resolveDSha } from './evidence.mjs';
import { loadCases, score } from './holdout-score.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const RUN_KIND = 'uniwork-office-g7-holdout-run';
export const MANIFEST_KIND = 'uniwork-office-g7-holdout-manifest';
export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');
export const DEFAULT_CASES_DIR = path.join(repoRoot, 'docs/office/g5g6g7/holdout/cases');
export const DEFAULT_OUT_DIR = path.join(os.homedir(), 'office-g5g6g7/reports/g6-ai_server/g712-runs');
// The façade's own cap is 10 model calls per run (server/internal/ai/run_store.go); a run that reaches it is an error.
export const MAX_STEPS = 10;
export const LANGS = ['vi', 'en'];
const FIXTURES_REL = 'docs/office/g5g6g7/fixtures';
const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  md: 'text/markdown',
  html: 'text/html',
};

export const groupOf = (caseDoc) =>
  caseDoc.format === 'xlsx' ? 'xlsx' : caseDoc.format === 'docx' ? 'docx' : caseDoc.format === 'cross' ? 'cross' : 'other';

/** The asks of one run: every case in vi then en, ordered by id, so two runs ask the same things in the same order. */
export function buildAsks(cases, { only = null, limit = 0 } = {}) {
  let list = [...cases].sort((a, b) => a.id.localeCompare(b.id));
  if (only) list = list.filter((c) => only.includes(c.id));
  if (limit > 0) list = list.slice(0, limit);
  return list.flatMap((caseDoc) => LANGS.map((lang) => ({ caseDoc, lang })));
}

/** Prior turns replayed before the question (setup.history); a tool turn is replayed as assistant text. */
function historyMessages(caseDoc) {
  return (caseDoc.setup?.history ?? []).map((turn) =>
    turn.role === 'tool'
      ? { role: 'assistant', content: `[tool result] ${turn.text}` }
      : { role: turn.role, content: turn.text },
  );
}

export function firstMessages(caseDoc, lang) {
  const context = [];
  if (caseDoc.setup?.activeSheet) context.push(`Active sheet: "${caseDoc.setup.activeSheet}"`);
  if (caseDoc.setup?.selection) context.push(`Selection: ${caseDoc.setup.selection}`);
  const prefix = context.length > 0 ? `[${context.join('; ')}]\n` : '';
  return [...historyMessages(caseDoc), { role: 'user', content: `${prefix}${caseDoc.query[lang]}\n${reportingFooter()}` }];
}

/** Token counts the façade put in its reply (usage block), when the vendor reported one. */
function facadeUsage(raw) {
  let usage = null;
  for (const line of String(raw).split('\n')) {
    const body = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : line.trim();
    if (!body.startsWith('{')) continue;
    try {
      const u = JSON.parse(body).usage;
      if (u && typeof u === 'object') usage = { input: Number(u.prompt_tokens ?? 0), output: Number(u.completion_tokens ?? 0) };
    } catch { /* a partial frame is not an error here */ }
  }
  return usage;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A failure of the harness itself (no fixture can be mounted): the run stops, what it finished is kept. */
export class HarnessAbort extends Error {}

// ---- secret guard: redact in place, never throw away a run (G712-9) ----

const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const HOST_PORT_URL_RE = /\bhttps?:\/\/[^\s"'<>]+:\d+\b/gi;
const KEY_RE = /\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,})\b/g;
// A Vietnamese amount of a billion or more ("1.100.100.100 đồng") has the shape of an IPv4 literal; with a currency unit
// beside it, it is money. Without a unit the shape stays ambiguous and is redacted and flagged (a human reads the flag).
const GROUPED_AMOUNT_RE = /^\d{1,3}(?:\.\d{3}){3}$/;
const UNIT_AFTER_RE = /^\s?(?:đồng|vnd|vnđ|đ|₫)(?![\p{L}])/iu;
const UNIT_BEFORE_RE = /(?:₫|vnd|vnđ)\s?$/i;

/** Redacts secret-looking values in a string; returns the clean text and what was found, as [{ kind, count }]. */
export function redactSecrets(text) {
  const found = new Map();
  const note = (kind) => found.set(kind, (found.get(kind) ?? 0) + 1);
  let out = String(text);
  out = out.replace(HOST_PORT_URL_RE, () => { note('host_port_url'); return '[redacted:host_port_url]'; });
  out = out.replace(IPV4_RE, (match, offset, whole) => {
    if (GROUPED_AMOUNT_RE.test(match) && (UNIT_AFTER_RE.test(whole.slice(offset + match.length)) || UNIT_BEFORE_RE.test(whole.slice(0, offset)))) return match;
    note('ipv4');
    return '[redacted:ipv4]';
  });
  out = out.replace(KEY_RE, () => { note('key'); return '[redacted:key]'; });
  return { text: out, hits: [...found].map(([kind, count]) => ({ kind, count })) };
}

/** Redacts every string value of a JSON-shaped value (keys are the harness's own); returns { value, hits }. */
export function redactDeep(value) {
  const hits = [];
  const walk = (node) => {
    if (typeof node === 'string') {
      const r = redactSecrets(node);
      hits.push(...r.hits);
      return r.text;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    return node;
  };
  const clean = walk(value);
  const merged = new Map();
  for (const h of hits) merged.set(h.kind, (merged.get(h.kind) ?? 0) + h.count);
  return { value: clean, hits: [...merged].map(([kind, count]) => ({ kind, count })) };
}


/** One façade request with the retry policy: 429 waits Retry-After, 5xx and network errors back off; 4xx stops. */
async function callFacade({ transport, mount, remount, headers, body, step, record, opts }) {
  const sleep = opts.sleep ?? defaultSleep;
  let current = mount;
  let remounted = false;
  for (let attempt = 0; ; attempt += 1) {
    const t0 = performance.now();
    let res;
    try {
      res = await transport.chat({ mount: current, headers, body });
    } catch (err) {
      res = { status: 0, headers: { get: () => null }, text: '', networkError: String(err?.message ?? err) };
    }
    const clientMs = Number((performance.now() - t0).toFixed(1));
    const call = { step, attempt, status: res.status, clientMs, traceId: res.headers?.get?.('x-trace-id') ?? null };
    record.calls.push(call);
    if (res.status === 200) return { res, call, mount: current };
    if (res.status === 401 && !remounted && remount) {
      remounted = true;
      record.counts.remounts += 1;
      current = await remount();
      continue;
    }
    let wait = 0;
    if (res.status === 429) {
      record.counts.rateLimited += 1;
      const after = Number(res.headers?.get?.('retry-after'));
      wait = Math.min((Number.isFinite(after) && after > 0 ? after : 5) * 1000, opts.retryWaitCapMs);
    } else if (res.status === 0 || res.status >= 500) {
      record.counts.serverErrors += 1;
      wait = Math.min(2000 * (attempt + 1), opts.retryWaitCapMs);
    } else {
      call.error = `HTTP ${res.status}`;
      return { res, call, mount: current, failed: `HTTP ${res.status}: ${String(res.text).slice(0, 160)}` };
    }
    if (attempt >= opts.maxRetries) {
      call.error = res.networkError ?? `HTTP ${res.status}`;
      return { res, call, mount: current, failed: `gave up after ${attempt + 1} attempts (HTTP ${res.status})` };
    }
    record.counts.retries += 1;
    await sleep(wait);
  }
}

/** Asks one case in one language through the façade; returns the ask record (graded, with every call it made). */
export async function askOne({ caseDoc, lang, transport, session, catalogue, opts }) {
  const started = performance.now();
  const record = {
    id: caseDoc.id, lang, format: caseDoc.format, group: groupOf(caseDoc), category: caseDoc.category,
    oracleType: caseDoc.oracle.type, calls: [], toolCalls: [], dropped: [],
    expects: { numeric: caseDoc.expected.numeric.length, writes: caseDoc.expected.writes, mustNotContain: caseDoc.expected.mustNotContain.length },
    counts: { rateLimited: 0, serverErrors: 0, retries: 0, remounts: 0 }, modelTurns: 0, error: null,
  };
  const backend = (opts.backendFactory ?? createBackend)(caseDoc, { fixturesDir: opts.fixturesDir });
  const tools = offeredTools(caseDoc, catalogue);
  const offeredNames = new Set(tools.map((t) => t.function.name));
  record.unobtainableOps = unobtainableOps(caseDoc, tools);
  const fixtureId = caseDoc.fixtures[0].id;
  let mount;
  try {
    mount = await session.mount(fixtureId);
  } catch (err) {
    throw new HarnessAbort(`cannot mount fixture ${fixtureId}: ${String(err?.message ?? err).slice(0, 160)}`);
  }
  const remount = () => session.mount(fixtureId, { fresh: true });
  let conversation = '';
  let run = '';
  let messages = firstMessages(caseDoc, lang);
  let reply = '';
  let usageTokens = { input: 0, output: 0, source: 'none' };
  const models = new Set();
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const headers = {};
    if (conversation) headers['X-UniWork-AI-Conversation'] = conversation;
    if (run) headers['X-UniWork-AI-Run'] = run;
    const body = { model: 'uniwork', stream: true, messages, ...(tools.length > 0 ? { tools } : {}) };
    const out = await callFacade({ transport, mount, remount, headers, body, step, record, opts });
    mount = out.mount ?? mount;
    if (out.failed) { record.error = out.failed; break; }
    conversation = out.res.headers.get('x-uniwork-ai-conversation') ?? conversation;
    run = out.res.headers.get('x-uniwork-ai-run') ?? run;
    let parsed;
    try {
      parsed = parseUniworkFacadeResponse(out.res.text);
    } catch (err) {
      record.error = `unreadable façade reply: ${String(err?.message ?? err).slice(0, 120)}`;
      break;
    }
    record.modelTurns += 1;
    if (parsed.model) models.add(parsed.model);
    for (const dropped of parsed.xUniwork?.dropped_tool_calls ?? []) record.dropped.push(dropped.name);
    const usage = facadeUsage(out.res.text);
    if (usage) usageTokens = { input: usageTokens.input + usage.input, output: usageTokens.output + usage.output, source: 'facade' };
    out.call.finishReason = parsed.finishReason;
    out.call.model = parsed.model || null;
    if (!parsed.toolCalls || parsed.toolCalls.length === 0) { reply = parsed.content; break; }
    const results = [];
    for (const tc of parsed.toolCalls) {
      const name = tc.function?.name ?? '';
      if (!offeredNames.has(name)) {
        // The façade drops a tool the caller did not offer; one that still arrives is reported, never executed.
        record.toolCalls.push({ name, offered: false, write: false, denied: null });
        results.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: `unknown tool ${name}` }) });
        continue;
      }
      const writesBefore = backend.writes();
      const deniedBefore = backend.denied().length;
      const result = backend.execute(name, tc.function?.arguments ?? '{}');
      record.toolCalls.push({
        name, write: backend.writes() > writesBefore, denied: backend.denied().length > deniedBefore ? backend.denied().at(-1).reason : null,
      });
      results.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(name === 'ask_clarification'
        ? { ...result, note: 'The user will answer later. Reply to the user now with what you need to know, then finish with the reporting line.' }
        : result) });
    }
    messages = results;
    if (step === MAX_STEPS - 1) record.error = `no final reply within ${MAX_STEPS} model calls (run_limit_reached)`;
  }
  record.models = [...models];
  record.tokens = usageTokens;
  record.writes = backend.writes();
  record.denied = backend.denied();
  record.writeLog = backend.writeLog();
  record.invalidArguments = backend.invalid();
  // A malformed argument fails the ask (the model still got the real tool's refusal, so the trace is complete).
  if (record.invalidArguments.length > 0 && !record.error) {
    record.error = `invalid tool arguments: ${[...new Set(record.invalidArguments.map((i) => i.name))].join(', ')}`;
  }
  const { answer, adapter } = deriveAnswer(
    caseDoc,
    { reply, calls: record.toolCalls, writes: backend.writes(), writeLog: record.writeLog, dropped: record.dropped, modules: modulesOfCase(caseDoc), sheetNames: backend.sheetNames(), sourceText: backend.sourceText() },
    { numbers: opts.numbers, computeByReply: opts.computeByReply, anchors: opts.anchors },
  );
  record.adapter = adapter;
  record.answer = answer;
  const scored = record.error ? score(caseDoc, null) : score(caseDoc, answer);
  record.status = scored.status;
  record.errored = Boolean(record.error);
  record.checks = scored.checks;
  // An errored ask keeps the evidence of the tools it called: the outside-allowlist list comes from the answer's tool
  // trace then, because score(null) has no tool checks (G712-14).
  record.outsideAllowlist = record.error
    ? answer.tools.used.filter((op) => !caseDoc.tools.allowed.includes(op))
    : scored.checks.filter((c) => c.id.startsWith('tool_allowed:') && c.status === 'fail').map((c) => c.id.slice(13));
  record.wallMs = Number((performance.now() - started).toFixed(1));
  return record;
}

/**
 * Runs a list of asks on `threads` workers (1 or 2); results keep the order of the asks. A worker that throws stops the
 * other lane from taking new asks; the error is rethrown once both lanes settle, carrying every finished ask as `results`.
 */
export async function runPool(asks, threads, worker) {
  const results = new Array(asks.length);
  let next = 0;
  let failure = null;
  const lanes = Array.from({ length: Math.min(threads, asks.length) }, async () => {
    while (failure === null) {
      const i = next;
      next += 1;
      if (i >= asks.length) return;
      try {
        results[i] = await worker(asks[i], i);
      } catch (err) {
        failure ??= err;
      }
    }
  });
  await Promise.all(lanes);
  if (failure !== null) {
    failure.results = results.filter(Boolean);
    throw failure;
  }
  return results;
}

/** One ask that cannot take down the run: an exception other than a harness abort becomes an errored, failed ask. */
async function askSafely({ caseDoc, lang, ...rest }) {
  try {
    const record = await askOne({ caseDoc, lang, ...rest });
    const clean = redactDeep(record);
    return { ...clean.value, redactions: clean.hits };
  } catch (err) {
    if (err instanceof HarnessAbort) throw err;
    const message = redactSecrets(`harness exception: ${String(err?.message ?? err).slice(0, 160)}`).text;
    const scored = score(caseDoc, null);
    return {
      id: caseDoc.id, lang, format: caseDoc.format, group: groupOf(caseDoc), category: caseDoc.category, oracleType: caseDoc.oracle.type,
      calls: [], toolCalls: [], dropped: [], writeLog: [], invalidArguments: [], denied: [], writes: 0, models: [], modelTurns: 0,
      expects: { numeric: caseDoc.expected.numeric.length, writes: caseDoc.expected.writes, mustNotContain: caseDoc.expected.mustNotContain.length },
      counts: { rateLimited: 0, serverErrors: 0, retries: 0, remounts: 0 }, tokens: { input: 0, output: 0, source: 'none' },
      adapter: { reportStatus: 'missing', anchorLenient: 0, extraFigures: 0 }, answer: null, unobtainableOps: [],
      error: message, errored: true, status: scored.status, checks: scored.checks, outsideAllowlist: [], wallMs: 0, redactions: [],
    };
  }
}

/** Attaches the server's own usage row (latency, tokens, prompt id, provider, model) to every call that has a trace id. */
async function attachUsage(asks, usageReader) {
  const ids = [...new Set(asks.flatMap((a) => a.calls.map((c) => c.traceId)).filter(Boolean))];
  let rows = new Map();
  let error = null;
  if (ids.length > 0 && usageReader) {
    try {
      rows = await usageReader(ids);
    } catch (err) {
      error = redactSecrets(String(err?.message ?? err).slice(0, 200)).text;
    }
  }
  for (const ask of asks) {
    let inTok = 0;
    let outTok = 0;
    let withRow = 0;
    for (const call of ask.calls) {
      const row = rows.get(call.traceId);
      call.usage = row ?? null;
      if (row) { withRow += 1; inTok += row.inputTokens; outTok += row.outputTokens; }
    }
    if (withRow > 0) ask.tokens = { input: inTok, output: outTok, source: 'ai_usage_events', callsWithRow: withRow, calls: ask.calls.length };
  }
  return { rows, error };
}

const uniq = (list) => [...new Set(list.filter((v) => v !== null && v !== undefined && v !== ''))].sort();

/** The release tuple of one run: what was under test, as observed (an unobserved part says "unknown", never a guess). */
export function buildTuple({ dSha, dirty, shaSource, pin, redis, asks, rows }) {
  const usage = [...rows.values()];
  return {
    dSha, dirty, dShaSource: shaSource, framePin: pin || 'unknown', framePinSource: 'checkout of the runner', redisSource: 'declared (--redis)',
    promptIds: uniq(usage.map((r) => r.promptId)).length > 0 ? uniq(usage.map((r) => r.promptId)) : ['unknown (no ai_usage_events rows)'],
    providers: uniq(usage.map((r) => r.provider)).length > 0 ? uniq(usage.map((r) => r.provider)) : ['unknown (no ai_usage_events rows)'],
    resolvedModels: uniq([...usage.map((r) => r.model), ...asks.flatMap((a) => a.models)]),
    redis,
  };
}

function gitState(cwd = repoRoot) {
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  return dirty.status === 0 && dirty.stdout.trim().length > 0;
}

/** Hash of the case set that was read (ids and a hash of every case file's content, never the content): same set, same hash. */
export function caseSetSha256(cases) {
  const lines = [...cases].sort((a, b) => a.id.localeCompare(b.id)).map((c) => `${c.id}:${sha256Hex(JSON.stringify(c))}`);
  return sha256Hex(lines.join('\n'));
}

export const newSessionId = (now = new Date()) => `s-${now.toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;

const writeManifest = (dir, manifest) => {
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.renameSync(`${file}.tmp`, file);
};

/** Refuses to run into a folder that already holds runs or a manifest: a session folder is written once. */
function assertFreshDir(dir) {
  if (!fs.existsSync(dir)) return;
  const present = fs.readdirSync(dir).filter((f) => /^run-\d+\.json$/.test(f) || f === 'manifest.json');
  if (present.length > 0) throw new Error(`${dir} already holds ${present.join(', ')}: a session folder is written once (use a new --out)`);
}

/**
 * Preflight of a real run (the CLI always calls it): Redis must be declared, and every module's tool surface must be a
 * real one (--tool-schemas) unless --allow-name-only says the run is knowingly hollow (a signed verdict will be INCONCLUSIVE).
 */
export function preflight({ redis, catalogue, allowNameOnly = false }) {
  if (redis !== 'on' && redis !== 'off') throw new Error('--redis on|off is required for a real run (the release tuple needs it; "unknown" is refused)');
  const hollow = Object.entries(toolSurface(catalogue)).filter(([, v]) => v.source === 'name-only').map(([m]) => m);
  if (hollow.length > 0 && !allowNameOnly) {
    throw new Error(`no real tool schemas for module(s) ${hollow.join(', ')}: pass --tool-schemas <file> covering them, or --allow-name-only to run knowingly with name-only tools`);
  }
}

/** Runs the suite `runs` times, sequentially; writes run-NN.json (never overwritten) and the manifest. Never selects a run. */
export async function runHoldout({
  cases, runs = 3, threads = 2, outDir, transport, session, usageReader = null, redis = 'unknown', serverSha = '',
  onlyIds = null, limit = 0, opts = {}, log = () => {}, now = () => new Date(), sessionId = newSessionId(now()),
}) {
  const options = { maxRetries: 3, retryWaitCapMs: 10000, numbers: 'strict', anchors: 'strict', computeByReply: true, ...opts };
  const catalogue = options.catalogue ?? toolCatalogue(options.toolSchemas ?? null);
  const surface = toolSurface(catalogue, { fileSha256: options.toolSchemasSha256 ?? null });
  const partial = Boolean(onlyIds) || limit > 0;
  const shaFromCheckout = serverSha === '';
  const dSha = shaFromCheckout ? resolveDSha() : serverSha;
  const dirty = shaFromCheckout ? gitState() : false;
  const caseSha = caseSetSha256(cases);
  assertFreshDir(outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = {
    schemaVersion: 1, kind: MANIFEST_KIND, sessionId, runsPlanned: runs, caseCount: cases.length, caseSetSha256: caseSha,
    asksPerRun: cases.length * LANGS.length, partial, status: 'in_progress', startedAt: now().toISOString(), finishedAt: null, runs: [],
  };
  writeManifest(outDir, manifest);
  const written = [];
  for (let n = 1; n <= runs; n += 1) {
    const asksPlan = buildAsks(cases, { only: onlyIds, limit });
    const startedAt = now().toISOString();
    let asks = [];
    let status = 'completed';
    let reason = null;
    try {
      asks = await runPool(asksPlan, threads, ({ caseDoc, lang }) => askSafely({ caseDoc, lang, transport, session, catalogue, opts: options }));
    } catch (err) {
      status = 'aborted';
      reason = redactSecrets(String(err?.message ?? err)).text;
      asks = err.results ?? [];
    }
    asks = asks.filter(Boolean);
    const { rows, error: usageReaderError } = await attachUsage(asks, usageReader);
    const tally = asks.reduce((t, a) => ({ ...t, [a.status]: (t[a.status] ?? 0) + 1 }), {});
    const redactions = asks.filter((a) => a.redactions?.length > 0).map((a) => ({ ask: `${a.id}/${a.lang}`, kinds: a.redactions }));
    const doc = {
      schemaVersion: 1, kind: RUN_KIND, sessionId, runIndex: n, runsPlanned: runs, status, reason, partial, startedAt, finishedAt: now().toISOString(),
      caseCount: cases.length, caseSetSha256: caseSha,
      tuple: buildTuple({ dSha, dirty, shaSource: shaFromCheckout ? 'checkout HEAD' : '--server-sha', pin: readPin(), redis, asks, rows }),
      config: {
        threads, answerProtocol: 'v1', numbers: options.numbers, anchors: options.anchors, computeByReply: options.computeByReply, maxRetries: options.maxRetries,
        langs: LANGS, casesRead: cases.length, footerSha256: sha256Hex(reportingFooter()), toolSurface: surface,
        toolSurfaceSha256: sha256Hex(JSON.stringify(surface)), usageReader: usageReader ? 'ai_usage_events' : 'none', usageReaderError,
        harness: {
          backend: 'emulated fixture backend (tool results from synthetic fixtures; writes counted, never applied; viewer, revoke and stale emulated)',
          path: 'AI facade route, not the panel',
          tools: 'every tool of the case module(s), the same list for every case of a module',
        },
      },
      redactions,
      asks,
    };
    const file = path.join(outDir, `run-${String(n).padStart(2, '0')}.json`);
    const json = `${JSON.stringify(doc, null, 2)}\n`;
    fs.writeFileSync(file, json, { encoding: 'utf8', flag: 'wx' });
    written.push(file);
    manifest.runs.push({ runIndex: n, file: path.basename(file), sha256: sha256Hex(json), status, asks: asks.length });
    manifest.status = status === 'completed' ? (n === runs ? 'completed' : 'in_progress') : 'aborted';
    manifest.finishedAt = manifest.status === 'in_progress' ? null : now().toISOString();
    writeManifest(outDir, manifest);
    const flagged = redactions.length > 0 ? `, ${redactions.length} ask(s) had values redacted` : '';
    log(`run ${n}/${runs} ${status}: ${asks.length} asks, ${JSON.stringify(tally)}${flagged} -> ${file}`);
    if (status !== 'completed') break;
  }
  return written;
}

// ---- real server: session, transport, usage rows ----

export function httpTransport(serverUrl, timeoutMs = 65000) {
  return {
    async chat({ mount, headers, body }) {
      const res = await fetch(`${serverUrl}/api/v1/office-frame/documents/${mount.docId}/ai/uniwork/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mount.frameToken}`, ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: res.status, headers: res.headers, text: await res.text() };
    },
  };
}

const FLAGS = [
  'office_ai_uniwork', 'office_ai_uniwork_xlsx', 'office_ai_uniwork_docx', 'office_ai_uniwork_pptx', 'office_ai_uniwork_pdf',
  'office_ai_uniwork_markdown', 'office_ai_uniwork_html', 'office_docs_web', 'office_sheets_web', 'office_slides_web',
  'office_pdf_web', 'office_markdown_web', 'office_html_web', 'documents',
];
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const newId = () => Array.from({ length: 26 }, () => ULID_ALPHABET[Math.floor(Math.random() * 32)]).join('');

async function postJson(serverUrl, route, body, token) {
  const res = await fetch(`${serverUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${route} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** One test user, one organization, one workspace; every fixture is uploaded once and its frame token minted on demand. */
export async function createServerSession({ serverUrl, dbUrl, sql = execPsql, fixturesRel = FIXTURES_REL }) {
  const stamp = Date.now();
  const password = `Holdout-${stamp}-Pw!`;
  const reg = await postJson(serverUrl, '/api/v1/auth/register', { email: `g712-holdout-${stamp}@example.com`, password, display_name: 'G7-12 Holdout Runner' });
  const token = reg.access_token || reg.token;
  const userId = reg.user?.id;
  if (dbUrl) {
    const values = FLAGS.map((key) => `('${newId()}', '${key}', 'global', '', true, 'G7-12 holdout eval', '${userId}', 'human')`).join(',');
    sql(dbUrl, ['-v', 'ON_ERROR_STOP=1', '-c', `UPDATE users SET email_verified_at = now() WHERE id = '${userId}';
      INSERT INTO feature_flag_overrides (id, flag_key, scope_type, scope_id, enabled, note, created_by, created_by_kind) VALUES ${values}
      ON CONFLICT (flag_key, scope_type, scope_id) DO UPDATE SET enabled = EXCLUDED.enabled;`]);
  }
  const org = await postJson(serverUrl, '/api/v1/orgs', { name: 'G7-12 Org', slug: `g712-org-${stamp}` }, token);
  const orgId = org.organization?.id || org.id;
  const ws = await postJson(serverUrl, `/api/v1/orgs/${orgId}/workspaces`, { name: 'G7-12 Workspace', slug: `g712-ws-${stamp}` }, token);
  const wsId = ws.workspace?.id || ws.id;
  if (dbUrl) sql(dbUrl, ['-v', 'ON_ERROR_STOP=1', '-c', `UPDATE subscriptions SET overrides = '{"office.ai_cloud": true, "ai.tokens": 100000000}'::jsonb WHERE organization_id = '${orgId}';`]);
  const session = { token, userId, orgId, wsId };
  const mounts = new Map();
  return {
    orgId,
    async mount(fixtureId, { fresh = false } = {}) {
      if (!fresh && mounts.has(fixtureId)) return mounts.get(fixtureId);
      const ext = fs.readdirSync(path.join(repoRoot, fixturesRel)).find((f) => f.startsWith(`${fixtureId}.`) && !f.endsWith('.oracle.json')).split('.').pop();
      const minted = await uploadFixtureAndMintFrameToken(serverUrl, session, `${fixturesRel}/${fixtureId}.${ext}`, `${fixtureId}.${ext}`, MIME[ext] ?? 'application/octet-stream');
      mounts.set(fixtureId, minted);
      return minted;
    },
  };
}

/** Reads the server's own usage rows by trace id (correlation_id); empty without a database. */
export function createUsageReader({ dbUrl, sql = execPsql, sleep = defaultSleep, tries = 5 }) {
  if (!dbUrl) return null;
  return async (traceIds) => {
    const safe = traceIds.filter((id) => /^[0-9a-zA-Z-]+$/.test(id));
    const rows = new Map();
    for (let attempt = 0; attempt < tries && rows.size < safe.length; attempt += 1) {
      if (attempt > 0) await sleep(1000);
      const out = sql(dbUrl, ['-At', '-F', '|', '-c', `SELECT correlation_id, prompt_id, provider, model, status, COALESCE(latency_ms, -1), input_tokens, output_tokens
        FROM ai_usage_events WHERE capability = 'office_uniwork_ai' AND correlation_id IN (${safe.map((id) => `'${id}'`).join(',')});`]);
      for (const line of out.split('\n').filter(Boolean)) {
        const [traceId, promptId, provider, model, status, latency, input, output] = line.split('|');
        rows.set(traceId, { promptId, provider, model, status, latencyMs: Number(latency) >= 0 ? Number(latency) : null, inputTokens: Number(input), outputTokens: Number(output) });
      }
    }
    return rows;
  };
}

// ---- CLI ----

/** True when `target` is inside the repo, resolving symlinks of the nearest existing parent (a link into the repo counts). */
export function isInsideRepo(target, root = repoRoot) {
  let probe = path.resolve(target);
  const tail = [];
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) { tail.unshift(path.basename(probe)); probe = path.dirname(probe); }
  const real = path.join(fs.realpathSync(probe), ...tail);
  const rel = path.relative(fs.realpathSync(root), real);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function parseArgs(argv) {
  const args = { runs: 3, threads: 2, out: DEFAULT_OUT_DIR, cases: DEFAULT_CASES_DIR, redis: 'unknown', numbers: 'strict', anchors: 'strict', maxRetries: 3, allowInRepo: false, allowNameOnly: false };
  const need = (i) => { if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--server-url') args.serverUrl = need(i++).replace(/\/+$/, '');
    else if (flag === '--db-url') args.dbUrl = need(i++);
    else if (flag === '--runs') args.runs = Number(need(i++));
    else if (flag === '--threads') args.threads = Number(need(i++));
    else if (flag === '--out') args.out = path.resolve(need(i++));
    else if (flag === '--cases') args.cases = path.resolve(need(i++));
    else if (flag === '--redis') args.redis = need(i++);
    else if (flag === '--server-sha') args.serverSha = need(i++);
    else if (flag === '--numbers') args.numbers = need(i++);
    else if (flag === '--anchors') args.anchors = need(i++);
    else if (flag === '--compute-by-reply') args.computeByReply = need(i++);
    else if (flag === '--max-retries') args.maxRetries = Number(need(i++));
    else if (flag === '--tool-schemas') args.toolSchemas = path.resolve(need(i++));
    else if (flag === '--allow-name-only') args.allowNameOnly = true;
    else if (flag === '--only') args.only = need(i++).split(',').filter(Boolean);
    else if (flag === '--limit') args.limit = Number(need(i++));
    else if (flag === '--allow-in-repo') args.allowInRepo = true;
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`unknown argument ${flag}`);
  }
  if (args.help) return args;
  if (!Number.isInteger(args.runs) || args.runs < 1) throw new Error('--runs must be an integer >= 1');
  if (![1, 2].includes(args.threads)) throw new Error('--threads must be 1 or 2 (the sign-off profile is at most 2 concurrent threads)');
  if (!['on', 'off', 'unknown'].includes(args.redis)) throw new Error('--redis must be on, off or unknown');
  if (!['strict', 'lenient'].includes(args.numbers)) throw new Error('--numbers must be strict or lenient');
  if (!['strict', 'lenient'].includes(args.anchors)) throw new Error('--anchors must be strict or lenient (lenient makes a signed verdict INCONCLUSIVE)');
  if (args.computeByReply !== undefined && !['on', 'off'].includes(args.computeByReply)) throw new Error('--compute-by-reply must be on or off');
  if (!args.serverUrl) throw new Error('--server-url is required');
  if (!args.allowInRepo && isInsideRepo(args.out)) {
    throw new Error(`--out ${args.out} is inside the repo: run files can echo reference values, keep them outside (or pass --allow-in-repo)`);
  }
  return args;
}

const HELP = `Usage: node scripts/office/g5g6g7/holdout-run.mjs --server-url <origin> --redis on|off [--db-url <postgres-url>] [--runs 3] [--threads 1|2]
  [--out <dir>] [--server-sha <sha>] [--tool-schemas <file>] [--allow-name-only] [--numbers strict|lenient] [--anchors strict|lenient]
  [--compute-by-reply on|off] [--max-retries 3] [--only HO-ID,HO-ID] [--limit N] [--allow-in-repo]
Writes ONE session folder <out>/<sessionId>/ with run-NN.json and manifest.json (default --out is outside the repo). A real run needs
--redis on|off and real tool schemas for every module (--tool-schemas, or --allow-name-only for a knowingly hollow run).
--only/--limit make a partial run, which the report never counts as complete. --anchors lenient and --numbers lenient are opt-in
policies; a signed verdict on such runs is INCONCLUSIVE.
Read the result with: node scripts/office/g5g6g7/holdout-report.mjs --runs <session folder> [--reviews <file>] [--thresholds <signed.json>]
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return; }
  const schemaBytes = args.toolSchemas ? fs.readFileSync(args.toolSchemas) : null;
  const toolSchemas = schemaBytes ? JSON.parse(schemaBytes.toString('utf8')) : null;
  preflight({ redis: args.redis, catalogue: toolCatalogue(toolSchemas), allowNameOnly: args.allowNameOnly });
  if (!args.dbUrl) process.stderr.write('warning: no --db-url: provider, prompt_id and server latency stay unknown, so a signed verdict on these runs is INCONCLUSIVE\n');
  const { cases } = loadCases(args.cases);
  const sessionId = newSessionId();
  const outDir = path.join(args.out, sessionId);
  const session = await createServerSession({ serverUrl: args.serverUrl, dbUrl: args.dbUrl });
  const files = await runHoldout({
    cases, runs: args.runs, threads: args.threads, outDir, sessionId, transport: httpTransport(args.serverUrl), session,
    usageReader: createUsageReader({ dbUrl: args.dbUrl }), redis: args.redis, serverSha: args.serverSha ?? '', onlyIds: args.only ?? null, limit: args.limit ?? 0,
    opts: {
      numbers: args.numbers, anchors: args.anchors, computeByReply: args.computeByReply !== 'off', maxRetries: args.maxRetries, toolSchemas,
      toolSchemasSha256: schemaBytes ? sha256Hex(schemaBytes) : null,
    },
    log: (line) => process.stdout.write(`${line}\n`),
  });
  process.stdout.write(`${files.length} run file(s) written; read them with holdout-report.mjs --runs ${outDir}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
