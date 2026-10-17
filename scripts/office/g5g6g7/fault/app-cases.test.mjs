// Pure parts of the G7-03a app-layer fault runner (UNI-1380, WI-4): row
// selection, trace parsing and filtering, transition assertions, proxy-log
// helpers, aggregation and the app plumbing that needs no Electron or server.
// Run: node --test scripts/office/g5g6g7/fault/app-cases.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import test from "node:test";
import { appEnv } from "../harness/lib.mjs";
import { QUEUE_DRIVERS } from "./app-case-drivers.mjs";
import { BLOCKED_DRIVERS, EXTRA_EXITS, reasonOf } from "./app-case-drivers-blocked.mjs";
import { OFFLINE_DRIVERS } from "./app-case-drivers-offline.mjs";
import { parseAppCasesArgs } from "./app-cases.mjs";
import {
  BLOCKED_EXIT_CODE, INTENT_LOG_KEYS, appTraceArtifacts, assertEntersWithCode, buildAppIntentLog, commitKeyTag, assertNeverState, assertStatePath, attemptIdFromAuthorizationUrl,
  blockedCase, caseResult, commitLookups, commitPosts, descendantPids, documentWrites, envFileValue, expandExits,
  failEvidenceLines, faultAppExtraEnv, filterTrace, intentIdsOf, keyTagsOf, lastEntry, logSince, matchStatePath,
  parseProxyLog, parseTraceText, predictedFor, predictedTag, reachedUpstream, runEvidenceOf, runExitCode, runResult,
  selectAppCases, statePath, syncRequests, syncStoreScopeDir, uploadPosts,
} from "./app-cases-lib.mjs";
import {
  ACCESS_TOKEN_TTL_MS, TOKEN_RENEW_AFTER_MS, authedRequest, base32Decode, causeSuffix, dRequest, deviceBCommit, enrollTotp,
  expireStagedClaims, freshToken, login, psqlUrl, runnerApiOrigin, totpCode,
} from "./app-tenant.mjs";
import { buildIntentLogEntry, loadFaultCases } from "./server-cases-lib.mjs";

const DOC = "01JDOCAAAAAAAAAAAAAAAAAAAA";
const OTHER = "01JDOCBBBBBBBBBBBBBBBBBBBB";
const line = (ts, intentId, documentId, from, to, extra = {}) => JSON.stringify({ ts, intentId, documentId, from, to, ...extra });

const TRACE = [
  line("2026-10-15T01:00:00.000Z", "i1", DOC, null, "queued"),
  line("2026-10-15T01:00:01.000Z", "i1", DOC, "queued", "paused_offline", { code: "network" }),
  "{torn line",
  line("2026-10-15T01:00:02.000Z", "i9", OTHER, null, "queued"),
  JSON.stringify({ ts: "x", intentId: "i1", documentId: DOC, from: "queued", to: "not-a-state" }),
  line("2026-10-15T01:00:03.000Z", "i1", DOC, "paused_offline", "validating", { secret: "dropped" }),
  line("2026-10-15T01:00:04.000Z", "i1", DOC, "validating", "uploading"),
  line("2026-10-15T01:00:05.000Z", "i1", DOC, "uploading", "committing"),
  line("2026-10-15T01:00:06.000Z", "i1", DOC, "committing", "committed", { httpStatus: 200 }),
].join("\n");

test("selectAppCases runs the ready app rows and reports the rest with their reason", () => {
  const doc = loadFaultCases();
  const { runnable, blocked } = selectAppCases(doc);
  assert.ok(runnable.length > 0 && runnable.every((r) => r.layer === "app" && r.status === "ready"));
  assert.ok(blocked.every(({ row }) => row.layer === "app" && row.status !== "ready"));
  assert.equal(runnable.length + blocked.length, doc.cases.filter((r) => r.layer === "app").length);
  assert.ok(!blocked.some(({ row }) => /F-trace|F-clock/.test(row.status)), "F-trace / F-clock rows are ready now");
  assert.deepEqual(selectAppCases(doc, { caseId: "FQ-23" }).runnable, []);
  assert.equal(selectAppCases(doc, { caseId: "FQ-23" }).blocked[0].reason, "pending G5-10");
  // a W2 FL row reports BLOCKED with its dependency; a retired FL row reports its own reason, never a PASS
  assert.equal(selectAppCases(doc, { caseId: "FL-02" }).blocked[0].reason, "pending W2");
  assert.match(selectAppCases(doc, { caseId: "FL-04b" }).blocked[0].reason, /^SUPERSEDED: D1 /);
  assert.match(selectAppCases(doc, { caseId: "FL-04c" }).blocked[0].reason, /^BLOCKED\(G5-08d\): /);
  assert.throws(() => selectAppCases(doc, { caseId: "FQ-01" }), /unknown app fault case/);
});

