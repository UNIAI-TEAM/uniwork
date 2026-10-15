// Pure logic of the G7-03a app-layer fault runner (UNI-1380, WI-4): which rows
// run, how the app's intent trace is read and filtered, how a row's client
// transitions are asserted and how exits and cases aggregate. No Electron, no
// server, no network: app-cases.test.mjs pins all of it with fixtures.
//
// The trace is the fork's test hook (`UNIWORK_SYNC_TRACE_FILE`, fork
// apps/shell/src/main/uniwork-sync/test-hooks/trace.ts): one JSON line per
// intent transition, `{ts, intentId, documentId, from, to, httpStatus?, code?}`.

import { join } from "node:path";
import { BLOCKED_EXIT_CODE, aggregateExitCode, assertion } from "./server-cases-lib.mjs";

export { BLOCKED_EXIT_CODE, aggregateExitCode, assertion };

/** The fork's queue states (fork queue/record.ts QUEUE_STATES). */
export const QUEUE_STATES = Object.freeze([
  "queued", "paused_offline", "paused_user", "paused_admin", "validating", "uploading", "committing",
  "reconciling", "reconciling-stuck", "committed", "conflict", "blocked", "failed", "cancelled",
]);

const TRACE_KEYS = new Set(["ts", "intentId", "documentId", "from", "to", "httpStatus", "code"]);

/**
 * Splits the app rows of cases.json into the ones this runner drives (`ready`)
 * and the ones it only reports (`pending <dep>` -> BLOCKED with the dependency).
 * With `caseId`, exactly that app row (ready or pending); an unknown id throws.
 */
export function selectAppCases(casesDoc, { caseId } = {}) {
  const rows = (Array.isArray(casesDoc?.cases) ? casesDoc.cases : []).filter((row) => row.layer === "app");
  const pick = caseId ? rows.filter((row) => row.id === String(caseId).trim()) : rows;
  if (caseId && pick.length === 0) throw new Error(`unknown app fault case "${caseId}"`);
  return {
    runnable: pick.filter((row) => row.status === "ready"),
    blocked: pick
      .filter((row) => row.status !== "ready")
      .map((row) => ({ row, reason: row.status.startsWith("pending") ? row.status : `not ready: ${row.status}` })),
  };
}

/**
 * Parses the trace file's text. A torn or foreign line (the app writes
 * best-effort) is counted, never fatal; only the allow-listed keys survive, so
 * a later hook field cannot smuggle content into an artifact.
 */
export function parseTraceText(text) {
  const lines = [];
  let rejected = 0;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      rejected += 1;
      continue;
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.intentId !== "string"
      || typeof parsed.documentId !== "string" || !QUEUE_STATES.includes(parsed.to)) {
      rejected += 1;
      continue;
    }
    const clean = {};
    for (const key of Object.keys(parsed)) if (TRACE_KEYS.has(key)) clean[key] = parsed[key];
    if (clean.from === undefined) clean.from = null;
    lines.push(clean);
  }
  return { lines, rejected };
}

/** The trace lines of one document, in file order; `sinceTs` drops older lines. */
export function filterTrace(lines, documentId, { sinceTs = null } = {}) {
  return lines.filter((line) => line.documentId === documentId && (!sinceTs || String(line.ts) >= String(sinceTs)));
}

/** Distinct intent ids in first-seen order. */
export function intentIdsOf(lines) {
  return [...new Set(lines.map((line) => line.intentId))];
}

/** The states an intent passed through: the first line's `from` (when known), then every `to`. */
export function statePath(lines, intentId = null) {
  const own = intentId ? lines.filter((line) => line.intentId === intentId) : lines;
  if (own.length === 0) return [];
  const path = own[0].from ? [own[0].from] : [];
  for (const line of own) if (path[path.length - 1] !== line.to) path.push(line.to);
  return path;
}

/**
 * Matches a state path against a pattern: state names in order, `"a|b"` for
 * either, `"*"` for any run of states (also none). Without `*` the states must
 * be adjacent, so a pattern says exactly where gaps are allowed.
 */
export function matchStatePath(path, pattern) {
  const memo = new Map();
  const walk = (i, j) => {
    const key = `${i}:${j}`;
    if (memo.has(key)) return memo.get(key);
    let ok;
    if (j === pattern.length) ok = i === path.length;
    else if (pattern[j] === "*") ok = walk(i, j + 1) || (i < path.length && walk(i + 1, j));
    else ok = i < path.length && pattern[j].split("|").includes(path[i]) && walk(i + 1, j + 1);
    memo.set(key, ok);
    return ok;
  };
  return walk(0, 0);
}

