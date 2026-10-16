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
// A run's own cap ends an ask (G7-12 run409): the answer's x_uniwork.step/limit stops the tool loop (1 question turn
// + 8 tool rounds = 9 model calls, never a tenth) and a 409 run_limit_reached ends it the same way, recorded as the
// ask's `capReached` - never an ask error and never a harness abort.
// Both credentials expire mid-run (access token 15 min, frame token 10 min, against a run of ~100 min at one thread):
// the runner renews each one before use and once after a 401, and counts the renewals per ask, per run and in the report.
// The test user's credentials (password, refresh cookie, access token) live in the session closure only - never a run file.

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { execPsql, parseUniworkFacadeResponse } from '../devset-run.mjs';
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
// One run allows 1 question turn + 8 tool-result turns = 9 model calls (A3; server/internal/ai/run_store.go,
// design G6-03b §4.4/§5.4): the ninth tool round - the tenth call - is refused by contract, so the loop never sends
// it. The answer's own x_uniwork.step/limit ends the loop even earlier when the run's cap is already spent
// (run409 report §5.1).
export const MAX_STEPS = 9;
/** The cap one run's tool-result turns are held under: x_uniwork.limit (A13, design §4.4). */
export const TOOL_ROUND_LIMIT_KIND = 'tool_rounds';
export const LANGS = ['vi', 'en'];
const FIXTURES_REL = 'docs/office/g5g6g7/fixtures';
// The windows of the D server (server/internal/config/config.go: AccessTokenTTL 15 min; server/internal/service/office_frame.go:
// OfficeFrameTokenTTL 10 min). Renewing at 12 and 8 minutes leaves room for a call that is already in flight when the
// credential passes its half-life.
export const SESSION_RENEW_AFTER_MS = 12 * 60 * 1000;
export const FRAME_RENEW_AFTER_MS = 8 * 60 * 1000;
export const REFRESH_COOKIE = 'uniwork_refresh';
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