test("every ready app row has a driver and every driver serves a ready row", () => {
  const ready = selectAppCases(loadFaultCases()).runnable.map((r) => r.id).sort();
  assert.deepEqual(Object.keys({ ...QUEUE_DRIVERS, ...BLOCKED_DRIVERS, ...OFFLINE_DRIVERS }).sort(), ready);
});

test("the client assertions of every app row read the trace hook", () => {
  for (const row of loadFaultCases().cases.filter((r) => r.layer === "app")) {
    assert.match(row.clientAssertions, /UNIWORK_SYNC_TRACE_FILE/, row.id);
  }
});

test("FQ-42 drops the first commit so the intent reconciles, then the lookup only says in_flight", () => {
  const row = loadFaultCases().cases.find((r) => r.id === "FQ-42");
  assert.equal(row.status, "ready");
  assert.equal(row.dependency, "none");
  assert.deepEqual(row.proxyRules.map((r) => `${r.id}:${r.action.type}`), ["drop-commit:drop_request", "always-in-flight:status"]);
});

test("parseTraceText keeps allow-listed keys and counts torn or foreign lines", () => {
  const { lines, rejected } = parseTraceText(TRACE);
  assert.equal(rejected, 2);
  assert.equal(lines.length, 7);
  assert.equal(lines[3].secret, undefined);
  assert.equal(lines[0].from, null);
  assert.deepEqual(parseTraceText("").lines, []);
});

// R1-3: an app row's intent-log.jsonl follows the matrix §4 schema, mapped from the fork trace
test("an app row's intent-log.jsonl carries the documented keys on every line, mapped from the trace (matrix §4)", () => {
  const trace = filterTrace(parseTraceText(TRACE).lines, DOC);
  const log = parseProxyLog([
    JSON.stringify({ ts: "t1", method: "POST", path: `/api/v1/documents/${DOC}/versions/commit`, status: "dropped", keyTag: "aaaaaaaaaaaa" }),
    JSON.stringify({ ts: "t2", method: "GET", path: `/api/v1/documents/${DOC}/versions/commit`, status: 200, keyTag: "aaaaaaaaaaaa" }),
  ].join("\n"));
  const artifacts = appTraceArtifacts({ caseId: "FQ-22", traceLines: trace, log, documentId: DOC });
  const lines = artifacts["intent-log.jsonl"].trim().split("\n").map((text) => JSON.parse(text));
  assert.equal(lines.length, trace.length);
  for (const entry of lines) {
    assert.deepEqual(Object.keys(entry), [...INTENT_LOG_KEYS], "the documented keys, in the documented order");
    assert.equal(entry.case, "FQ-22");
    assert.equal(entry.source, "app-trace");
    assert.equal(entry.intent, "i1");
    assert.equal(entry.keyTag, "aaaaaaaaaaaa");
    assert.equal(JSON.stringify(entry).includes(DOC), false, "no document id in the mapped log");
  }
  assert.deepEqual(lines.map((l) => l.event), ["start -> queued", "queued -> paused_offline", "paused_offline -> validating", "validating -> uploading", "uploading -> committing", "committing -> committed"]);
  assert.deepEqual(lines.map((l) => l.attempt), [null, null, 1, 1, 1, 1]);
  assert.equal(lines[0].from, null);
  assert.deepEqual(lines[1].http, { status: null, code: "network" });
  assert.deepEqual(lines[5].http, { status: 200, code: null });
  assert.equal(lines[2].http, null);
  // the unmapped trace stays as its own artifact, one parsed line per row
  assert.deepEqual(artifacts["app-trace.jsonl"].trim().split("\n").map((text) => JSON.parse(text)), trace);
});

test("intent-log attempt counts dispatch runs per intent; keyTag is null without exactly one commit key; empty trace -> empty files", () => {
  const two = [
    { ts: "1", intentId: "a", from: null, to: "queued" }, { ts: "2", intentId: "a", from: "queued", to: "validating" },
    { ts: "3", intentId: "b", from: null, to: "validating" }, { ts: "4", intentId: "a", from: "validating", to: "reconciling" },
    { ts: "5", intentId: "a", from: "reconciling", to: "queued" }, { ts: "6", intentId: "a", from: "queued", to: "validating" },
  ];
  assert.deepEqual(buildAppIntentLog(two, { caseId: "FQ-40" }).map((l) => [l.intent, l.attempt]), [["a", null], ["a", 1], ["b", 1], ["a", 1], ["a", 1], ["a", 2]]);
  const post = (keyTag) => ({ method: "POST", path: `/api/v1/documents/${DOC}/versions/commit`, status: 200, keyTag });
  assert.equal(commitKeyTag([post("k1"), post("k1")], DOC), "k1");
  assert.equal(commitKeyTag([post("k1"), post("k2")], DOC), null, "a replacement key is not one key");
  assert.equal(commitKeyTag([], DOC), null);
  const none = appTraceArtifacts({ caseId: "FQ-22", traceLines: [], log: [], documentId: null });
  assert.deepEqual(none, { "intent-log.jsonl": "", "app-trace.jsonl": "" });
});