/** Assertion: the (single or named) intent's path matches `pattern`. */
export function assertStatePath(name, lines, pattern, { intentId = null } = {}) {
  const path = statePath(lines, intentId);
  return assertion(name, pattern.join(" → "), path.join(" → ") || "(no transition)", matchStatePath(path, pattern));
}

/** Assertion: no intent of the lines ever entered one of `states`. */
export function assertNeverState(name, lines, states) {
  const seen = lines.filter((line) => states.includes(line.to)).map((line) => line.to);
  return assertion(name, `never ${states.join("/")}`, seen.length ? `entered ${[...new Set(seen)].join("/")}` : "never", seen.length === 0);
}

/** The last trace line entering `state`, or null. */
export function lastEntry(lines, state) {
  for (let i = lines.length - 1; i >= 0; i -= 1) if (lines[i].to === state) return lines[i];
  return null;
}

/** Assertion: some line enters `state` with `code` (blocked reasons ride on `code`). */
export function assertEntersWithCode(name, lines, state, code) {
  const hits = lines.filter((line) => line.to === state);
  const actual = hits.length ? hits.map((line) => `${line.to}:${line.code ?? "-"}`).join(", ") : "(never entered)";
  return assertion(name, `${state}:${code}`, actual, hits.some((line) => line.code === code));
}

// ---- proxy log -------------------------------------------------------------

