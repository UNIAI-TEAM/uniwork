// Injectable case drivers of the G7-03a server-layer fault cases (UNI-1380, FQ-01..FQ-13).
// A driver acts on the `ctx` server-cases.mjs builds (a real transport, or the
// fake of server-cases.test.mjs) and returns `{assertions, intentLog, ...finish}`.
// Every number or status a driver compares comes from the row's `expect` in
// cases.json (`caseExpect`, review r1 R1-2); a driver holds the scenario, the
// row holds the expectation, and server-cases.test.mjs mutates each expected
// value to prove the assertion that reads it fails.

import { caseExpect, compareMeasure, lookupOutcomeOf, statusMatches } from "./case-expect.mjs";
import { assertion, buildIntentLogEntry } from "./server-cases-lib.mjs";
import { errorCodeOf, revisionGreater } from "./server-cases-wire.mjs";

const commitPostsInLog = (log) => log.filter((e) => e.method === "POST" && /\/versions\/commit$/.test(e.path));
const commitGetsInLog = (log) => log.filter((e) => e.method === "GET" && /\/versions\/commit$/.test(e.path));
const uploadPostsInLog = (log) => log.filter((e) => e.method === "POST" && /\/uploads$/.test(e.path));
const aiPostsInLog = (log) => log.filter((e) => e.method === "POST" && /\/ai\/uniwork\/chat\/completions$/.test(e.path));
const tagCount = (entries) => new Set(entries.map((e) => e.keyTag).filter(Boolean)).size;
const statusesOf = (entries) => entries.map((e) => e.status);

/** What each `expect.proxyLog` key measures on a case's proxy log (case-expect.mjs PROXY_LOG_KEYS, server rows). */
const SERVER_MEASURES = {
  commitPosts: (log) => commitPostsInLog(log).length,
  commitPostStatuses: (log) => statusesOf(commitPostsInLog(log)),
  commitLookups: (log) => commitGetsInLog(log).length,
  commitLookupsMin: (log) => commitGetsInLog(log).length,
  commitLookupStatuses: (log) => statusesOf(commitGetsInLog(log)),
  uploadPosts: (log) => uploadPostsInLog(log).length,
  uploadPostStatuses: (log) => statusesOf(uploadPostsInLog(log)),
  aiPosts: (log) => aiPostsInLog(log).length,
  // one logical key over every commit POST and lookup of the case
  keyTags: (log) => tagCount([...commitPostsInLog(log), ...commitGetsInLog(log)]),
  uploadKeyTags: (log) => tagCount(uploadPostsInLog(log)),
  // device A's two commits of FQ-08 are the 2nd and 3rd POST (device B's goes through the proxy first)
  aKeyTags: (log) => tagCount(commitPostsInLog(log).slice(1, 3)),
  commitPostsSucceeded: (log) => commitPostsInLog(log).filter((e) => e.status === 200).length,
};

/**
 * Asserts EVERY `expect.proxyLog` key of the row against the case's proxy log,
 * one assertion per measure named `proxy_log.<key>`, so a FAIL names the
 * measure that failed (review r2 R2-4). A row with no key fails: nothing was held.
 */
function proxyLogAssertions(X, log) {
  if (X.proxyKeys().length === 0) return [assertion("proxy_log", "at least one expect.proxyLog key", "none", false)];
  return X.proxyKeys().map((key) => {
    const measure = SERVER_MEASURES[key];
    if (!measure) throw new Error(`expect.proxyLog.${key} has no server measure`);
    const expected = X.proxy(key);
    const actual = measure(log);
    return assertion(`proxy_log.${key}`, expected, actual, compareMeasure(key, expected, actual));
  });
}

const versionDeltaAssertion = (X, finish) => assertion("version_delta", X.versionDelta(), finish.versionDelta, finish.versionDelta === X.versionDelta());
const answered = (res) => (res.dropped ? "dropped" : res.status);
const statusAssertion = (name, expected, actual, extra = true) => assertion(name, expected, actual, statusMatches(expected, actual) && extra);

/** A lookup answer against `expect.server.lookup`: status, outcome (200 body or 410 fields) and error code. */
function lookupAssertion(name, X, res, extra = true) {
  const want = X.lookup();
  const code = errorCodeOf(res.body);
  const outcome = lookupOutcomeOf(res);
  const label = (status, errorCode, out) => [status, errorCode, out].filter((part) => part !== undefined && part !== null && part !== "").join(":");
  const ok = res.status === want.status && (want.outcome === undefined || outcome === want.outcome) && (want.errorCode === undefined || code === want.errorCode);
  return assertion(name, label(want.status, want.errorCode, want.outcome), label(res.status, code, outcome), ok && extra);
}