test("the server rows' intent-log entries carry the same documented keys as the app rows' (one schema)", () => {
  const entry = buildIntentLogEntry({ caseId: "FQ-01", step: "commit_1", keyTag: "aaaaaaaaaaaa", attempt: 1, http: { method: "post", path: "/x", status: 200 } });
  for (const key of INTENT_LOG_KEYS) assert.ok(key in entry, `server entry lacks ${key}`);
});

test("matrix §4 documents the intent-log keys the runners write, and the app-trace artifact", () => {
  const matrix = readFileSync(join(FAULT_DIR, "..", "..", "..", "..", "docs", "office", "g5g6g7", "fault", "matrix.md"), "utf8");
  const row = matrix.split("\n").find((text) => text.startsWith("| `intent-log.jsonl`"));
  assert.ok(row, "matrix §4 has an intent-log.jsonl row");
  for (const key of INTENT_LOG_KEYS) assert.ok(row.includes(`\`${key}\``), `matrix §4 intent-log row does not name ${key}`);
  assert.match(matrix, /\| `app-trace\.jsonl`/);
});

test("filterTrace keeps one document, in order, optionally since a timestamp", () => {
  const { lines } = parseTraceText(TRACE);
  assert.equal(filterTrace(lines, DOC).length, 6);
  assert.deepEqual(filterTrace(lines, OTHER).map((l) => l.intentId), ["i9"]);
  assert.equal(filterTrace(lines, DOC, { sinceTs: "2026-10-15T01:00:04.000Z" }).length, 3);
  assert.deepEqual(intentIdsOf(lines), ["i1", "i9"]);
});

test("statePath and matchStatePath: adjacency, '*' gaps and 'a|b' alternation", () => {
  const lines = filterTrace(parseTraceText(TRACE).lines, DOC);
  const path = statePath(lines);
  assert.deepEqual(path, ["queued", "paused_offline", "validating", "uploading", "committing", "committed"]);
  assert.ok(matchStatePath(path, ["*", "paused_offline", "*", "committing", "committed"]));
  assert.ok(matchStatePath(path, ["queued|paused_offline", "*", "committed"]));
  assert.ok(!matchStatePath(path, ["*", "paused_offline", "committing", "*"]), "no gap without '*'");
  assert.ok(!matchStatePath(path, ["*", "reconciling", "*"]));
  assert.ok(matchStatePath([], ["*"]));
  assert.deepEqual(statePath([{ intentId: "x", from: "reconciling", to: "reconciling" }]), ["reconciling"]);
});

test("transition assertions report the expected and the actual path", () => {
  const lines = filterTrace(parseTraceText(TRACE).lines, DOC);
  const ok = assertStatePath("client_path", lines, ["*", "uploading", "committing", "committed"]);
  assert.equal(ok.ok, true);
  const bad = assertStatePath("client_path", lines, ["*", "reconciling", "committed"]);
  assert.equal(bad.ok, false);
  assert.match(bad.actual, /queued → paused_offline/);
  assert.equal(assertStatePath("x", [], ["committed"]).actual, "(no transition)");
  assert.equal(assertNeverState("n", lines, ["failed", "conflict"]).ok, true);
  assert.equal(assertNeverState("n", lines, ["committed"]).ok, false);
  const blocked = [{ intentId: "i", documentId: DOC, from: "reconciling", to: "blocked", code: "member_deactivated" }];
  assert.equal(assertEntersWithCode("r", blocked, "blocked", "member_deactivated").ok, true);
  assert.equal(assertEntersWithCode("r", blocked, "blocked", "permission_revoked").ok, false);
  assert.equal(assertEntersWithCode("r", lines, "blocked", "x").actual, "(never entered)");
  assert.equal(lastEntry(lines, "uploading").ts, "2026-10-15T01:00:04.000Z");
  assert.equal(lastEntry(lines, "blocked"), null);
});