const COMMIT_PATH = /^\/api\/v1\/documents\/[^/]+\/versions\/commit$/;
const UPLOAD_PATH = /^\/api\/v1\/documents\/[^/]+\/uploads$/;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function parseProxyLog(raw) {
  return String(raw ?? "").split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

const forDoc = (entry, documentId) => !documentId || entry.path?.includes(`/documents/${documentId}/`);
export const commitPosts = (log, documentId = null) =>
  log.filter((e) => e.method === "POST" && COMMIT_PATH.test(e.path) && forDoc(e, documentId));
export const commitLookups = (log, documentId = null) =>
  log.filter((e) => e.method === "GET" && COMMIT_PATH.test(e.path) && forDoc(e, documentId));
export const uploadPosts = (log, documentId = null) =>
  log.filter((e) => e.method === "POST" && UPLOAD_PATH.test(e.path) && forDoc(e, documentId));
/** Writes on the document's routes (upload, commit, any mutation). */
export const documentWrites = (log, documentId) =>
  log.filter((e) => WRITE_METHODS.has(e.method) && forDoc(e, documentId));
/** Entries at or after an ISO timestamp. */
export const logSince = (log, ts) => log.filter((e) => !ts || String(e.ts) >= String(ts));
/** Distinct non-null keyTags of entries. */
export const keyTagsOf = (entries) => [...new Set(entries.map((e) => e.keyTag).filter(Boolean))];
/** True when the upstream server answered (not dropped / reset / synthetic / held-only). */
export const reachedUpstream = (entry) => Number.isInteger(entry?.status);

/**
 * Every sync request of the document in log order (uploads, commit POSTs,
 * commit lookups), each reduced to what a FAIL needs to be read without the
 * raw log: kind, ts, method, status, keyTag, ruleId.
 */
export function syncRequests(log, documentId = null) {
  const kindOf = (e) => (UPLOAD_PATH.test(e.path) ? "upload" : e.method === "GET" ? "lookup" : "commit");
  return log
    .filter((e) => forDoc(e, documentId) && (
      (e.method === "POST" && (COMMIT_PATH.test(e.path) || UPLOAD_PATH.test(e.path))) || (e.method === "GET" && COMMIT_PATH.test(e.path))))
    .map((e) => ({ kind: kindOf(e), ts: e.ts ?? null, method: e.method, status: e.status ?? null, keyTag: e.keyTag ?? null, ruleId: e.ruleId ?? null }));
}

// ---- intent-log.jsonl of an app row (matrix §4) --------------------------------

/** The keys of every `intent-log.jsonl` line, server and app rows alike (matrix §4). */
export const INTENT_LOG_KEYS = Object.freeze(["ts", "case", "source", "intent", "keyTag", "attempt", "event", "from", "to", "http"]);

/** The one keyTag every commit POST and lookup of the document carries, or null when there is none or several. */
export function commitKeyTag(log, documentId) {
  const tags = keyTagsOf([...commitPosts(log, documentId), ...commitLookups(log, documentId)]);
  return tags.length === 1 ? tags[0] : null;
}

/**
 * Maps the fork's trace lines to the documented intent-log schema, so an app
 * row's `intent-log.jsonl` reads like a server row's: `source: "app-trace"`,
 * `intent` = the trace's logical intent id, `keyTag` = the run's single commit
 * key (null when none or several), `attempt` = dispatch runs of that intent so
 * far (entries into `validating`; null before the first), `event` = the
 * transition, `http` = `{status, code}` from the trace (`code` is the server's
 * error code, or the reason on a `blocked` entry; null when the line carries
 * neither). No document id and no body: the unmapped lines stay in `app-trace.jsonl`.
 */
export function buildAppIntentLog(traceLines, { caseId, keyTag = null }) {
  const attempts = new Map();
  return traceLines.map((line) => {
    if (line.to === "validating") attempts.set(line.intentId, (attempts.get(line.intentId) ?? 0) + 1);
    const hasHttp = line.httpStatus !== undefined || line.code !== undefined;
    return {
      ts: line.ts,
      case: caseId,
      source: "app-trace",
      intent: line.intentId,
      keyTag,
      attempt: attempts.get(line.intentId) ?? null,
      event: `${line.from ?? "start"} -> ${line.to}`,
      from: line.from ?? null,
      to: line.to,
      http: hasHttp ? { status: line.httpStatus ?? null, code: line.code ?? null } : null,
    };
  });
}

const jsonl = (rows) => rows.map((row) => `${JSON.stringify(row)}\n`).join("");

/** The trace-derived files of one app run: the mapped `intent-log.jsonl` and the unmapped `app-trace.jsonl`. */
export function appTraceArtifacts({ caseId, traceLines, log, documentId }) {
  return {
    "intent-log.jsonl": jsonl(buildAppIntentLog(traceLines, { caseId, keyTag: documentId ? commitKeyTag(log, documentId) : null })),
    "app-trace.jsonl": jsonl(traceLines),
  };
}

/** The evidence a run's result carries: the full intent trace and the sync requests of its document. */
export const runEvidenceOf = (traceLines, log, documentId) => ({
  documentId: documentId ?? null,
  trace: traceLines.map((l) => ({ ts: l.ts, intentId: l.intentId, from: l.from ?? null, to: l.to, ...(l.code ? { code: l.code } : {}), ...(l.httpStatus ? { httpStatus: l.httpStatus } : {}) })),
  requests: documentId ? syncRequests(log, documentId) : [],
});

/** Printable lines of a FAIL run's evidence (empty for any other result). */
export function failEvidenceLines(caseId, run) {
  if (run?.result !== "FAIL" || !run.evidence) return [];
  const head = `${caseId}${run.label ? ` [${run.label}]` : ""}`;
  return [
    ...run.evidence.trace.map((l) => `  ${head} trace ${l.ts} ${l.from ?? "∅"} -> ${l.to}${l.code ? ` code=${l.code}` : ""}${l.httpStatus ? ` http=${l.httpStatus}` : ""}`),
    ...run.evidence.requests.map((r) => `  ${head} proxy ${r.ts} ${r.kind} ${r.method} ${r.status ?? "-"} key=${r.keyTag ?? "-"} rule=${r.ruleId ?? "-"}`),
  ];
}

// ---- results ----------------------------------------------------------------

/** One run per exit of a multi-exit row; a row without `exits` is one run. */
export function expandExits(row) {
  if (!Array.isArray(row?.exits) || row.exits.length === 0) return [{ index: 0, label: row?.scenario ?? row?.id, exit: null }];
  return row.exits.map((exit, index) => ({ index: index + 1, label: exit.exit, exit }));
}

/** Result of one run: BLOCKED when a blocker is named, else PASS only when every assertion holds. */
export function runResult({ label = null, assertions = [], blocker = null, predicted = null, evidence = null }) {
  const result = blocker ? "BLOCKED" : assertions.length > 0 && assertions.every((a) => a.ok === true) ? "PASS" : "FAIL";
  return {
    label,
    result,
    assertions,
    ...(blocker ? { blocker: String(blocker) } : {}),
    ...(predicted && result === "FAIL" ? { predicted } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

/**
 * A case from its runs: any FAIL fails it, all PASS passes it, otherwise it is
 * BLOCKED (a blocked exit proves nothing, so a mix of PASS and BLOCKED is not a PASS).
 */
export function caseResult(row, runs) {
  const statuses = runs.map((run) => run.result);
  const result = statuses.length === 0 ? "BLOCKED"
    : statuses.includes("FAIL") ? "FAIL"
      : statuses.every((s) => s === "PASS") ? "PASS" : "BLOCKED";
  const blockers = runs.filter((run) => run.blocker).map((run) => (run.label ? `${run.label}: ${run.blocker}` : run.blocker));
  // the case is "predicted" only when every failing run is: one unpredicted FAIL must not hide behind another run's tag
  const failed = runs.filter((run) => run.result === "FAIL");
  const predicted = failed.every((run) => run.predicted) ? failed.map((run) => run.predicted) : [];
  return {
    case: row.id,
    ac: [...(row.ac ?? [])],
    fixture: row.fixture,
    layer: "app",
    result,
    ...(blockers.length ? { blocker: blockers.join("; ") } : {}),
    ...(predicted.length ? { predicted: [...new Set(predicted)].join(", ") } : {}),
    exits: runs.map((run, i) => ({ n: runs.length > 1 ? i + 1 : 0, ...run })),
    assertions: runs.flatMap((run) => run.assertions.map((a) => ({ ...a, ...(runs.length > 1 ? { exit: run.label } : {}) }))),
  };
}

/** Result of a row that never ran (pending dependency, missing precondition). */
export function blockedCase(row, reason) {
  return caseResult(row, [runResult({ label: row.scenario ?? row.id, blocker: reason })]);
}

/**
 * Exit code of the whole run: the ready rows decide (pending rows are reported
 * BLOCKED but would otherwise keep a fully green run from ever exiting 0);
 * nothing ready ran -> 77.
 */
export function runExitCode(readyResults) {
  return readyResults.length > 0 ? aggregateExitCode(readyResults) : BLOCKED_EXIT_CODE;
}

/** The predicted-FAIL tag a row's notes carry ("predicted FAIL F4" -> "F4"), or null. */
export function predictedTag(row) {
  const match = /predicted FAIL\s+([A-Z0-9-]+)/.exec(String(row?.notes ?? ""));
  return match ? match[1] : null;
}

/**
 * The predicted FAIL of one run: the exit's own `predicted` (FQ-40's
 * `reconciling -> committed`: OQ-F11), else the row's note tag, else OQ-F6 on the
 * document_archived exits. A tag on one exit never covers the row's other exits.
 */
export function predictedFor(row, run) {
  return run?.exit?.predicted ?? predictedTag(row) ?? (/document_archived/.test(String(run?.label)) ? "OQ-F6" : null);
}

// ---- app plumbing (pure parts) -----------------------------------------------

/** The `attempt_id` of the server's desktop authorization URL (service/desktop_auth.go). */
export function attemptIdFromAuthorizationUrl(url) {
  try {
    return new URL(String(url)).searchParams.get("attempt_id") || null;
  } catch {
    return null;
  }
}

/** The account's budgeted sync-store scope (fork store/paths.ts scopeDir under wiring.ts's root). */
export function syncStoreScopeDir(userDataDir, deploymentId, accountId) {
  return join(userDataDir, "uniwork-sync", "store", deploymentId, accountId);
}

/** The fork's store budget (wiring.ts SYNC_STORE_BUDGET_BYTES). */
export const SYNC_STORE_BUDGET_BYTES = 256 * 1024 * 1024;

/**
 * The extra environment of an app launch for a fault case: the proxy as the
 * API origin is the caller's; these are the fork's test hooks and switches.
 */
export function faultAppExtraEnv({ traceFile, stuckAfterMs = null, recheckMs = null, display = "", xauthority = "" }) {
  return {
    UNIWORK_OFFICE_CHANNEL: "dev",
    UNIWORK_AUTH_E2E_NO_BROWSER: "1",
    UNIWORK_BRIDGE_SILENT: "1",
    GENOFFICE_LANG: "en",
    UNIWORK_SYNC_TRACE_FILE: traceFile,
    ...(stuckAfterMs ? { UNIWORK_SYNC_TEST_STUCK_AFTER_MS: String(stuckAfterMs) } : {}),
    ...(recheckMs ? { UNIWORK_SYNC_TEST_RECHECK_MS: String(recheckMs) } : {}),
    ...(display ? { DISPLAY: display } : {}),
    ...(xauthority ? { XAUTHORITY: xauthority } : {}),
  };
}

/** Value of KEY in a `KEY='value'` / `KEY=value` env file text (server.env, ports.env). */
export function envFileValue(text, key) {
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at <= 0 || line.slice(0, at).trim() !== key) continue;
    let value = line.slice(at + 1).trim();
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/'\\''/g, "'");
    return value;
  }
  return "";
}

/** `pid ppid` lines (ps -eo pid=,ppid=) -> every descendant of `root`, deepest last. */
export function descendantPids(psText, root) {
  const children = new Map();
  for (const line of String(psText ?? "").split(/\r?\n/)) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const out = [];
  const queue = [Number(root)];
  while (queue.length) {
    for (const child of children.get(queue.shift()) ?? []) {
      if (!out.includes(child)) {
        out.push(child);
        queue.push(child);
      }
    }
  }
  return out;
}