export async function runServerCaseDriver(caseRow, ctx) {
  const id = caseRow.id;
  const X = caseExpect(caseRow);
  const docId = ctx.document.id;
  const r0 = String(ctx.document.revision);
  const intentLog = [];
  const assertions = [];
  const recordStep = (fields) => {
    const entry = buildIntentLogEntry({ caseId: id, ...fields });
    intentLog.push(entry);
    return entry;
  };
  const common = { X, docId, r0, intentLog, assertions, recordStep };

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
    assertions.push(
      statusAssertion("upload_201", X.status("upload"), up.status),
      statusAssertion("commit_1_dropped", X.status("commit_1"), answered(c1), Boolean(c1.dropped)),
      lookupAssertion("lookup_200_committed", X, look, Boolean(look.body?.version_id)),
      assertion("replay_200_same_version", look.body?.version_id ?? "ver", c2.body?.version?.id ?? null, statusMatches(X.status("replay"), c2.status) && Boolean(look.body?.version_id) && c2.body?.version?.id === look.body?.version_id),
      versionDeltaAssertion(X, finish),
      ...proxyLogAssertions(X, finish.proxyLog),
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
    recordStep({ step: "lookup_unknown", keyTag: ctx.keyTag(k1), attempt: 1, status: look.status, outcome: lookupOutcomeOf(look) });
    const c2 = await ctx.commitViaProxy("deviceA", docId, { idempotencyKey: k1, uploadId: up.body?.upload_id, baseRevision: r0 });
    recordStep({ step: "commit_retry", keyTag: ctx.keyTag(k1), attempt: 2, status: c2.status, outcome: c2.status === 200 ? "committed" : "error" });
    const finish = await ctx.collectCaseEnd(docId);
    assertions.push(
      statusAssertion("commit_1_dropped", X.status("commit_1"), answered(c1), Boolean(c1.dropped)),
      lookupAssertion("lookup_410_commit_intent_unknown", X, look),
      statusAssertion("retry_commit_200", X.status("retry"), c2.status),
      versionDeltaAssertion(X, finish),
      ...proxyLogAssertions(X, finish.proxyLog),
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
    // the allowed answer pairs (either order) are the row's; two 200s must share a version, a 409 must say idempotency_in_flight
    const pairs = X.status("concurrent");
    const pairOk = pairs.some(([a, b]) => (c1.status === a && c2.status === b) || (c1.status === b && c2.status === a));
    const sameVersion = c1.status !== 200 || c2.status !== 200 || (Boolean(c1.body?.version?.id) && c1.body.version.id === c2.body?.version?.id);
    const inFlight = [c1, c2].filter((c) => c.status === 409).every((c) => errorCodeOf(c.body) === X.errorCode("concurrent"));
    assertions.push(
      assertion("concurrent_statuses", pairs.map((pair) => pair.join("+")).join(" | "), `${c1.status}+${c2.status}`, pairOk && sameVersion && inFlight),
      lookupAssertion("lookup_200_committed", X, look),
      versionDeltaAssertion(X, finish),
      ...proxyLogAssertions(X, finish.proxyLog),
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
    assertions.push(
      statusAssertion("commit_1_503", X.status("commit_1"), c1.status),
      statusAssertion("commit_2_200", X.status("commit_2"), c2.status),
      lookupAssertion("lookup_200_committed", X, look),
      versionDeltaAssertion(X, finish),
      ...proxyLogAssertions(X, finish.proxyLog),
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
    assertions.push(
      statusAssertion("upload_1_dropped", X.status("upload_1"), answered(up1), Boolean(up1.dropped)),
      statusAssertion("upload_2_201", X.status("upload_2"), up2.status, Boolean(up2.body?.upload_id)),
      statusAssertion("commit_200", X.status("commit"), c1.status),
      versionDeltaAssertion(X, finish),
      ...proxyLogAssertions(X, finish.proxyLog),
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
    assertions.push(
      assertion("client_aborted_while_held", true, Boolean(c1.aborted || c1.dropped), Boolean(c1.aborted || c1.dropped)),
      assertion("release_hold_commit", 1, rel?.released ?? 0, (rel?.released ?? 0) >= 1),
      lookupAssertion("lookup_200_committed", X, look),
      versionDeltaAssertion(X, finish),
      ...proxyLogAssertions(X, finish.proxyLog),
    );
    return { assertions, intentLog, ...finish };
  }

  return runServerCaseDriverPart2(caseRow, ctx, common);
}

async function runServerCaseDriverPart2(caseRow, ctx, { X, docId, r0, intentLog, assertions, recordStep }) {
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
    assertions.push(
      statusAssertion("device_b_commit_200", X.status("device_b_commit"), bCommit.status, Boolean(rB)),
      assertion("device_a_commit_409_conflict", `${X.status("device_a_commit")}:${X.errorCode("device_a_commit")}:${rB}`, `${cA.status}:${errorCodeOf(cA.body)}:${conflictRev}`, statusMatches(X.status("device_a_commit"), cA.status) && errorCodeOf(cA.body) === X.errorCode("device_a_commit") && conflictRev === rB),
      lookupAssertion("lookup_200_not_committed", X, look),
      versionDeltaAssertion(X, finish),
      ...proxyLogAssertions(X, finish.proxyLog),
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
    assertions.push(
      statusAssertion("device_b_commit_200", X.status("device_b_commit"), cB.status),
      assertion("device_a_first_commit_409", `${X.status("device_a_first_commit")}:${X.errorCode("device_a_first_commit")}`, `${cA1.status}:${errorCodeOf(cA1.body)}`, statusMatches(X.status("device_a_first_commit"), cA1.status) && errorCodeOf(cA1.body) === X.errorCode("device_a_first_commit")),
      statusAssertion("device_a_overwrite_200", X.status("device_a_overwrite"), cA2.status),
      assertion("checksum_matches_a_upload", checksumA, cA2.body?.version?.checksum_sha256 ?? null, Boolean(checksumA) && cA2.body?.version?.checksum_sha256 === checksumA),
      versionDeltaAssertion(X, finish),
      ...proxyLogAssertions(X, finish.proxyLog),
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
    assertions.push(
      assertion("commit_409_conflict", `${X.status("commit")}:${X.errorCode("commit")}`, `${cA.status}:${errorCodeOf(cA.body)}`, statusMatches(X.status("commit"), cA.status) && errorCodeOf(cA.body) === X.errorCode("commit")),
      lookupAssertion("lookup_200_not_committed", X, look),
      versionDeltaAssertion(X, finish),
      ...proxyLogAssertions(X, finish.proxyLog),
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
    const noLeak = (res) => res.body?.version === undefined && res.body?.revision === undefined && res.body?.version_id === undefined;
    assertions.push(
      lookupAssertion("foreign_member_lookup_410", X, lookOther, noLeak(lookOther)),
      lookupAssertion("never_sent_lookup_410", X, lookNever, noLeak(lookNever)),
      versionDeltaAssertion(X, finish),
      ...proxyLogAssertions(X, finish.proxyLog),
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
    assertions.push(
      statusAssertion("ai_turn_1_200", X.status("ai_turn_1"), t1.status, Boolean(convId)),
      statusAssertion("ai_turn_2_200", X.status("ai_turn_2"), t2.status),
      assertion("zero_versions_during_ai", X.versionDeltaAfterAi(), midDelta, midDelta === X.versionDeltaAfterAi()),
      assertion("save_after_ai_200", `${X.status("upload")}+${X.status("commit")}`, `${up.status}+${c1.status}`, statusMatches(X.status("upload"), up.status) && statusMatches(X.status("commit"), c1.status)),
      versionDeltaAssertion(X, finish),
      ...proxyLogAssertions(X, finish.proxyLog),
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
      statusAssertion("ai_turn_1_200", X.status("ai_turn_1"), t1.status),
      statusAssertion("revoke_member_204", X.status("revoke"), rev.status),
      statusAssertion("ai_turn_2_refused_403_404", X.status("ai_turn_2"), t2.status),
      statusAssertion("commit_refused_403_404", X.status("commit"), c1.status),
      versionDeltaAssertion(X, finish),
      ...proxyLogAssertions(X, finish.proxyLog),
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
    assertions.push(
      assertion("commit_while_archived_410", `${X.status("commit_while_archived")}:${X.errorCode("commit_while_archived")}`, `${c1.status}:${errorCodeOf(c1.body)}`, statusMatches(X.status("commit_while_archived"), c1.status) && errorCodeOf(c1.body) === X.errorCode("commit_while_archived")),
      assertion("restore_move_bumped_revision", `>${r0}`, String(restored.revision ?? ""), typeof restored.revision === "string" && revisionGreater(restored.revision, r0)),
      statusAssertion("commit_after_restore_move_200", X.status("commit_after_restore_move"), c2.status),
      versionDeltaAssertion(X, finish),
      ...proxyLogAssertions(X, finish.proxyLog),
    );
    return { assertions, intentLog, ...finish };
  }

  throw new Error(`unsupported server case id "${id}"`);
}