test("proxy log helpers split commit, lookup and upload traffic per document", () => {
  const log = parseProxyLog([
    { ts: "2026-10-15T01:00:00.000Z", method: "POST", path: `/api/v1/documents/${DOC}/uploads`, status: 201, keyTag: "aaa" },
    { ts: "2026-10-15T01:00:01.000Z", method: "POST", path: `/api/v1/documents/${DOC}/versions/commit`, status: "dropped", keyTag: "aaa" },
    { ts: "2026-10-15T01:00:02.000Z", method: "GET", path: `/api/v1/documents/${DOC}/versions/commit`, status: 200, keyTag: "aaa" },
    { ts: "2026-10-15T01:00:03.000Z", method: "POST", path: `/api/v1/documents/${OTHER}/versions/commit`, status: 200, keyTag: "bbb" },
    { ts: "2026-10-15T01:00:04.000Z", method: "GET", path: `/api/v1/documents/${DOC}/versions`, status: 200, keyTag: null },
  ].map((e) => JSON.stringify(e)).join("\n") + "\nnot json\n");
  assert.equal(log.length, 5);
  assert.equal(commitPosts(log).length, 2);
  assert.equal(commitPosts(log, DOC).length, 1);
  assert.equal(commitLookups(log, DOC).length, 1);
  assert.equal(uploadPosts(log, DOC).length, 1);
  assert.equal(documentWrites(log, DOC).length, 2);
  assert.deepEqual(keyTagsOf([...commitPosts(log, DOC), ...uploadPosts(log, DOC)]), ["aaa"]);
  assert.equal(logSince(log, "2026-10-15T01:00:02.000Z").length, 3);
  assert.equal(reachedUpstream(commitPosts(log, DOC)[0]), false);
  assert.equal(reachedUpstream(commitLookups(log, DOC)[0]), true);
});

test("expandExits runs each exit once; a row without exits is one run", () => {
  const rows = loadFaultCases().cases;
  assert.deepEqual(expandExits(rows.find((r) => r.id === "FQ-22")).map((r) => r.index), [0]);
  const fq43 = expandExits(rows.find((r) => r.id === "FQ-43"));
  assert.equal(fq43.length, 6);
  assert.deepEqual(fq43.map((r) => reasonOf(r.label)), ["session_expired", "organization_suspended", "member_deactivated", "document_archived", "permission_revoked", "document_deleted"]);
  assert.equal(EXTRA_EXITS["FQ-43"].length, 3);
  assert.ok(EXTRA_EXITS["FQ-43"].every((e) => e.real && reasonOf(e.exit)));
  assert.deepEqual(expandExits(rows.find((r) => r.id === "FQ-50")).map((r) => reasonOf(r.label)), ["permission_revoked", "document_deleted", "document_archived", "organization_suspended", "member_deactivated"]);
  assert.deepEqual(expandExits(rows.find((r) => r.id === "FQ-51")).map((r) => reasonOf(r.label)), ["session_expired", "signed_out", "foreign_account"]);
});

test("runResult and caseResult: FAIL wins, PASS needs every run, a blocked run is never a PASS", () => {
  const pass = runResult({ label: "a", assertions: [{ name: "x", ok: true }] });
  const fail = runResult({ label: "b", assertions: [{ name: "x", ok: false }], predicted: "OQ-F6" });
  const blocked = runResult({ label: "c", assertions: [{ name: "x", ok: true }], blocker: "no admin" });
  assert.equal(pass.result, "PASS");
  assert.equal(fail.result, "FAIL");
  assert.equal(fail.predicted, "OQ-F6");
  assert.equal(pass.predicted, undefined);
  assert.equal(runResult({ assertions: [] }).result, "FAIL", "no assertion is not a pass");
  assert.equal(blocked.result, "BLOCKED");
  const row = { id: "FQ-50", ac: ["G5-A08"], fixture: "fx-xlsx-revenue-xyz" };
  assert.equal(caseResult(row, [pass, pass]).result, "PASS");
  assert.equal(caseResult(row, [pass, blocked]).result, "BLOCKED");
  const mixed = caseResult(row, [pass, blocked, fail]);
  assert.equal(mixed.result, "FAIL");
  assert.equal(mixed.predicted, "OQ-F6");
  assert.equal(mixed.blocker, "c: no admin");
  assert.deepEqual(mixed.exits.map((e) => e.n), [1, 2, 3]);
  assert.equal(mixed.assertions[0].exit, "a");
  assert.equal(caseResult(row, [pass]).exits[0].n, 0);
  assert.equal(caseResult(row, []).result, "BLOCKED");
  const pending = blockedCase({ ...row, scenario: "s" }, "pending G5-10");
  assert.equal(pending.result, "BLOCKED");
  assert.equal(pending.blocker, "s: pending G5-10");
});

