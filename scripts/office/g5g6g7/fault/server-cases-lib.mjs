// Pure logic and injectable case drivers for G7-03a server-layer fault cases (UNI-1380).

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripQuery, validateRules } from "./rules.mjs";
import { describeResponse, errorCodeOf, revisionGreater } from "./server-cases-wire.mjs";

const THIS_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
export const REPO_ROOT = resolve(THIS_DIR, "..", "..", "..", "..");
export const DEFAULT_CASES_PATH = resolve(REPO_ROOT, "docs", "office", "g5g6g7", "fault", "cases.json");
export const BLOCKED_EXIT_CODE = 77;

export function loadFaultCases(casesPath = DEFAULT_CASES_PATH) {
  return JSON.parse(readFileSync(casesPath, "utf8"));
}

export function selectServerCases(casesDoc, { caseId } = {}) {
  const allCases = Array.isArray(casesDoc?.cases) ? casesDoc.cases : [];
  const serverReady = allCases.filter((row) => row.layer === "server" && row.status === "ready");
  if (!caseId) return serverReady;
  const target = String(caseId).trim();
  const match = serverReady.find((row) => row.id === target);
  if (!match) throw new Error(`unknown or non-ready server fault case "${target}"`);
  return [match];
}

function escapeRegexLiteral(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveExitLookup(caseRow, { exit, exitIndex } = {}) {
  const chosen = exit ?? (Array.isArray(caseRow?.exits) ? caseRow.exits[exitIndex ?? 0] : null);
  const lookup = chosen?.lookup;
  if (!lookup || !Number.isInteger(lookup.code) || typeof lookup.errorCode !== "string" || !lookup.errorCode) {
    throw new Error(`case ${caseRow?.id ?? "(unknown)"} rule requires per-exit lookup { code, errorCode }`);
  }
  return lookup;
}

export function renderCaseRules(caseRow, { documentId, exit, exitIndex } = {}) {
  const rawRules = Array.isArray(caseRow?.proxyRules) ? caseRow.proxyRules : [];
  const rendered = rawRules.map((rule) => {
    const rawMatch = rule?.match ?? {};
    let pathPattern = String(rawMatch.path ?? "");
    if (documentId) {
      const escapedDocId = escapeRegexLiteral(documentId);
      pathPattern = pathPattern.replaceAll("<id>", escapedDocId).replaceAll("<documentId>", escapedDocId);
    }
    const match = {
      ...(rawMatch.method ? { method: String(rawMatch.method).toUpperCase() } : {}),
      path: pathPattern,
      ...(rawMatch.nth !== undefined && rawMatch.nth !== null ? { nth: rawMatch.nth } : {}),
    };
    const rawAction = rule?.action ?? {};
    let action;
    if (rawAction.type === "status" && rawAction.code === "per-exit") {
      const lookup = resolveExitLookup(caseRow, { exit, exitIndex });
      action = {
        type: "status",
        code: lookup.code,
        body: { error: { code: lookup.errorCode, ...(lookup.fields ? { fields: lookup.fields } : {}) } },
      };
    } else {
      action = {
        type: rawAction.type,
        ...(rawAction.ms !== undefined ? { ms: rawAction.ms } : {}),
        ...(rawAction.code !== undefined ? { code: rawAction.code } : {}),
        ...(rawAction.body !== undefined ? { body: structuredClone(rawAction.body) } : {}),
        ...(rawAction.until !== undefined ? { until: rawAction.until } : {}),
      };
    }
    return {
      id: rule.id,
      match,
      action,
      ...(rule.once !== undefined ? { once: Boolean(rule.once) } : {}),
    };
  });
  validateRules(rendered);
  return rendered;
}

export function computeKeyTag(rawKey, salt = "fault-driver-salt") {
  if (!rawKey || typeof rawKey !== "string" || !rawKey.trim()) return null;
  return crypto.createHmac("sha256", salt).update(rawKey.trim()).digest("hex").slice(0, 12);
}

export function buildIntentLogEntry({
  caseId,
  step,
  intent = "intent-1",
  keyTag = null,
  attempt = 1,
  from = null,
  to = null,
  event = step,
  status = null,
  outcome = null,
  reason = null,
  http = null,
  note = null,
  ts = new Date().toISOString(),
}) {
  return {
    ts,
    case: caseId,
    source: "driver",
    step,
    intent,
    keyTag: keyTag ?? null,
    attempt,
    from,
    to,
    event,
    status,
    outcome,
    reason,
    http: http
      ? {
          method: String(http.method || "GET").toUpperCase(),
          path: stripQuery(http.path || "/"),
          status: http.status ?? null,
          code: http.code ?? null,
        }
      : null,
    note,
  };
}

export function assertion(name, expected, actual, ok) {
  return { name, expected, actual, ok: Boolean(ok) };
}

export function evaluateCaseResult({ caseId, ac = [], assertions = [], blockedReason = null }) {
  if (blockedReason) {
    return { case: caseId, ac: [...ac], result: "BLOCKED", blocker: String(blockedReason), assertions };
  }
  const allOk = assertions.length > 0 && assertions.every((item) => item.ok === true);
  return { case: caseId, ac: [...ac], result: allOk ? "PASS" : "FAIL", assertions };
}

export function aggregateExitCode(caseResults = []) {
  if (!Array.isArray(caseResults) || caseResults.length === 0) return BLOCKED_EXIT_CODE;
  const statuses = caseResults.map((item) => item?.result);
  if (statuses.includes("FAIL")) return 1;
  if (statuses.every((s) => s === "PASS")) return 0;
  return BLOCKED_EXIT_CODE;
}

const commitPostsInLog = (log) => log.filter((e) => e.method === "POST" && /\/versions\/commit$/.test(e.path));
const commitGetsInLog = (log) => log.filter((e) => e.method === "GET" && /\/versions\/commit$/.test(e.path));
const uploadPostsInLog = (log) => log.filter((e) => e.method === "POST" && /\/uploads$/.test(e.path));

export async function runServerCaseDriver(caseRow, ctx) {
  const id = caseRow.id;
  const docId = ctx.document.id;
  const r0 = String(ctx.document.revision);
  const intentLog = [];
  const assertions = [];
  const recordStep = (fields) => {
    const entry = buildIntentLogEntry({ caseId: id, ...fields });
    intentLog.push(entry);
    return entry;
  };

  if (id === "FQ-01") {
    const upKey = ctx.newKey("up-fq01");
    const k1 = ctx.newKey("commit-fq01");
    const up = await ctx.uploadViaProxy("deviceA", docId, { idempotencyKey: upKey, label: "v2" });
    recordStep({ step: "upload", keyTag: ctx.keyTag(upKey), status: up.status, outcome: up.ok ? "staged" : "error" });
    const c1 = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "commit_1", keyTag: ctx.keyTag(k1), attempt: 1, status: c1.status, outcome: c1.dropped ? "dropped" : "answered" });
    const look = await ctx.lookupViaProxy("deviceA", docId, { idempotencyKey: k1 });
    recordStep({ step: "lookup", keyTag: ctx.keyTag(k1), attempt: 1, status: look.status, outcome: look.body?.outcome ?? null });
    const c2 = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "commit_replay", keyTag: ctx.keyTag(k1), attempt: 2, status: c2.status, outcome: "replayed" });
    const finish = await ctx.collectCaseEnd(docId);
    const postLogs = commitPostsInLog(finish.proxyLog);
    const allCommitTags = [...postLogs, ...commitGetsInLog(finish.proxyLog)].map((e) => e.keyTag).filter(Boolean);
    assertions.push(
      assertion("upload_201", 201, up.status, up.status === 201),
      assertion("commit_1_dropped", "dropped", c1.dropped ? "dropped" : c1.status, Boolean(c1.dropped)),
      assertion("lookup_200_committed", "200:committed", describeResponse(look), look.status === 200 && look.body?.outcome === "committed" && Boolean(look.body?.version_id)),
      assertion("replay_200_same_version", look.body?.version_id ?? "ver", c2.body?.version?.id ?? null, c2.status === 200 && Boolean(look.body?.version_id) && c2.body?.version?.id === look.body?.version_id),
      assertion("version_delta", 1, finish.versionDelta, finish.versionDelta === 1),
      assertion("proxy_log_same_key_tag", "1 tag across 2 POST + 1 GET", `${new Set(allCommitTags).size} tag(s) across ${postLogs.length} POST`, postLogs.length === 2 && postLogs[0].status === "dropped" && postLogs[1].status === 200 && new Set(allCommitTags).size === 1),
    );
    return { assertions, intentLog, ...finish };
  }

  if (id === "FQ-02") {
    const upKey = ctx.newKey("up-fq02");
    const k1 = ctx.newKey("commit-fq02");
    const up = await ctx.uploadViaProxy("deviceA", docId, { idempotencyKey: upKey, label: "v2" });
    const c1 = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "commit_1_dropped", keyTag: ctx.keyTag(k1), attempt: 1, status: c1.status, outcome: c1.dropped ? "dropped" : "answered" });
    const look = await ctx.lookupViaProxy("deviceA", docId, { idempotencyKey: k1 });
    const lookOutcome = look.body?.error?.fields?.outcome ?? look.body?.outcome ?? null;
    recordStep({ step: "lookup_unknown", keyTag: ctx.keyTag(k1), attempt: 1, status: look.status, outcome: lookOutcome });
    const c2 = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "commit_retry", keyTag: ctx.keyTag(k1), attempt: 2, status: c2.status, outcome: c2.status === 200 ? "committed" : "error" });
    const finish = await ctx.collectCaseEnd(docId);
    const postLogs = commitPostsInLog(finish.proxyLog);
    const tags = new Set(postLogs.map((e) => e.keyTag).filter(Boolean));
    assertions.push(
      assertion("commit_1_dropped", "dropped", c1.dropped ? "dropped" : c1.status, Boolean(c1.dropped)),
      assertion("lookup_410_commit_intent_unknown", "410:commit_intent_unknown:unknown", `${look.status}:${errorCodeOf(look.body)}:${lookOutcome}`, look.status === 410 && errorCodeOf(look.body) === "commit_intent_unknown" && lookOutcome === "unknown"),
      assertion("retry_commit_200", 200, c2.status, c2.status === 200),
      assertion("version_delta", 1, finish.versionDelta, finish.versionDelta === 1),
      assertion("proxy_log", "dropped then 200 with 1 keyTag", `${postLogs.map((e) => e.status).join(",")} (${tags.size} tag)`, postLogs.length === 2 && postLogs[0].status === "dropped" && postLogs[1].status === 200 && tags.size === 1),
    );
    return { assertions, intentLog, ...finish };
  }

  if (id === "FQ-03") {
    const upKey = ctx.newKey("up-fq03");
    const k1 = ctx.newKey("commit-fq03");
    const up = await ctx.uploadViaProxy("deviceA", docId, { idempotencyKey: upKey, label: "v2" });
    const p1 = ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up.body?.upload_id, baseRevision: r0 });
    await ctx.sleep(25);
    const p2 = ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up.body?.upload_id, baseRevision: r0 });
    const [c1, c2] = await Promise.all([p1, p2]);
    recordStep({ step: "commit_concurrent_1", keyTag: ctx.keyTag(k1), attempt: 1, status: c1.status, outcome: errorCodeOf(c1.body) ?? "ok" });
    recordStep({ step: "commit_concurrent_2", keyTag: ctx.keyTag(k1), attempt: 2, status: c2.status, outcome: errorCodeOf(c2.body) ?? "ok" });
    const look = await ctx.lookupViaProxy("deviceA", docId, { idempotencyKey: k1 });
    recordStep({ step: "lookup", keyTag: ctx.keyTag(k1), status: look.status, outcome: look.body?.outcome ?? null });
    const finish = await ctx.collectCaseEnd(docId);
    const both200SameVer = c1.status === 200 && c2.status === 200 && Boolean(c1.body?.version?.id) && c1.body?.version?.id === c2.body?.version?.id;
    const one200One409 =
      (c1.status === 200 && c2.status === 409 && errorCodeOf(c2.body) === "idempotency_in_flight") ||
      (c2.status === 200 && c1.status === 409 && errorCodeOf(c1.body) === "idempotency_in_flight");
    const postLogs = commitPostsInLog(finish.proxyLog);
    const tags = new Set(postLogs.map((e) => e.keyTag).filter(Boolean));
    assertions.push(
      assertion("concurrent_statuses", "2x200(same version) or 200+409(idempotency_in_flight)", `${c1.status}+${c2.status}`, both200SameVer || one200One409),
      assertion("lookup_200_committed", "200:committed", describeResponse(look), look.status === 200 && look.body?.outcome === "committed"),
      assertion("version_delta", 1, finish.versionDelta, finish.versionDelta === 1),
      assertion("proxy_log", "2 POST commit same keyTag", `${postLogs.length} POST (${tags.size} tag)`, postLogs.length === 2 && tags.size === 1),
    );
    return { assertions, intentLog, ...finish };
  }

  if (id === "FQ-04") {
    const upKey = ctx.newKey("up-fq04");
    const k1 = ctx.newKey("commit-fq04");
    const up = await ctx.uploadViaProxy("deviceA", docId, { idempotencyKey: upKey, label: "v2" });
    const c1 = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "commit_1_503", keyTag: ctx.keyTag(k1), attempt: 1, status: c1.status, outcome: "synthetic_503" });
    const c2 = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "commit_2_retry", keyTag: ctx.keyTag(k1), attempt: 2, status: c2.status, outcome: c2.status === 200 ? "committed" : "error" });
    const look = await ctx.lookupViaProxy("deviceA", docId, { idempotencyKey: k1 });
    recordStep({ step: "lookup", keyTag: ctx.keyTag(k1), status: look.status, outcome: look.body?.outcome ?? null });
    const finish = await ctx.collectCaseEnd(docId);
    const postLogs = commitPostsInLog(finish.proxyLog);
    const tags = new Set(postLogs.map((e) => e.keyTag).filter(Boolean));
    assertions.push(
      assertion("commit_1_503", 503, c1.status, c1.status === 503),
      assertion("commit_2_200", 200, c2.status, c2.status === 200),
      assertion("lookup_200_committed", "200:committed", describeResponse(look), look.status === 200 && look.body?.outcome === "committed"),
      assertion("version_delta", 1, finish.versionDelta, finish.versionDelta === 1),
      assertion("proxy_log", "synthetic then 200 same keyTag", `${postLogs.map((e) => e.status).join(",")} (${tags.size} tag)`, postLogs.length === 2 && postLogs[0].status === "synthetic" && postLogs[1].status === 200 && tags.size === 1),
    );
    return { assertions, intentLog, ...finish };
  }

  if (id === "FQ-05") {
    const upKey = ctx.newKey("up-fq05");
    const k1 = ctx.newKey("commit-fq05");
    const up1 = await ctx.uploadViaProxy("deviceA", docId, { idempotencyKey: upKey, label: "v2" });
    recordStep({ step: "upload_1_dropped", keyTag: ctx.keyTag(upKey), attempt: 1, status: up1.status, outcome: up1.dropped ? "dropped" : "answered" });
    const up2 = await ctx.uploadViaProxy("deviceA", docId, { idempotencyKey: upKey, label: "v2" });
    recordStep({ step: "upload_2_retry", keyTag: ctx.keyTag(upKey), attempt: 2, status: up2.status, outcome: up2.status === 201 ? "staged" : "error" });
    const c1 = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up2.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "commit", keyTag: ctx.keyTag(k1), attempt: 1, status: c1.status, outcome: c1.status === 200 ? "committed" : "error" });
    const finish = await ctx.collectCaseEnd(docId);
    const upLogs = uploadPostsInLog(finish.proxyLog);
    const upTags = new Set(upLogs.map((e) => e.keyTag).filter(Boolean));
    const postLogs = commitPostsInLog(finish.proxyLog);
    assertions.push(
      assertion("upload_1_dropped", "dropped", up1.dropped ? "dropped" : up1.status, Boolean(up1.dropped)),
      assertion("upload_2_201", 201, up2.status, up2.status === 201 && Boolean(up2.body?.upload_id)),
      assertion("commit_200", 200, c1.status, c1.status === 200),
      assertion("version_delta", 1, finish.versionDelta, finish.versionDelta === 1),
      assertion("proxy_log", "2 uploads(1 tag) + 1 commit", `${upLogs.length} uploads(${upTags.size} tag) + ${postLogs.length} commit`, upLogs.length === 2 && upLogs[0].status === "dropped" && upLogs[1].status === 201 && upTags.size === 1 && postLogs.length === 1),
    );
    return { assertions, intentLog, ...finish };
  }

  if (id === "FQ-06") {
    const upKey = ctx.newKey("up-fq06");
    const k1 = ctx.newKey("commit-fq06");
    const up = await ctx.uploadViaProxy("deviceA", docId, { idempotencyKey: upKey, label: "v2" });
    const abortCtrl = new AbortController();
    const heldCommitPromise = ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up.body?.upload_id, baseRevision: r0, signal: abortCtrl.signal });
    await ctx.waitForRuleHeld("hold-commit");
    abortCtrl.abort();
    const c1 = await heldCommitPromise;
    recordStep({ step: "commit_aborted_while_held", keyTag: ctx.keyTag(k1), attempt: 1, status: c1.status, outcome: "aborted" });
    const rel = await ctx.releaseRule("hold-commit");
    await ctx.waitForProxyLogCount((e) => e.method === "POST" && /\/versions\/commit$/.test(e.path), 1);
    const look = await ctx.lookupViaProxy("deviceA", docId, { idempotencyKey: k1 });
    recordStep({ step: "lookup_after_release", keyTag: ctx.keyTag(k1), status: look.status, outcome: look.body?.outcome ?? null });
    const finish = await ctx.collectCaseEnd(docId);
    const postLogs = commitPostsInLog(finish.proxyLog);
    const getLogs = commitGetsInLog(finish.proxyLog);
    const allTags = new Set([...postLogs, ...getLogs].map((e) => e.keyTag).filter(Boolean));
    assertions.push(
      assertion("client_aborted_while_held", true, Boolean(c1.aborted || c1.dropped), Boolean(c1.aborted || c1.dropped)),
      assertion("release_hold_commit", 1, rel?.released ?? 0, (rel?.released ?? 0) >= 1),
      assertion("lookup_200_committed", "200:committed", describeResponse(look), look.status === 200 && look.body?.outcome === "committed"),
      assertion("version_delta", 1, finish.versionDelta, finish.versionDelta === 1),
      assertion("proxy_log_single_post_same_key", "1 POST + 1 GET (1 keyTag)", `${postLogs.length} POST + ${getLogs.length} GET (${allTags.size} tag)`, postLogs.length === 1 && getLogs.length >= 1 && allTags.size === 1),
    );
    return { assertions, intentLog, ...finish };
  }

  return runServerCaseDriverPart2(caseRow, ctx, { docId, r0, intentLog, assertions, recordStep });
}