const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b(?::\d{1,5}\b)?/g;
const HOST_PORT_URL_RE = /\bhttps?:\/\/[^\s"'<>]+:\d+\b/gi;
// A URL with credentials before the host (scheme://user:pass@host, scheme://token@host).
const USERINFO_URL_RE = /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s/@"'<>]+@[^\s"'<>]+/gi;
// An email address (G712-62): the test user's own address is a credential like the password, but an address the case set
// or a fixture legitimately carries is content - the caller exempts exactly those strings (see fixtureEmails), never a
// pattern like a whole domain. It is applied AFTER the hard kinds (G712-71), so an address-shaped value that is also a
// key, a credential assignment or a private host keeps its hard kind.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/g;
// Provider-style keys (sk-, ak-, xai-, AIza, AKIA, ghp_/gho_/ghs_, github_pat_, sk_live_/pk_live_, xox*-) and a bearer token of any case.
const KEY_RE = /\b(?:(?:sk|ak|xai|rk|pk)-[A-Za-z0-9_-]{8,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|AIza[0-9A-Za-z_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|bearer\s+[A-Za-z0-9._~+/=-]{16,})\b/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const CREDENTIAL_ASSIGNMENT_RE = /\b(?:api[_-]?key|secret|token|passwd|password)["']?\s*[:=]\s*["']?(?=[^\s"',;]{12,})(?=[^\s"',;]*\d)[^\s"',;]+/gi;
// Private-network hosts: localhost, a name in a private zone, a bare host.tld:port, a bracketed or full IPv6 literal.
const PRIVATE_HOST_RE = /\b(?:localhost(?::\d{1,5})?|(?:[a-z0-9-]+\.)+(?:internal|local|lan|corp|intranet|home|localdomain|svc)(?::\d{1,5})?|[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?!(?:xlsx|xls|docx|doc|pptx|ppt|pdf|md|html|csv|json|txt)\b)[a-z]{2,24}:\d{4,5})\b/gi;
const IPV6_RE = /\[[0-9a-f:]{2,39}\](?::\d{1,5})?|\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5}::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?(?![\w:])/gi;
// A hex run of a sha1 or longer (a 32-hex trace id is the server's own id and stays), and a mixed-case base64-looking run with a digit.
const HEX_RUN_RE = /\b[0-9a-f]{40,}\b/gi;
const BASE64_RUN_RE = /[A-Za-z0-9+/_-]{40,}={0,2}/g;
// A Vietnamese amount of a billion or more ("1.100.100.100 đồng") has the shape of an IPv4 literal; with a currency unit
// beside it, it is money. Without that context it stays ambiguous and is redacted and flagged (a human reads the flag).
const GROUPED_AMOUNT_RE = /^\d{1,3}(?:\.\d{3}){3}$/;
const UNIT_AFTER_RE = /^\s?(?:đồng|vnd|vnđ|đ|₫)(?![\p{L}])/iu;
const UNIT_BEFORE_RE = /(?:₫|vnd|vnđ)\s?$/i;
// A one-digit-lead quad ("2.100.100.100") is a billion-scale amount rather than a private address (those start with 10.,
// 100., 127., 172., 192.), but the shape alone is no exemption (G712-40): it is kept only in the money context — a
// currency unit beside it, or the amount word "số" before it ("số 2.100.100.100") — and never as a URL host or before a port.
const SMALL_LEAD_AMOUNT_RE = /^\d\.\d{3}\.\d{3}\.\d{3}$/;
const AMOUNT_WORD_BEFORE_RE = /(?:^|[^\p{L}])số\s?$/iu;
/**
 * Does a long run of base64 characters look like encoded data rather than a path or an identifier (G712-26)? Random base64 is about
 * 40% upper case, 40% lower case and 16% digits with a '/' in every ~64 characters; a slash-joined path is mostly lower case with
 * slashes every few characters, and a CamelCase identifier has few capitals. Measured on 2026-10-16 (100000 random blobs per length,
 * and every tracked repo path): ~0 paths flagged, 2.2% of 40-character blobs missed (1.8% at 48, 0.5% at 64, 0.2% at 85). A missed
 * blob carries 0-1 digits or looks path-like; the test pins the 40-character rate at or under the measured 2.3% (G712-41).
 */
function looksEncoded(run) {
  const n = run.length;
  const slashes = run.split('/').length - 1;
  if ((slashes >= 2 && slashes * 24 >= n && run.startsWith('/')) || (slashes >= 4 && slashes * 12 >= n)) return false;
  const upper = (run.match(/[A-Z]/g) ?? []).length;
  const lower = (run.match(/[a-z]/g) ?? []).length;
  const digits = (run.match(/\d/g) ?? []).length;
  return upper > 0 && lower > 0 && digits >= 2 && upper / n >= 0.2 && lower / n <= 0.65;
}

/**
 * Redacts secret-looking values in a string; returns the clean text and what was found, as [{ kind, count }].
 * `exemptEmails` (a Set of exact addresses) is the G712-62 escape for content: an address the holdout cases or their
 * fixtures really carry is legitimate data and is kept, while any other address is redacted as the soft kind `email`.
 * The exemption is the exact string, never a pattern, so a credential-shaped address of another domain still goes.
 * The hard kinds run before the soft address rule (G712-71): a value that is both address-shaped and a key, a
 * credential assignment or a private host is reported under that hard kind and still voids the run.
 */
export function redactSecrets(text, { exemptEmails = null } = {}) {
  const found = new Map();
  const note = (kind) => found.set(kind, (found.get(kind) ?? 0) + 1);
  const swap = (re, kind) => { out = out.replace(re, () => { note(kind); return `[redacted:${kind}]`; }); };
  let out = String(text);
  swap(USERINFO_URL_RE, 'userinfo_url');
  swap(HOST_PORT_URL_RE, 'host_port_url');
  swap(PRIVATE_HOST_RE, 'private_host');
  swap(IPV6_RE, 'ipv6');
  out = out.replace(IPV4_RE, (match, offset, whole) => {
    const before = whole.slice(0, offset);
    const after = whole.slice(offset + match.length);
    const money = UNIT_AFTER_RE.test(after) || UNIT_BEFORE_RE.test(before);
    // G712-40: a one-digit-lead quad is kept only in the money context, and never where a URL host or a port follows it,
    // so a portless public URL ("http://1.100.100.100/v1") and a bare quad are redacted and flagged instead.
    if (SMALL_LEAD_AMOUNT_RE.test(match) && (money || AMOUNT_WORD_BEFORE_RE.test(before)) && !/:\/\/$/.test(before) && !after.startsWith(':')) return match;
    if (GROUPED_AMOUNT_RE.test(match) && money) return match;
    note('ipv4');
    return '[redacted:ipv4]';
  });
  swap(KEY_RE, 'key');
  swap(JWT_RE, 'jwt');
  swap(CREDENTIAL_ASSIGNMENT_RE, 'credential');
  // The soft address rule comes last (G712-71), after every hard kind: an address-shaped key, credential assignment or
  // private host was already redacted under its own kind, so it keeps the flag that keeps the run out of a pass.
  out = out.replace(EMAIL_RE, (match) => {
    if (exemptEmails?.has(match)) return match;
    note('email');
    return '[redacted:email]';
  });
  swap(HEX_RUN_RE, 'hex_run');
  out = out.replace(BASE64_RUN_RE, (run) => {
    if (!looksEncoded(run)) return run;
    note('base64_run');
    return '[redacted:base64_run]';
  });
  return { text: out, hits: [...found].map(([kind, count]) => ({ kind, count })) };
}

/** Redacts every string value of a JSON-shaped value (keys are the harness's own); returns { value, hits }. */
export function redactDeep(value, options = {}) {
  const hits = [];
  const walk = (node) => {
    if (typeof node === 'string') {
      const r = redactSecrets(node, options);
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

/**
 * The email-shaped values the holdout cases really carry, read at runtime from the case data the run loads (G712-62).
 * An address that comes with a case or a fixture is legitimate content - a contact in a document, the subject of a
 * question - so the redactor keeps exactly these strings and flags any other address. A case set without one gives an
 * empty set, and nothing is exempt.
 */
export function fixtureEmails(cases) {
  const found = new Set();
  for (const match of JSON.stringify(cases).matchAll(EMAIL_RE)) found.add(match[0]);
  return found;
}


/**
 * One façade request with the retry policy: 429 waits Retry-After, 5xx and network errors back off; 4xx stops.
 * A frame token that is older than FRAME_RENEW_AFTER_MS is renewed before the call goes out, and a 401 renews it
 * (a new token for the SAME mounted document) and retries the call ONCE; a second consecutive 401 stops the ask, as
 * before. A renewal never enters a call's latency: `clientMs` is always that attempt's own time, and the renewal that
 * led to a retried call is named on it (`renewed`).
 */
async function callFacade({ transport, mount, remount, headers, body, step, record, opts }) {
  const sleep = opts.sleep ?? defaultSleep;
  const nowMs = opts.nowMs ?? Date.now;
  const frameRenewAfterMs = opts.frameRenewAfterMs ?? FRAME_RENEW_AFTER_MS;
  const stale = (m) => typeof m?.mintedAt === 'number' && nowMs() - m.mintedAt >= frameRenewAfterMs;
  let current = mount;
  let proactive = false;
  let renewed = false;
  let pendingRenewal = null;
  for (let attempt = 0; ; attempt += 1) {
    if (remount && !proactive && stale(current)) {
      proactive = true;
      current = await remount();
    }
    const t0 = performance.now();
    let res;
    try {
      res = await transport.chat({ mount: current, headers, body });
    } catch (err) {
      res = { status: 0, headers: { get: () => null }, text: '', networkError: String(err?.message ?? err) };
    }
    const clientMs = Number((performance.now() - t0).toFixed(1));
    const call = { step, attempt, status: res.status, clientMs, traceId: res.headers?.get?.('x-trace-id') ?? null };
    if (pendingRenewal !== null) { call.renewed = pendingRenewal; pendingRenewal = null; }
    record.calls.push(call);
    if (res.status === 200) return { res, call, mount: current };
    if (res.status === 401 && !renewed && remount) {
      renewed = true;
      pendingRenewal = 'frame';
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
      const detail = errorBodyOf(res.text);
      // A run_limit_reached is the run's documented end, not a fault (A3; design §4.3; run409 report §5.2): the ask
      // ends where it is, with the refused cap's kind ('tool_rounds' | 'model_calls') recorded. Every other 4xx -
      // conversation_expired and run_expired included - stays the call's failure.
      if (res.status === 409 && detail?.code === 'run_limit_reached') {
        call.refusal = 'run_limit_reached';
        const kind = typeof detail.fields?.limit === 'string' && detail.fields.limit !== '' ? detail.fields.limit : 'unknown';
        return { res, call, mount: current, capReached: { kind, refused: true } };
      }
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

/** The run's tool-round cap as the answer reports it ({ kind, step, limit }), null when the answer carries none. */
function toolRoundCap(xUniwork) {
  const step = Number(xUniwork?.step);
  const limit = Number(xUniwork?.limit);
  if (!Number.isFinite(step) || !Number.isFinite(limit)) return null;
  return { kind: TOOL_ROUND_LIMIT_KIND, step, limit };
}

/** Asks one case in one language through the façade; returns the ask record (graded, with every call it made). */
export async function askOne({ caseDoc, lang, transport, session, catalogue, opts }) {
  const started = performance.now();
  const record = {
    id: caseDoc.id, lang, format: caseDoc.format, group: groupOf(caseDoc), modules: modulesOfCase(caseDoc), category: caseDoc.category,
    oracleType: caseDoc.oracle.type, calls: [], toolCalls: [], dropped: [],
    expects: { numeric: caseDoc.expected.numeric.length, writes: caseDoc.expected.writes, mustNotContain: caseDoc.expected.mustNotContain.length },
    counts: { rateLimited: 0, serverErrors: 0, retries: 0 }, renewals: [], modelTurns: 0, error: null,
  };
  const renewals = record.renewals;
  // A credential wait the ask itself paid, as one note per wait: a renewal it ran (`session` / `frame`, one note per
  // token minted) or the wait it spent on another ask's mount already in flight (`mount_wait`, G712-70). Every note is
  // time that leaves `wallMsNoRenewals`; only the session and frame notes are token renewals the run summary counts.
  const note = (kind, ms) => renewals.push({ kind, ms: Number(Number(ms).toFixed(1)) });
  const backend = (opts.backendFactory ?? createBackend)(caseDoc, { fixturesDir: opts.fixturesDir });
  const tools = offeredTools(caseDoc, catalogue);
  const offeredNames = new Set(tools.map((t) => t.function.name));
  record.unobtainableOps = unobtainableOps(caseDoc, tools);
  const fixtureId = caseDoc.fixtures[0].id;
  // The mount of one ask. A fresh frame token for the SAME mounted document is a renewal (the fixture is uploaded again
  // only when the document is gone); the first mount of a fixture is not. The renewal is noted on the ask and its own
  // time never lands in a call's latency. A mount that joined a renewal already in flight for this document minted no
  // token, so it is not noted as a frame renewal: the frame count follows the tokens actually minted, not the asks that
  // asked for one (G712-60) - but the wait it spent is noted, so it leaves the clean wall too (G712-70).
  const mountAsk = async (fixtureId0, { fresh = false } = {}) => {
    const t0 = performance.now();
    const next = await session.mount(fixtureId0, { fresh });
    if (fresh && next.minted) note('frame', performance.now() - t0);
    else if (next.waitedMs > 0) note('mount_wait', next.waitedMs);
    renewals.push(...(next.renewals ?? []));
    return next;
  };
  let mount;
  try {
    mount = await mountAsk(fixtureId);
  } catch (err) {
    throw new HarnessAbort(`cannot mount fixture ${fixtureId}: ${String(err?.message ?? err).slice(0, 160)}`);
  }
  const remount = () => mountAsk(fixtureId, { fresh: true });
  let conversation = '';
  let run = '';
  let messages = firstMessages(caseDoc, lang);
  let reply = '';
  // The run cap that ended the ask: null when the ask ended with a final reply or an error (design §4.4; run409 §5).
  let capReached = null;
  let lastStep = null;
  let lastLimit = null;
  let lastContent = '';
  let usageTokens = { input: 0, output: 0, source: 'none' };
  const models = new Set();
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const headers = {};
    if (conversation) headers['X-UniWork-AI-Conversation'] = conversation;
    if (run) headers['X-UniWork-AI-Run'] = run;
    const body = { model: 'uniwork', stream: true, messages, ...(tools.length > 0 ? { tools } : {}) };
    const out = await callFacade({ transport, mount, remount, headers, body, step, record, opts });
    mount = out.mount ?? mount;
    if (out.capReached) {
      // A 409 run_limit_reached is the run's documented end (design §4.3; run409 report §5.2): the finished run's
      // header is dropped and the conversation is kept, so a later question opens a new run in it. The ask ends with
      // what the model produced so far - never an error, never a harness abort.
      run = '';
      capReached = { ...out.capReached, step: lastStep, limit: lastLimit };
      reply = lastContent;
      break;
    }
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
    const observed = toolRoundCap(parsed.xUniwork);
    if (observed) { lastStep = observed.step; lastLimit = observed.limit; }
    lastContent = parsed.content;
    if (!parsed.toolCalls || parsed.toolCalls.length === 0) { reply = parsed.content; break; }
    // The run's own cap, read from the answer (A13, design §4.4): step is the tool rounds the run has spent after
    // this turn and limit is 8, so an answer that spends the last round ends the ask here - one more tool turn would
    // be refused. The last answer's tool calls are not executed: their result has no turn left to come back on.
    if (observed && observed.step >= observed.limit) {
      capReached = { ...observed, refused: false };
      reply = parsed.content;
      break;
    }
    if (step === MAX_STEPS - 1) {
      capReached = { kind: TOOL_ROUND_LIMIT_KIND, step: observed?.step ?? lastStep, limit: observed?.limit ?? lastLimit, refused: false };
      reply = parsed.content;
      break;
    }
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
  }
  record.capReached = capReached;
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
  // G712-61: `wallMs` is the raw wall around the whole ask and therefore carries the renewal time noted on it;
  // `wallMsNoRenewals` takes that time out, so a pilot's "server overhead (wall − model sum)" reads at the no-renewal
  // level. Both are kept, the raw one beside the clean one.
  record.renewalMs = Number(renewals.reduce((n, r) => n + (Number.isFinite(r.ms) ? r.ms : 0), 0).toFixed(1));
  record.wallMsNoRenewals = Number(Math.max(0, record.wallMs - record.renewalMs).toFixed(1));
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
    const clean = redactDeep(record, { exemptEmails: rest.opts?.exemptEmails });
    return { ...clean.value, redactions: clean.hits };
  } catch (err) {
    if (err instanceof HarnessAbort) throw err;
    const message = redactSecrets(`harness exception: ${String(err?.message ?? err).slice(0, 160)}`, { exemptEmails: rest.opts?.exemptEmails ?? null }).text;
    const scored = score(caseDoc, null);
    return {
      id: caseDoc.id, lang, format: caseDoc.format, group: groupOf(caseDoc), modules: modulesOfCase(caseDoc), category: caseDoc.category, oracleType: caseDoc.oracle.type,
      calls: [], toolCalls: [], dropped: [], writeLog: [], invalidArguments: [], denied: [], writes: 0, models: [], modelTurns: 0,
      expects: { numeric: caseDoc.expected.numeric.length, writes: caseDoc.expected.writes, mustNotContain: caseDoc.expected.mustNotContain.length },
      counts: { rateLimited: 0, serverErrors: 0, retries: 0 }, renewals: [], tokens: { input: 0, output: 0, source: 'none' },
      adapter: { reportStatus: 'missing', anchorLenient: 0, extraFigures: 0 }, answer: null, unobtainableOps: [], capReached: null,
      error: message, errored: true, status: scored.status, checks: scored.checks, outsideAllowlist: [], wallMs: 0, renewalMs: 0, wallMsNoRenewals: 0, redactions: [],
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

/** The token renewals of a list of asks, per kind: the run summary number the report reads. A renewal voids no run. */
export function countRenewals(asks) {
  const counts = { session: 0, frame: 0 };
  for (const ask of asks) for (const r of ask.renewals ?? []) if (r.kind in counts) counts[r.kind] += 1;
  return counts;
}

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
  // G712-62: an address the case set itself carries (read here, at runtime) is content and is kept; every other
  // address in an ask is a credential-shaped value and is redacted and listed as the soft kind `email`.
  options.exemptEmails ??= fixtureEmails(cases);
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
      reason = redactSecrets(String(err?.message ?? err), { exemptEmails: options.exemptEmails }).text;
      asks = err.results ?? [];
    }
    asks = asks.filter(Boolean);
    const { rows, error: usageReaderError } = await attachUsage(asks, usageReader);
    const tally = asks.reduce((t, a) => ({ ...t, [a.status]: (t[a.status] ?? 0) + 1 }), {});
    const renewals = countRenewals(asks);
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
      renewals,
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
    const renewed = renewals.session + renewals.frame > 0 ? `, ${renewals.session} session + ${renewals.frame} frame renewal(s)` : '';
    log(`run ${n}/${runs} ${status}: ${asks.length} asks, ${JSON.stringify(tally)}${renewed}${flagged} -> ${file}`);
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

async function postJson(serverUrl, route, body, token, { exemptEmails = null } = {}) {
  const res = await fetch(`${serverUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  // A setup failure is a server body: it can echo the address the test user signed up with, so it is redacted here
  // like every other text the runner throws (G712-72).
  if (!res.ok) throw new Error(redactSecrets(`${route} failed: ${res.status} ${(await res.text()).slice(0, 200)}`, { exemptEmails }).text);
  return res.json();
}

/** A raw POST (status, body and the refresh cookie the server set) for the routes whose 401 the caller recovers from. */
async function postJsonRaw(serverUrl, route, body, { cookie = null } = {}) {
  const res = await fetch(`${serverUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, text: await res.text(), cookie: refreshCookieOf(res.headers.get('set-cookie')) };
}

/** The error detail of a server error body ({ error: { code, error_class, fields } }), null when the body is not one. */
export function errorBodyOf(text) {
  try {
    const body = JSON.parse(String(text));
    return body?.error && typeof body.error === 'object' ? body.error : null;
  } catch { return null; }
}

/** The error_class of a server error body ({ error: { code, error_class } }), null when the body is not one. */
export function errorClassOf(text) {
  const value = errorBodyOf(text)?.error_class;
  return typeof value === 'string' ? value : null;
}

/** The refresh cookie of a Set-Cookie header, as the "name=value" pair, null when the header is not one. */
export function refreshCookieOf(header) {
  if (!header) return null;
  const pair = String(header).split(';')[0].trim();
  return pair.startsWith(`${REFRESH_COOKIE}=`) && pair.length > REFRESH_COOKIE.length + 1 ? pair : null;
}

/**
 * One test user, one organization, one workspace; every fixture is uploaded once and its frame token minted on demand.
 * The credentials (email address, password, refresh cookie, access token) live in this closure only: they are never
 * written to an ask record, a log line or a run file. A session-token request renews the session the way the web app does - POST
 * /api/v1/auth/refresh when the sign-in's refresh cookie is held, else POST /api/v1/auth/login - before use when the
 * access token is older than SESSION_RENEW_AFTER_MS and once more when the answer is a 401 of class session; a second
 * 401 stays the caller's failure, as before. A fresh mount mints a new frame token for the SAME document and re-uploads
 * the fixture only when the document is gone (404). Every mount reports the renewals it caused as [{ kind, ms }] and
 * whether this call minted the frame token itself (`minted`), so two asks sharing one renewal count it once (G712-60),
 * and how long it waited on another ask's mount already in flight (`waitedMs`, G712-70).
 */
export async function createServerSession({
  serverUrl, dbUrl, sql = execPsql, fixturesRel = FIXTURES_REL, email = `g712-holdout-${Date.now()}@example.com`,
  password = `Holdout-${Date.now()}-Pw!`, nowMs = Date.now, sessionRenewAfterMs = SESSION_RENEW_AFTER_MS, exemptEmails = null,
}) {
  const stamp = Date.now();
  const credentials = { email, password, cookie: null };
  const session = { token: '', userId: '', orgId: '', wsId: '' };
  let issuedAtMs = nowMs();
  let renewal = null;
  // Every text this closure throws is a server body and can echo the address the run signed up with, so it is redacted
  // before it reaches the operator's stderr, the way the abort reason and the ask errors are (G712-72). `exemptEmails`
  // keeps the exact addresses the case set carries, as everywhere else.
  const setupFailed = (text) => new Error(redactSecrets(text, { exemptEmails }).text);

  const adopt = (body) => {
    session.token = body.access_token || body.token || '';
    issuedAtMs = nowMs();
  };
  // Single-flight: two threads that cross the window together must not race the rotating refresh cookie (the second
  // refresh would present a consumed token and be refused, as in the web app's own refreshInFlight).
  const renewSession = () => {
    renewal ??= (async () => {
      let viaRefresh = credentials.cookie !== null;
      let out = viaRefresh
        ? await postJsonRaw(serverUrl, '/api/v1/auth/refresh', {}, { cookie: credentials.cookie })
        : await postJsonRaw(serverUrl, '/api/v1/auth/login', { email: credentials.email, password: credentials.password });
      if (!out.ok && viaRefresh) {
        // The refresh token is gone or was already rotated away; the credentials are still the way back.
        viaRefresh = false;
        out = await postJsonRaw(serverUrl, '/api/v1/auth/login', { email: credentials.email, password: credentials.password });
      }
      if (!out.ok) throw setupFailed(`session renewal via ${viaRefresh ? 'refresh' : 'login'} failed: ${out.status} ${out.text.slice(0, 160)}`);
      if (out.cookie) credentials.cookie = out.cookie;
      adopt(JSON.parse(out.text));
      return out;
    })().finally(() => { renewal = null; });
    return renewal;
  };
  const noteSessionRenewal = async (renewals) => {
    const t0 = performance.now();
    await renewSession();
    renewals.push({ kind: 'session', ms: Number((performance.now() - t0).toFixed(1)) });
  };
  /** One request on the session token: renewed before use when the token is old, and once after a 401 of class session. */
  const withSession = async (send, renewals) => {
    if (nowMs() - issuedAtMs >= sessionRenewAfterMs) await noteSessionRenewal(renewals);
    let out = await send();
    if (out.status === 401 && errorClassOf(out.text) === 'session') {
      await noteSessionRenewal(renewals);
      out = await send();
    }
    return out;
  };

  const reg = await postJsonRaw(serverUrl, '/api/v1/auth/register', { email: credentials.email, password: credentials.password, display_name: 'G7-12 Holdout Runner' });
  if (!reg.ok) throw setupFailed(`/api/v1/auth/register failed: ${reg.status} ${reg.text.slice(0, 200)}`);
  if (reg.cookie) credentials.cookie = reg.cookie;
  adopt(JSON.parse(reg.text));
  session.userId = JSON.parse(reg.text).user?.id ?? '';
  if (dbUrl) {
    const values = FLAGS.map((key) => `('${newId()}', '${key}', 'global', '', true, 'G7-12 holdout eval', '${session.userId}', 'human')`).join(',');
    sql(dbUrl, ['-v', 'ON_ERROR_STOP=1', '-c', `UPDATE users SET email_verified_at = now() WHERE id = '${session.userId}';
      INSERT INTO feature_flag_overrides (id, flag_key, scope_type, scope_id, enabled, note, created_by, created_by_kind) VALUES ${values}
      ON CONFLICT (flag_key, scope_type, scope_id) DO UPDATE SET enabled = EXCLUDED.enabled;`]);
  }
  const org = await postJson(serverUrl, '/api/v1/orgs', { name: 'G7-12 Org', slug: `g712-org-${stamp}` }, session.token, { exemptEmails });
  session.orgId = org.organization?.id || org.id;
  const ws = await postJson(serverUrl, `/api/v1/orgs/${session.orgId}/workspaces`, { name: 'G7-12 Workspace', slug: `g712-ws-${stamp}` }, session.token, { exemptEmails });
  session.wsId = ws.workspace?.id || ws.id;
  if (dbUrl) sql(dbUrl, ['-v', 'ON_ERROR_STOP=1', '-c', `UPDATE subscriptions SET overrides = '{"office.ai_cloud": true, "ai.tokens": 100000000}'::jsonb WHERE organization_id = '${session.orgId}';`]);

  const fileNameOf = (fixtureId) => fs.readdirSync(path.join(repoRoot, fixturesRel))
    .find((f) => f.startsWith(`${fixtureId}.`) && !f.endsWith('.oracle.json'));

  /** Uploads the fixture with the session token; the failure text is the one a harness abort has always carried. */
  const upload = async (fixtureId, name, renewals) => {
    const ext = name.split('.').pop();
    const bytes = fs.readFileSync(path.join(repoRoot, fixturesRel, name));
    const out = await withSession(async () => {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: MIME[ext] ?? 'application/octet-stream' }), name);
      form.append('title', name);
      const res = await fetch(`${serverUrl}/api/v1/workspaces/${session.wsId}/documents/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
        body: form,
      });
      return { ok: res.ok, status: res.status, text: await res.text() };
    }, renewals);
    if (!out.ok) throw setupFailed(`upload file ${name} failed: ${out.status} ${out.text.slice(0, 200)}`);
    const body = JSON.parse(out.text);
    return body.document?.id || body.file?.document_id || body.file?.id || body.id;
  };

  /** A new frame token for an existing document; null (404) means the document is gone and the fixture must be uploaded. */
  const mint = async (docId, name, renewals) => {
    const out = await withSession(async () => {
      const res = await fetch(`${serverUrl}/api/v1/documents/${docId}/office/frame-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({}),
      });
      return { ok: res.ok, status: res.status, text: await res.text() };
    }, renewals);
    if (out.status === 404) return null;
    if (!out.ok) throw setupFailed(`mint frame token for ${name} failed: ${out.status} ${out.text.slice(0, 200)}`);
    const body = JSON.parse(out.text);
    return { docId, frameToken: body.token, aiGrant: body.ai, mintedAt: nowMs() };
  };

  const mounts = new Map();
  const inflight = new Map();
  /** The mount of one fixture: a new frame token for a document that still exists, an upload only when it is gone. */
  const mountFixture = async (fixtureId, renewals) => {
    const name = fileNameOf(fixtureId);
    const cached = mounts.get(fixtureId);
    let mount = cached ? await mint(cached.docId, name, renewals) : null;
    if (mount === null) {
      const docId = await upload(fixtureId, name, renewals);
      mount = await mint(docId, name, renewals);
      if (mount === null) throw new Error(`mint frame token for ${name} failed: 404 the document just uploaded is not readable`);
    }
    mounts.set(fixtureId, mount);
    return mount;
  };
  return {
    orgId: session.orgId,
    // `minted` says this call minted a frame token itself; a call that read the cache or joined a mount already in
    // flight minted nothing, so the frame-renewal count stays the tokens minted (G712-60). `renewals` carries the
    // session renewals the mount caused, reported by the call that ran it. `waitedMs` is the time this call spent on
    // another ask's mount already in flight (0 for the call that ran the mount and for a cache read), so the joiner can
    // record a wait it paid and leave it out of the clean wall a pilot measures server overhead with (G712-70).
    async mount(fixtureId, { fresh = false } = {}) {
      const cached = mounts.get(fixtureId);
      if (!fresh && cached) return { ...cached, renewals: [], minted: false, waitedMs: 0 };
      // One mount per fixture at a time: two lanes that start together must not upload the same fixture twice. The ask
      // that started the mount reports the renewals it caused; an ask that joined a shared mount reports none.
      const pending = inflight.get(fixtureId);
      if (pending) {
        const t0 = performance.now();
        const joined = await pending.mount;
        return { ...joined, renewals: [], minted: false, waitedMs: Number((performance.now() - t0).toFixed(1)) };
      }
      const renewals = [];
      const started = { mount: mountFixture(fixtureId, renewals).finally(() => inflight.delete(fixtureId)) };
      inflight.set(fixtureId, started);
      return { ...(await started.mount), renewals, minted: true, waitedMs: 0 };
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
  const session = await createServerSession({ serverUrl: args.serverUrl, dbUrl: args.dbUrl, exemptEmails: fixtureEmails(cases) });
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