test("runExitCode: ready rows decide; nothing ready ran is BLOCKED (77)", () => {
  assert.equal(runExitCode([{ result: "PASS" }, { result: "PASS" }]), 0);
  assert.equal(runExitCode([{ result: "PASS" }, { result: "FAIL" }]), 1);
  assert.equal(runExitCode([{ result: "PASS" }, { result: "BLOCKED" }]), BLOCKED_EXIT_CODE);
  assert.equal(runExitCode([]), BLOCKED_EXIT_CODE);
});

test("predictedTag reads the row's notes; FQ-24 is the predicted F4 FAIL", () => {
  assert.equal(predictedTag(loadFaultCases().cases.find((r) => r.id === "FQ-24")), "F4");
  assert.equal(predictedTag({ notes: "nothing" }), null);
  assert.equal(predictedTag({}), null);
});

test("every exit of FQ-40 is the predicted FAIL OQ-F11, tagged per exit (Advisor qa-fault_local:10 and :23)", () => {
  const rows = loadFaultCases().cases;
  const fq22 = rows.find((r) => r.id === "FQ-22");
  const fq40 = rows.find((r) => r.id === "FQ-40");
  assert.equal(predictedFor(fq22, expandExits(fq22)[0]), "OQ-F11", "FQ-22 keeps its row tag");
  assert.equal(predictedTag(fq40), null, "the tag is per exit: a row note would cover every exit");
  const tags = expandExits(fq40).map((run) => [run.label, predictedFor(fq40, run)]);
  assert.equal(tags.length, 5);
  assert.ok(tags.every(([, tag]) => tag === "OQ-F11"), JSON.stringify(tags));
  assert.equal(predictedFor(rows.find((r) => r.id === "FQ-24"), { label: "x", exit: null }), "F4");
});

test("a case is reported predicted only when every FAIL run is: an unpredicted FAIL is never hidden", () => {
  const row = { id: "FQ-40", ac: ["G5-A06"], fixture: "fx" };
  const predictedFail = runResult({ label: "a", assertions: [{ name: "x", ok: false }], predicted: "OQ-F11" });
  const plainFail = runResult({ label: "b", assertions: [{ name: "x", ok: false }] });
  const pass = runResult({ label: "c", assertions: [{ name: "x", ok: true }] });
  assert.equal(caseResult(row, [predictedFail, pass]).predicted, "OQ-F11");
  assert.equal(caseResult(row, [predictedFail, plainFail]).result, "FAIL");
  assert.equal(caseResult(row, [predictedFail, plainFail]).predicted, undefined);
  assert.equal(caseResult(row, [plainFail, pass]).predicted, undefined);
});

// R1-5: the matrix §4 commands are these scripts; run them for real (no harness, so BLOCKED is the honest answer)
const FAULT_DIR = fileURLToPath(new URL(".", import.meta.url));
const runCli = (script, args) => spawnSync(process.execPath, [join(FAULT_DIR, script), ...args], {
  encoding: "utf8", env: { ...process.env, OFFICE_EVIDENCE_ID: "ev-unit-test", HARNESS_RUN_DIR: "" },
});