async function runServerCaseDriverPart2(caseRow, ctx, { docId, r0, intentLog, assertions, recordStep }) {
  const id = caseRow.id;

  if (id === "FQ-07") {
    const upKeyA = ctx.newKey("up-fq07-a");
    const k1 = ctx.newKey("commit-fq07-a");
    const upA = await ctx.uploadViaProxy("deviceA", docId, { idempotencyKey: upKeyA, label: "a-v2" });
    const heldPromise = ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: upA.body?.upload_id, baseRevision: r0 });
    await ctx.waitForRuleHeld("hold-a");
    const bCommit = await ctx.uploadAndCommitDirect("deviceB", docId, { baseRevision: r0, label: "b-v2" });
    const rB = String(bCommit.body?.document?.revision ?? "");
    await ctx.releaseRule("hold-a");
    const cA = await heldPromise;
    recordStep({ step: "commit_a_after_b", keyTag: ctx.keyTag(k1), attempt: 1, status: cA.status, outcome: errorCodeOf(cA.body) });
    const look = await ctx.lookupViaProxy("deviceA", docId, { idempotencyKey: k1 });
    recordStep({ step: "lookup_a", keyTag: ctx.keyTag(k1), status: look.status, outcome: look.body?.outcome ?? null });
    const finish = await ctx.collectCaseEnd(docId);
    const conflictRev = String(cA.body?.error?.fields?.current_revision ?? "");
    const postLogs = commitPostsInLog(finish.proxyLog);
    const getLogs = commitGetsInLog(finish.proxyLog);
    const tags = new Set([...postLogs, ...getLogs].map((e) => e.keyTag).filter(Boolean));
    assertions.push(
      assertion("device_b_commit_200", 200, bCommit.status, bCommit.status === 200 && Boolean(rB)),
      assertion("device_a_commit_409_conflict", `409:document_version_conflict:${rB}`, `${cA.status}:${errorCodeOf(cA.body)}:${conflictRev}`, cA.status === 409 && errorCodeOf(cA.body) === "document_version_conflict" && conflictRev === rB),
      assertion("lookup_200_not_committed", "200:not_committed", describeResponse(look), look.status === 200 && look.body?.outcome === "not_committed"),
      assertion("version_delta", 1, finish.versionDelta, finish.versionDelta === 1),
      assertion("proxy_log", "1 POST + 1 GET same keyTag", `${postLogs.length} POST + ${getLogs.length} GET (${tags.size} tag)`, postLogs.length === 1 && getLogs.length === 1 && tags.size === 1),
    );
    return { assertions, intentLog, ...finish };
  }

  if (id === "FQ-08") {
    const upKeyA = ctx.newKey("up-fq08-a");
    const upKeyB = ctx.newKey("up-fq08-b");
    const kB = ctx.newKey("commit-fq08-b");
    const kA1 = ctx.newKey("commit-fq08-a1");
    const kA2 = ctx.newKey("commit-fq08-a2");
    const upA = await ctx.uploadViaProxy("deviceA", docId, { idempotencyKey: upKeyA, label: "a-copy" });
    const checksumA = upA.body?.checksum_sha256;
    const upB = await ctx.uploadDirect("deviceB", docId, { idempotencyKey: upKeyB, label: "b-copy" });
    const cB = await ctx.commitViaProxy("deviceB", docId, { idempotencyKey: kB, uploadId: upB.body?.upload_id, baseRevision: r0 });
    const r1 = String(cB.body?.document?.revision ?? "");
    const cA1 = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: kA1, uploadId: upA.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "commit_a_conflict", keyTag: ctx.keyTag(kA1), attempt: 1, status: cA1.status, outcome: errorCodeOf(cA1.body) });
    const head = await ctx.getDocumentViaProxy("deviceA", docId);
    const headRev = String(head.body?.document?.revision ?? r1);
    const cA2 = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: kA2, uploadId: upA.body?.upload_id, baseRevision: headRev });
    recordStep({ step: "commit_a_overwrite_reuse_upload", keyTag: ctx.keyTag(kA2), attempt: 2, status: cA2.status, outcome: cA2.status === 200 ? "committed" : "error" });
    const finish = await ctx.collectCaseEnd(docId);
    const postLogs = commitPostsInLog(finish.proxyLog);
    const aTags = new Set([postLogs[1]?.keyTag, postLogs[2]?.keyTag].filter(Boolean));
    assertions.push(
      assertion("device_b_commit_200", 200, cB.status, cB.status === 200),
      assertion("device_a_first_commit_409", "409:document_version_conflict", `${cA1.status}:${errorCodeOf(cA1.body)}`, cA1.status === 409 && errorCodeOf(cA1.body) === "document_version_conflict"),
      assertion("device_a_overwrite_200", 200, cA2.status, cA2.status === 200),
      assertion("checksum_matches_a_upload", checksumA, cA2.body?.version?.checksum_sha256 ?? null, Boolean(checksumA) && cA2.body?.version?.checksum_sha256 === checksumA),
      assertion("version_delta", 2, finish.versionDelta, finish.versionDelta === 2),
      assertion("proxy_log_3_commits_2_a_keys", "3 POST commit, 2 distinct A keyTags", `${postLogs.length} POST, ${aTags.size} A tags`, postLogs.length === 3 && aTags.size === 2),
    );
    return { assertions, intentLog, ...finish };
  }

  if (id === "FQ-09") {
    await ctx.uploadAndCommitDirect("deviceB", docId, { baseRevision: r0, label: "b-v2" });
    const upKeyA = ctx.newKey("up-fq09-a");
    const k1 = ctx.newKey("commit-fq09-a");
    const upA = await ctx.uploadViaProxy("deviceA", docId, { idempotencyKey: upKeyA, label: "a-v2" });
    const cA = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: upA.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "commit_409", keyTag: ctx.keyTag(k1), attempt: 1, status: cA.status, outcome: errorCodeOf(cA.body) });
    const look = await ctx.lookupViaProxy("deviceA", docId, { idempotencyKey: k1 });
    recordStep({ step: "lookup_not_committed", keyTag: ctx.keyTag(k1), status: look.status, outcome: look.body?.outcome ?? null });
    const finish = await ctx.collectCaseEnd(docId);
    const postLogs = commitPostsInLog(finish.proxyLog);
    const getLogs = commitGetsInLog(finish.proxyLog);
    const tags = new Set([...postLogs, ...getLogs].map((e) => e.keyTag).filter(Boolean));
    assertions.push(
      assertion("commit_409_conflict", "409:document_version_conflict", `${cA.status}:${errorCodeOf(cA.body)}`, cA.status === 409 && errorCodeOf(cA.body) === "document_version_conflict"),
      assertion("lookup_200_not_committed", "200:not_committed", describeResponse(look), look.status === 200 && look.body?.outcome === "not_committed"),
      assertion("version_delta", 1, finish.versionDelta, finish.versionDelta === 1),
      assertion("proxy_log", "1 POST + 1 GET same keyTag", `${postLogs.length} POST + ${getLogs.length} GET (${tags.size} tag)`, postLogs.length === 1 && getLogs.length === 1 && tags.size === 1),
    );
    return { assertions, intentLog, ...finish };
  }

  if (id === "FQ-10") {
    const kA = await ctx.seedFailedIntentDirect("deviceA", docId);
    const kNever = ctx.newKey("never-sent-fq10");
    const lookOther = await ctx.lookupViaProxy("memberB", docId, { idempotencyKey: kA });
    recordStep({ step: "lookup_foreign_member", keyTag: ctx.keyTag(kA), status: lookOther.status, outcome: errorCodeOf(lookOther.body) });
    const lookNever = await ctx.lookupViaProxy("deviceA", docId, { idempotencyKey: kNever });
    recordStep({ step: "lookup_never_sent", keyTag: ctx.keyTag(kNever), status: lookNever.status, outcome: errorCodeOf(lookNever.body) });
    const finish = await ctx.collectCaseEnd(docId);
    const getLogs = commitGetsInLog(finish.proxyLog);
    const noLeak = (res) => res.body?.version === undefined && res.body?.revision === undefined && res.body?.version_id === undefined;
    assertions.push(
      assertion("foreign_member_lookup_410", "410:commit_intent_unknown", `${lookOther.status}:${errorCodeOf(lookOther.body)}`, lookOther.status === 410 && errorCodeOf(lookOther.body) === "commit_intent_unknown" && noLeak(lookOther)),
      assertion("never_sent_lookup_410", "410:commit_intent_unknown", `${lookNever.status}:${errorCodeOf(lookNever.body)}`, lookNever.status === 410 && errorCodeOf(lookNever.body) === "commit_intent_unknown" && noLeak(lookNever)),
      assertion("version_delta", 0, finish.versionDelta, finish.versionDelta === 0),
      assertion("proxy_log_2_gets_410", "2 GET -> 410", `${getLogs.length} GET (${getLogs.map((e) => e.status).join(",")})`, getLogs.length === 2 && getLogs.every((e) => e.status === 410)),
    );
    return { assertions, intentLog, ...finish };
  }

  if (id === "FQ-11") {
    const t1 = await ctx.aiTurnViaProxy("deviceA", docId, { prompt: "Tóm tắt mục 1" });
    const convId = t1.conversationId || "";
    recordStep({ step: "ai_turn_1", status: t1.status, outcome: t1.status === 200 ? "answered" : errorCodeOf(t1.body) });
    const t2 = await ctx.aiTurnViaProxy("deviceA", docId, { prompt: "Viết tiếp mục 2", conversationId: convId });
    recordStep({ step: "ai_turn_2", status: t2.status, outcome: t2.status === 200 ? "answered" : errorCodeOf(t2.body) });
    const midVersions = await ctx.collectVersions(docId);
    const midDelta = midVersions.versions.length - ctx.beforeCount;
    const up = await ctx.uploadViaProxy("deviceA", docId, { idempotencyKey: ctx.newKey("up-fq11"), label: "after-ai" });
    const k1 = ctx.newKey("commit-fq11");
    const c1 = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "save_after_ai", keyTag: ctx.keyTag(k1), status: c1.status, outcome: c1.status === 200 ? "committed" : errorCodeOf(c1.body) });
    const finish = await ctx.collectCaseEnd(docId);
    const aiLogs = finish.proxyLog.filter((e) => e.method === "POST" && /\/ai\/uniwork\/chat\/completions$/.test(e.path));
    assertions.push(
      assertion("ai_turn_1_200", 200, t1.status, t1.status === 200 && Boolean(convId)),
      assertion("ai_turn_2_200", 200, t2.status, t2.status === 200),
      assertion("zero_versions_during_ai", 0, midDelta, midDelta === 0),
      assertion("save_after_ai_200", "201+200", `${up.status}+${c1.status}`, up.status === 201 && c1.status === 200),
      assertion("version_delta", 1, finish.versionDelta, finish.versionDelta === 1),
      assertion("proxy_log_ai_then_save", "2 AI POST + 1 upload + 1 commit", `${aiLogs.length} AI`, aiLogs.length === 2 && uploadPostsInLog(finish.proxyLog).length === 1 && commitPostsInLog(finish.proxyLog).length === 1),
    );
    return { assertions, intentLog, ...finish };
  }

  if (id === "FQ-12") {
    const upPre = await ctx.uploadDirect("memberB", docId, { idempotencyKey: ctx.newKey("up-fq12"), label: "member-draft" });
    const t1 = await ctx.aiTurnViaProxy("memberB", docId, { prompt: "Mở đầu báo cáo" });
    const convId = t1.conversationId || "";
    recordStep({ step: "ai_turn_1", status: t1.status, outcome: t1.status === 200 ? "answered" : errorCodeOf(t1.body) });
    const rev = await ctx.removeWorkspaceMemberDirect("memberB");
    const t2 = await ctx.aiTurnViaProxy("memberB", docId, { prompt: "Tiếp tục sau thu hồi", conversationId: convId });
    recordStep({ step: "ai_turn_2_after_revoke", status: t2.status, outcome: errorCodeOf(t2.body) });
    const k1 = ctx.newKey("commit-fq12");
    const c1 = await ctx.commitViaProxy("memberB", docId, { idempotencyKey: k1, uploadId: upPre.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "commit_after_revoke", keyTag: ctx.keyTag(k1), status: c1.status, outcome: errorCodeOf(c1.body) });
    const finish = await ctx.collectCaseEnd(docId);
    assertions.push(
      assertion("ai_turn_1_200", 200, t1.status, t1.status === 200),
      assertion("revoke_member_204", 204, rev.status, rev.status === 204),
      assertion("ai_turn_2_refused_403_404", "403|404", t2.status, t2.status === 403 || t2.status === 404),
      assertion("commit_refused_403_404", "403|404", c1.status, c1.status === 403 || c1.status === 404),
      assertion("version_delta", 0, finish.versionDelta, finish.versionDelta === 0),
    );
    return { assertions, intentLog, ...finish };
  }

  if (id === "FQ-13") {
    const upKey = ctx.newKey("up-fq13");
    const k1 = ctx.newKey("commit-fq13");
    const up = await ctx.uploadViaProxy("deviceA", docId, { idempotencyKey: upKey, label: "v2" });
    await ctx.archiveDocumentDirect(docId);
    const c1 = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "commit_while_archived", keyTag: ctx.keyTag(k1), attempt: 1, status: c1.status, outcome: errorCodeOf(c1.body) });
    const restored = await ctx.restoreAndMoveDocumentDirect(docId);
    const c2 = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "commit_after_restore_and_move", keyTag: ctx.keyTag(k1), attempt: 2, status: c2.status, outcome: c2.status === 200 ? "committed" : errorCodeOf(c2.body) });
    const finish = await ctx.collectCaseEnd(docId);
    const postLogs = commitPostsInLog(finish.proxyLog);
    const tags = new Set(postLogs.map((e) => e.keyTag).filter(Boolean));
    assertions.push(
      assertion("commit_while_archived_410", "410:document_deleted", `${c1.status}:${errorCodeOf(c1.body)}`, c1.status === 410 && errorCodeOf(c1.body) === "document_deleted"),
      assertion("restore_move_bumped_revision", `>${r0}`, String(restored.revision ?? ""), typeof restored.revision === "string" && revisionGreater(restored.revision, r0)),
      assertion("commit_after_restore_move_200", 200, c2.status, c2.status === 200),
      assertion("version_delta", 1, finish.versionDelta, finish.versionDelta === 1),
      assertion("proxy_log_2_commits_same_key", "2 POST commit (1 keyTag)", `${postLogs.length} POST (${tags.size} tag)`, postLogs.length === 2 && tags.size === 1),
    );
    return { assertions, intentLog, ...finish };
  }

  throw new Error(`unsupported server case id "${id}"`);
}