test("app-cases.mjs --case <pending row>: exit 77, result.json written, the artifact directory is the last line", () => {
  const runDir = mkdtempSync(join(tmpdir(), "fault-app-cli-"));
  try {
    const run = runCli("app-cases.mjs", ["--case", "FQ-23", "--run-dir", runDir]);
    assert.equal(run.status, BLOCKED_EXIT_CODE, run.stderr);
    const lines = run.stdout.trim().split(/\r?\n/);
    assert.match(lines[0], /^FQ-23 \(G5-A06,G5-A08\): BLOCKED .*pending G5-10/);
    assert.equal(lines.at(-1), join(runDir, "fault"));
    assert.equal(JSON.parse(readFileSync(join(runDir, "fault", "FQ-23", "result.json"), "utf8")).result, "BLOCKED");
    const verify = runCli("app-cases.mjs", ["--case", "FQ-23", "--run-dir", runDir, "--verify-result"]);
    assert.equal(verify.status, BLOCKED_EXIT_CODE);
    assert.equal(verify.stdout.trim().split(/\r?\n/).at(-1), join(runDir, "fault", "FQ-23"));
    assert.equal(runCli("app-cases.mjs", ["--case", "FQ-01", "--run-dir", runDir]).status, 1, "a server row is not an app case");
    assert.equal(runCli("app-cases.mjs", ["--bogus"]).status, 1);
    assert.equal(existsSync(join(runDir, "fault", "FQ-01")), false);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("app plumbing: attempt id, store scope, fault env through appEnv, env files, process tree", () => {
  assert.equal(attemptIdFromAuthorizationUrl("http://127.0.0.1:3001/auth/desktop/authorize?attempt_id=01JATTEMPT"), "01JATTEMPT");
  assert.equal(attemptIdFromAuthorizationUrl("not a url"), null);
  assert.equal(attemptIdFromAuthorizationUrl("http://h/x"), null);
  assert.equal(syncStoreScopeDir("/u", "default", "01JUSER"), join("/u", "uniwork-sync", "store", "default", "01JUSER"));
  const extra = faultAppExtraEnv({ traceFile: "/r/trace.jsonl", stuckAfterMs: 20000, display: ":99", xauthority: "/r/xa" });
  assert.equal(extra.UNIWORK_SYNC_TRACE_FILE, "/r/trace.jsonl");
  assert.equal(extra.UNIWORK_SYNC_TEST_STUCK_AFTER_MS, "20000");
  assert.equal(extra.UNIWORK_SYNC_TEST_RECHECK_MS, undefined);
  assert.equal(extra.UNIWORK_AUTH_E2E_NO_BROWSER, "1");
  const env = appEnv({ source: { PATH: "/bin", DATABASE_URL: "postgres://x", JWT_SECRET: "s" }, apiOrigin: "http://127.0.0.1:5555", userDataDir: "/u", extra });
  assert.equal(env.UNIWORK_API_ORIGIN, "http://127.0.0.1:5555");
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.JWT_SECRET, undefined);
  assert.equal(env.DISPLAY, ":99");
  const text = "# c\nDATABASE_URL='postgres://u:p@h/db?sslmode=disable'\nA=b\nQ='it'\\''s'\n";
  assert.equal(envFileValue(text, "DATABASE_URL"), "postgres://u:p@h/db?sslmode=disable");
  assert.equal(envFileValue(text, "A"), "b");
  assert.equal(envFileValue(text, "Q"), "it's");
  assert.equal(envFileValue(text, "MISSING"), "");
  const ps = "  10     1\n  11    10\n  12    11\n  13    10\n  20     1\n";
  assert.deepEqual(descendantPids(ps, 10).sort(), [11, 12, 13]);
  assert.deepEqual(descendantPids(ps, 20), []);
});

test("parseAppCasesArgs reads --case, --run-dir, --cases-file and --verify-result", () => {
  const args = parseAppCasesArgs(["--case", "FQ-22", "--run-dir=/tmp/run", "--verify-result"], {});
  assert.equal(args.caseId, "FQ-22");
  assert.match(args.runDir.replace(/\\/g, "/"), /\/tmp\/run$/);
  assert.equal(args.verifyResult, true);
  assert.match(parseAppCasesArgs([], { HARNESS_RUN_DIR: "/x/run" }).runDir.replace(/\\/g, "/"), /\/x\/run$/);
  assert.throws(() => parseAppCasesArgs(["--nope"], {}), /unknown argument/);
});

test("deviceBCommit sends base_revision as a decimal string, like CommitDocumentVersionSDI", async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      if (req.method === "GET") return send(200, { document: { revision: "7" } });
      if (req.url.endsWith("/uploads")) return send(201, { upload_id: "up1" });
      const body = JSON.parse(raw);
      seen.push(body.base_revision);
      if (typeof body.base_revision !== "string") return send(400, { error: { code: "invalid_request", message: "bad body" } });
      return send(200, { version: { id: "v1" } });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const apiOrigin = `http://127.0.0.1:${server.address().port}`;
    const out = await deviceBCommit({ apiOrigin, owner: { token: "t" } }, DOC, { bytes: Buffer.from("x"), mime: "text/plain", path: "a.txt" });
    assert.deepEqual(seen, ["7"]);
    assert.equal(out.status, 200);
    assert.equal(out.versionId, "v1");
  } finally {
    server.close();
  }
});

// ---- FIX-4: held sessions, admin MFA, FQ-22 evidence, FQ-24 setup -------------------

/** A stub D server: `handler(req, body)` -> [status, json]; records every request. */
async function stubServer(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, body });
      const [status, json] = handler(req, body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

const heldAccount = (token, tokenAt) => {
  const account = { email: "a@example.com", token, tokenAt };
  Object.defineProperty(account, "password", { value: "pw", enumerable: false });
  return account;
};

test("authedRequest renews an expired session once on a 401 and retries once", async () => {
  const srv = await stubServer((req) => (req.headers.authorization === "Bearer new" ? [200, { ok: true }] : [401, { error: { code: "unauthorized" } }]));
  try {
    const account = heldAccount("old", Date.now());
    let renewals = 0;
    const renew = async (_origin, acc) => { renewals += 1; acc.token = "new"; acc.tokenAt = Date.now(); };
    const res = await authedRequest(srv.origin, "/api/v1/x", { as: account }, { renew });
    assert.equal(res.status, 200);
    assert.equal(renewals, 1);
    assert.deepEqual(srv.seen.map((r) => r.auth), ["Bearer old", "Bearer new"]);
  } finally {
    srv.close();
  }
});

test("authedRequest never loops: a second 401 is returned after one renewal", async () => {
  const srv = await stubServer(() => [401, { error: { code: "unauthorized" } }]);
  try {
    const account = heldAccount("old", Date.now());
    let renewals = 0;
    const renew = async (_origin, acc) => { renewals += 1; acc.token = `t${renewals}`; acc.tokenAt = Date.now(); };
    const res = await authedRequest(srv.origin, "/api/v1/x", { as: account }, { renew });
    assert.equal(res.status, 401);
    assert.equal(renewals, 1);
    assert.equal(srv.seen.length, 2);
  } finally {
    srv.close();
  }
});

test("a session older than the renew window is renewed before the request; a stub without password never is", async () => {
  const srv = await stubServer(() => [200, {}]);
  try {
    let renewals = 0;
    const renew = async (_origin, acc) => { renewals += 1; acc.token = "fresh"; acc.tokenAt = 0; };
    const now = () => 1_000_000_000;
    const account = heldAccount("stale", now() - TOKEN_RENEW_AFTER_MS);
    await authedRequest(srv.origin, "/api/v1/x", { as: account }, { renew, now });
    assert.equal(renewals, 1);
    assert.equal(srv.seen[0].auth, "Bearer fresh");
    assert.ok(TOKEN_RENEW_AFTER_MS < ACCESS_TOKEN_TTL_MS);
    assert.equal(await freshToken(srv.origin, heldAccount("young", now() - 1_000), { renew, now }), "young");
    await authedRequest(srv.origin, "/api/v1/x", { as: { token: "t" } }, { renew, now });
    assert.equal(renewals, 1);
  } finally {
    srv.close();
  }
});

test("totpCode matches the RFC 6238 SHA-1 vectors", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32("12345678901234567890")
  assert.equal(base32Decode(secret).toString(), "12345678901234567890");
  assert.equal(totpCode(secret, 59_000, 8), "94287082");
  assert.equal(totpCode(secret, 1111111109_000, 8), "07081804");
  assert.equal(totpCode(secret, 59_000), "287082");
  assert.throws(() => base32Decode("01!"), /bad base32/);
});

test("login completes the MFA step with the enrolled secret; enrollTotp confirms with a live code", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const now = () => 59_000;
  const srv = await stubServer((req) => {
    if (req.url === "/api/v1/me/mfa/setup") return [200, { secret, otpauth_url: "otpauth://x" }];
    if (req.url === "/api/v1/me/mfa/confirm") return [200, { recovery_codes: [] }];
    if (req.url === "/api/v1/auth/login") return [200, { mfa_required: true, mfa_token: "m1" }];
    if (req.url === "/api/v1/auth/mfa/verify") return [200, { access_token: "after-mfa" }];
    return [404, {}];
  });
  try {
    const account = heldAccount("t0", Date.now());
    await enrollTotp(srv.origin, account, { now });
    assert.equal(JSON.stringify(account).includes(secret), false, "the secret never lands in the account JSON");
    await login(srv.origin, account, { now });
    assert.equal(account.token, "after-mfa");
    const confirm = srv.seen.find((r) => r.url === "/api/v1/me/mfa/confirm");
    const verify = srv.seen.find((r) => r.url === "/api/v1/auth/mfa/verify");
    assert.equal(confirm.body.code, "287082");
    assert.deepEqual(verify.body, { mfa_token: "m1", code: "287082" });
    await assert.rejects(login(srv.origin, heldAccount("t", 0)), /no TOTP secret/);
  } finally {
    srv.close();
  }
});

test("expireStagedClaims reports the aged row count and BLOCKS a setup that aged nothing", () => {
  const ok = (stdout) => () => ({ status: 0, stdout, stderr: "" });
  const args = { databaseUrl: "postgres://u:secret@h:5432/db?sslmode=disable&pool_max_conns=4", orgId: "01JORGAAAAAAAAAAAAAAAAAAAA" };
  let argv;
  assert.deepEqual(expireStagedClaims(args, { run: (_cmd, a) => { argv = a; return { status: 0, stdout: "1\n" }; } }), { rows: 1 });
  assert.equal(argv[0], "postgres://u:secret@h:5432/db?sslmode=disable");
  assert.match(argv.at(-1), /WITH aged AS \(UPDATE file_upload_sessions .* RETURNING 1\) SELECT count\(\*\) FROM aged/);
  assert.match(expireStagedClaims(args, { run: ok("0\n") }).blocker, /0 staged upload claims/);
  assert.match(expireStagedClaims(args, { run: ok("") }).blocker, /no row count/);
  const failed = expireStagedClaims(args, { run: () => ({ status: 2, stdout: "", stderr: "psql: error: connection to postgres://u:secret@h/db failed\nmore" }) });
  assert.equal(failed.blocker, "setup claim_expired_in_run_db: psql exited 2: psql: error: connection to postgres://<redacted>@h/db failed");
  assert.match(expireStagedClaims(args, { run: () => ({ error: { code: "ENOENT" } }) }).blocker, /psql is not on PATH/);
  assert.match(expireStagedClaims({ ...args, orgId: "x'; drop" }).blocker, /not a ULID/);
  assert.equal(psqlUrl("not a url"), "not a url");
});

test("a run's evidence carries the full trace and every sync request; FAIL runs print them", () => {
  const log = parseProxyLog([
    JSON.stringify({ ts: "t1", method: "POST", path: `/api/v1/documents/${DOC}/uploads`, status: 201, keyTag: "k1", ruleId: null }),
    JSON.stringify({ ts: "t2", method: "POST", path: `/api/v1/documents/${DOC}/versions/commit`, status: 200, keyTag: "k1", ruleId: "lose-commit-answer" }),
    JSON.stringify({ ts: "t3", method: "GET", path: `/api/v1/documents/${DOC}/versions/commit`, status: 200, keyTag: "k1", ruleId: null }),
    JSON.stringify({ ts: "t4", method: "GET", path: `/api/v1/documents/${DOC}`, status: 200 }),
    JSON.stringify({ ts: "t5", method: "POST", path: `/api/v1/documents/${OTHER}/versions/commit`, status: 200, keyTag: "k9" }),
  ].join("\n"));
  const reqs = syncRequests(log, DOC);
  assert.deepEqual(reqs.map((r) => `${r.kind}:${r.status}:${r.keyTag}:${r.ruleId}`), ["upload:201:k1:null", "commit:200:k1:lose-commit-answer", "lookup:200:k1:null"]);
  const trace = [{ ts: "a", intentId: "i1", from: null, to: "queued" }, { ts: "b", intentId: "i1", from: "queued", to: "paused_offline", code: "network" }];
  const evidence = runEvidenceOf(trace, log, DOC);
  assert.equal(evidence.trace.length, 2);
  assert.equal(evidence.trace[1].code, "network");
  assert.deepEqual(runEvidenceOf(trace, log, null).requests, []);
  const failed = runResult({ label: "x", assertions: [{ name: "a", expected: 1, actual: 2, ok: false }], evidence });
  assert.equal(failed.evidence, evidence);
  const lines = failEvidenceLines("FQ-22", failed);
  assert.equal(lines.length, 5);
  assert.match(lines[1], /FQ-22 \[x\] trace b queued -> paused_offline code=network/);
  assert.match(lines[3], /proxy t2 commit POST 200 key=k1 rule=lose-commit-answer/);
  assert.deepEqual(failEvidenceLines("FQ-22", runResult({ assertions: [{ name: "a", expected: 1, actual: 1, ok: true }], evidence })), []);
  assert.ok(caseResult({ id: "FQ-22", ac: [] }, [failed]).exits[0].evidence, "result.json keeps each exit evidence");
});

test("dRequest reports the fetch cause for a closed port without leaking the token", async () => {
  const srv = createTcpServer();
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  const res = await dRequest(`http://127.0.0.1:${port}`, "/api/v1/x?q=1", { method: "POST", token: "SECRET-TOKEN-VALUE", json: { password: "pw" } });
  assert.equal(res.status, "unreachable");
  assert.equal(res.cause?.code, "ECONNREFUSED");
  assert.equal(res.origin, `127.0.0.1:${port}`);
  const text = JSON.stringify(res).toLowerCase();
  assert.ok(!text.includes("authorization") && !text.includes("secret-token") && !text.includes("q=1"));
  assert.match(causeSuffix(res), /ECONNREFUSED/);
});

test("runnerApiOrigin maps localhost to the IPv4 loopback and leaves other hosts alone", () => {
  assert.equal(runnerApiOrigin("http://localhost:8080"), "http://127.0.0.1:8080");
  assert.equal(runnerApiOrigin("https://localhost:8443"), "https://127.0.0.1:8443");
  assert.equal(runnerApiOrigin("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.equal(runnerApiOrigin("http://api.example.com:8080"), "http://api.example.com:8080");
  assert.equal(runnerApiOrigin("http://localhost.example.com:8080"), "http://localhost.example.com:8080");
  assert.equal(runnerApiOrigin("not a url"), "not a url");
});
