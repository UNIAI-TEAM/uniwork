/* global Buffer */
// Unit tests for G7-03a server-layer fault cases runner (UNI-1380).
// Covers row selection, rule rendering incl. FQ-43 per-exit, assertion evaluation,
// result/exit-code aggregation, missing-harness BLOCKED, and all 13 server case drivers.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRuleEngine } from "./rules.mjs";
import { SETUP_STATUS, readVerificationCode, registerAndVerifyUser, seedFaultTenant } from "./server-cases-setup.mjs";
import {
  CONVERSATION_HEADER,
  aiTurnBody,
  commitBody,
  createWireContext,
  describeResponse,
  errorCodeOf,
  folderBody,
  moveBody,
  revisionGreater,
  revisionString,
} from "./server-cases-wire.mjs";
import {
  BLOCKED_EXIT_CODE,
  aggregateExitCode,
  assertion,
  buildIntentLogEntry,
  computeKeyTag,
  evaluateCaseResult,
  loadFaultCases,
  parseServerCasesArgs,
  renderCaseRules,
  runSelectedServerCases,
  runServerCaseDriver,
  selectServerCases,
} from "./server-cases.mjs";

const casesDoc = loadFaultCases();

test("selectServerCases selects all 13 ready server rows or a single --case row", () => {
  const allServer = selectServerCases(casesDoc);
  assert.equal(allServer.length, 13);
  assert.deepEqual(
    allServer.map((row) => row.id),
    ["FQ-01", "FQ-02", "FQ-03", "FQ-04", "FQ-05", "FQ-06", "FQ-07", "FQ-08", "FQ-09", "FQ-10", "FQ-11", "FQ-12", "FQ-13"],
  );
  for (const row of allServer) {
    assert.equal(row.layer, "server");
    assert.equal(row.status, "ready");
  }
  const single = selectServerCases(casesDoc, { caseId: "FQ-07" });
  assert.equal(single.length, 1);
  assert.equal(single[0].id, "FQ-07");
  assert.throws(() => selectServerCases(casesDoc, { caseId: "FQ-99" }), /unknown or non-ready/);
  assert.throws(() => selectServerCases(casesDoc, { caseId: "FQ-20" }), /unknown or non-ready/);
});

test("parseServerCasesArgs parses --case, --run-dir, env defaults, and rejects unknown flags", () => {
  const parsed = parseServerCasesArgs(["--case", "FQ-04", "--run-dir", ".custom-run"], {});
  assert.equal(parsed.caseId, "FQ-04");
  assert.ok(parsed.runDir.endsWith(".custom-run"));
  assert.equal(parsed.verifyResult, false);

  const fromEquals = parseServerCasesArgs(["--case=FQ-12", "--run-dir=.eq-run", "--verify-result"], {});
  assert.equal(fromEquals.caseId, "FQ-12");
  assert.ok(fromEquals.runDir.endsWith(".eq-run"));
  assert.equal(fromEquals.verifyResult, true);

  const fromEnv = parseServerCasesArgs([], { HARNESS_RUN_DIR: ".env-run" });
  assert.equal(fromEnv.caseId, null);
  assert.ok(fromEnv.runDir.endsWith(".env-run"));
  assert.throws(() => parseServerCasesArgs(["--unknown-flag"]), /unknown argument/);
});

test("renderCaseRules renders server rules, substitutes <id>, and substitutes per-exit for FQ-43", () => {
  for (const row of selectServerCases(casesDoc)) {
    const rendered = renderCaseRules(row, { documentId: "doc_abc_123" });
    assert.equal(rendered.length, row.proxyRules.length);
  }

  const customRow = {
    id: "FQ-CUSTOM",
    proxyRules: [
      {
        id: "sub-doc",
        match: { method: "POST", path: "^/api/v1/documents/<id>/versions/commit$" },
        action: { type: "drop_request" },
        once: true,
      },
    ],
  };
  const subRendered = renderCaseRules(customRow, { documentId: "doc.42+1" });
  assert.equal(subRendered[0].match.path, "^/api/v1/documents/doc\\.42\\+1/versions/commit$");
  assert.equal(new RegExp(subRendered[0].match.path).test("/api/v1/documents/doc.42+1/versions/commit"), true);

  const fq43 = casesDoc.cases.find((row) => row.id === "FQ-43");
  assert.ok(fq43, "FQ-43 must exist in cases.json");
  assert.equal(fq43.exits.length, 6);

  for (let i = 0; i < fq43.exits.length; i += 1) {
    const exit = fq43.exits[i];
    const rules = renderCaseRules(fq43, { exitIndex: i });
    assert.equal(rules.length, 2);
    assert.equal(rules[0].id, "lose-commit-answer");
    assert.equal(rules[0].action.type, "drop_response_after_forward");
    assert.equal(rules[1].id, "lookup-verdict");
    assert.equal(rules[1].action.type, "status");
    assert.equal(rules[1].action.code, exit.lookup.code);
    assert.deepEqual(rules[1].action.body, { error: { code: exit.lookup.errorCode } });
    assert.equal("note" in rules[1].action, false);
  }

  assert.throws(
    () =>
      renderCaseRules(
        {
          id: "FQ-43-BAD",
          exits: [{ exit: "missing-lookup" }],
          proxyRules: [
            {
              id: "lookup-verdict",
              match: { method: "GET", path: "^/api/v1/documents/[^/]+/versions/commit$" },
              action: { type: "status", code: "per-exit" },
            },
          ],
        },
        { exitIndex: 0 },
      ),
    /requires per-exit lookup/,
  );
});

test("evaluateCaseResult, aggregateExitCode, and buildIntentLogEntry follow contract rules", () => {
  const passCase = evaluateCaseResult({
    caseId: "FQ-01",
    ac: ["G5-A06"],
    assertions: [assertion("a1", 200, 200, true), assertion("a2", 1, 1, true)],
  });
  const failCase = evaluateCaseResult({
    caseId: "FQ-02",
    ac: ["G5-A06"],
    assertions: [assertion("a1", 200, 500, false)],
  });
  const blockedCase = evaluateCaseResult({
    caseId: "FQ-03",
    ac: ["G6-A04", "G5-A06"],
    assertions: [],
    blockedReason: "harness not running",
  });
  assert.equal(passCase.result, "PASS");
  assert.equal(failCase.result, "FAIL");
  assert.equal(blockedCase.result, "BLOCKED");

  assert.equal(aggregateExitCode([passCase]), 0);
  assert.equal(aggregateExitCode([passCase, failCase]), 1);
  assert.equal(aggregateExitCode([blockedCase, failCase]), 1);
  assert.equal(aggregateExitCode([blockedCase]), BLOCKED_EXIT_CODE);
  assert.equal(aggregateExitCode([passCase, blockedCase]), BLOCKED_EXIT_CODE);
  assert.equal(aggregateExitCode([]), BLOCKED_EXIT_CODE);

  const tag1 = computeKeyTag("secret-key-value-1", "test-salt");
  const tag2 = computeKeyTag("secret-key-value-1", "test-salt");
  const tag3 = computeKeyTag("secret-key-value-2", "test-salt");
  assert.equal(tag1, tag2);
  assert.notEqual(tag1, tag3);
  assert.match(tag1, /^[0-9a-f]{12}$/);

  const entry = buildIntentLogEntry({
    caseId: "FQ-01",
    step: "commit_1",
    keyTag: tag1,
    attempt: 1,
    status: "dropped",
    outcome: "dropped",
    http: { method: "post", path: "/api/v1/documents/doc_1/versions/commit?token=secret-jwt", status: "dropped", code: null },
  });
  const serialized = JSON.stringify(entry);
  assert.equal(entry.http.path, "/api/v1/documents/doc_1/versions/commit");
  assert.equal(serialized.includes("secret-jwt"), false);
  assert.equal(serialized.includes("secret-key-value-1"), false);
});

const DECIMAL_STRING = /^\d+$/;
const API_ORIGIN = "http://api";
const PROXY_ORIGIN = "http://proxy";
const ACTOR_TOKENS = { deviceA: "tok-deviceA", deviceB: "tok-deviceB", owner: "tok-deviceA", memberB: "tok-memberB" };

// The error envelope every refusal carries: sdo.ErrorSDO / json.go respondError.
const refusal = (status, code, fields) => ({
  ok: false,
  status,
  body: { error: { code, message: code, ...(fields ? { fields } : {}) } },
  conversationId: "",
  dropped: false,
  aborted: false,
});
const answer = (status, body, conversationId = "") => ({ ok: status < 400, status, body, conversationId, dropped: false, aborted: false });

// A fake of the server routes the drivers call. It enforces the request shapes
// the handlers decode (revisions are decimal STRINGS, `kind: folder`, the
// multipart `file` part, the AI conversation header) and answers with the real
// response shapes (sdo.DocumentVersionResultSDO, CommitIntentSDO, ErrorSDO), so
// a driver that sends or reads a wrong shape fails here and not on a cloud VM.
function createFakeServer(docId, { breakCase = false } = {}) {
  const state = {
    revision: 1,
    contentRevision: 1,
    archived: false,
    memberBActive: true,
    versions: [{ id: "ver_1", version: 1, revision: "1", checksum_sha256: "sha_v1" }],
    uploads: new Map(),
    uploadByIdemKey: new Map(),
    intents: new Map(),
    conversations: new Map(),
    continuedTurns: 0,
    keyCounter: 0,
    calls: [],
  };
  const actorOf = (token) => Object.keys(ACTOR_TOKENS).find((name) => ACTOR_TOKENS[name] === token && name !== "owner");
  const header = (headers, name) => {
    const hit = Object.keys(headers ?? {}).find((key) => key.toLowerCase() === name.toLowerCase());
    return hit ? headers[hit] : "";
  };
  const memberGone = (actor) => actor === "memberB" && !state.memberBActive;

  function upload({ actor, headers, form }) {
    if (memberGone(actor)) return refusal(404, "not_found");
    if (!form?.fileBytes?.length || !form.filename) return refusal(400, "invalid_request");
    const idemKey = header(headers, "Idempotency-Key");
    const dedupeKey = idemKey ? `${actor}:${idemKey}` : null;
    if (dedupeKey && state.uploadByIdemKey.has(dedupeKey)) return answer(201, state.uploadByIdemKey.get(dedupeKey));
    const uploadId = `upl_${state.uploads.size + 1}`;
    const rec = { upload_id: uploadId, checksum_sha256: `sha256_${uploadId}`, size_bytes: 128, claim_expires_at: "2026-10-16T00:00:00Z" };
    state.uploads.set(uploadId, rec);
    if (dedupeKey) state.uploadByIdemKey.set(dedupeKey, rec);
    return answer(201, rec);
  }

  function commit({ actor, headers, body }) {
    // sdi.CommitDocumentVersionSDI: a number in base_revision fails the JSON decode (handler decode() -> 400 invalid_request).
    if (typeof body?.upload_id !== "string" || typeof body?.base_revision !== "string") return refusal(400, "invalid_request");
    if (!DECIMAL_STRING.test(body.base_revision.trim())) return refusal(400, "invalid_request");
    if (memberGone(actor)) return refusal(404, "not_found");
    const key = header(headers, "Idempotency-Key");
    const existing = state.intents.get(key);
    if (existing?.status === "committed") {
      return answer(200, { document: { id: docId, revision: String(existing.revision) }, version: existing.versionObj });
    }
    if (state.archived) {
      state.intents.set(key, { actor, status: "not_committed" });
      return refusal(410, "document_deleted");
    }
    const base = BigInt(body.base_revision.trim());
    if (!(BigInt(state.contentRevision) <= base && base <= BigInt(state.revision))) {
      state.intents.set(key, { actor, status: "not_committed" });
      return refusal(409, "document_version_conflict", { current_revision: String(state.revision) });
    }
    state.revision += 1;
    state.contentRevision = state.revision;
    const up = state.uploads.get(body.upload_id) ?? { checksum_sha256: "sha_unknown" };
    const verNum = breakCase ? state.versions.length : state.versions.length + 1;
    const versionObj = { id: `ver_${verNum}`, document_id: docId, version: verNum, checksum_sha256: up.checksum_sha256 };
    if (!breakCase) state.versions.push({ ...versionObj, revision: String(state.revision) });
    state.intents.set(key, { actor, status: "committed", versionObj, revision: state.revision });
    return answer(200, { document: { id: docId, revision: String(state.revision) }, version: versionObj });
  }

  // GET versions/commit: sdo.CommitIntentSDO, and a key nobody holds is 410 commit_intent_unknown with fields.outcome.
  function lookup({ actor, headers }) {
    const intent = state.intents.get(header(headers, "Idempotency-Key"));
    const sameUser = intent && (intent.actor === actor || [intent.actor, actor].every((name) => name === "deviceA" || name === "deviceB"));
    if (!intent || !sameUser) return refusal(410, "commit_intent_unknown", { outcome: "unknown" });
    if (intent.status === "committed") {
      return answer(200, {
        outcome: "committed",
        version_id: intent.versionObj.id,
        version: intent.versionObj.version,
        revision: String(intent.revision),
      });
    }
    return answer(200, { outcome: "not_committed" });
  }

  function aiTurn({ actor, headers, body }) {
    if (!Array.isArray(body?.messages) || body.messages.length !== 1 || body.messages[0]?.role !== "user") return refusal(400, "invalid_request");
    const sent = header(headers, "X-UniWork-AI-Conversation");
    if (memberGone(actor)) {
      if (sent) state.conversations.delete(sent);
      return refusal(404, "not_found");
    }
    if (sent) state.continuedTurns += 1;
    const convId = sent || `conv_${++state.keyCounter}`;
    state.conversations.set(convId, { actor, docId });
    return answer(200, { choices: [{ message: { role: "assistant", content: "ok" } }] }, convId);
  }

  function route({ method, path, token, headers, body, form }) {
    const actor = actorOf(token);
    const documentPath = `/api/v1/documents/${docId}`;
    if (method === "POST" && path === `${documentPath}/uploads`) return upload({ actor, headers, form });
    if (method === "POST" && path === `${documentPath}/versions/commit`) return commit({ actor, headers, body });
    if (method === "GET" && path === `${documentPath}/versions/commit`) return lookup({ actor, headers });
    if (method === "GET" && path === documentPath) return answer(200, { document: { id: docId, revision: String(state.revision) } });
    if (method === "POST" && path === `${documentPath}/ai/uniwork/chat/completions`) return aiTurn({ actor, headers, body });
    if (method === "POST" && path === `${documentPath}/archive`) {
      state.archived = true;
      return answer(200, { document: { id: docId, revision: String(state.revision) }, affected: [docId] });
    }
    if (method === "POST" && path === `${documentPath}/restore`) {
      state.archived = false;
      state.revision += 1;
      return answer(200, { document: { id: docId, revision: String(state.revision) }, affected: [docId] });
    }
    if (method === "POST" && path === "/api/v1/workspaces/ws_1/documents") {
      // sdi.CreateDocumentSDI: kind is page or folder.
      if (body?.kind !== "folder" || typeof body?.title !== "string" || !body.title) return refusal(400, "invalid_request");
      return answer(201, { document: { id: "folder_1", kind: "folder", revision: "1" } });
    }
    if (method === "POST" && path === `${documentPath}/move`) {
      // sdi.MoveDocumentSDI: revision is a decimal string; stale -> 422 revision_conflict.
      if (typeof body?.revision !== "string" || !DECIMAL_STRING.test(body.revision.trim())) return refusal(400, "invalid_request");
      if (body.revision.trim() !== String(state.revision)) return refusal(422, "revision_conflict", { current_revision: String(state.revision) });
      state.revision += 1;
      return answer(200, { document: { id: docId, revision: String(state.revision) } });
    }
    if (method === "DELETE" && path === "/api/v1/workspaces/ws_1/members/user_memberB") {
      state.memberBActive = false;
      return { ok: true, status: 204, body: null, conversationId: "", dropped: false, aborted: false };
    }
    return refusal(404, "not_found");
  }

  return { state, route };
}

function createFakeCaseContext(caseRow, { breakCase = false } = {}) {
  const docId = `doc_${caseRow.id.toLowerCase().replace("-", "_")}`;
  const salt = `salt-${caseRow.id}`;
  const keyTag = (rawKey) => computeKeyTag(rawKey, salt);
  const ruleEngine = createRuleEngine(renderCaseRules(caseRow, { documentId: docId }));
  const server = createFakeServer(docId, { breakCase });
  const { state } = server;
  const proxyLog = [];
  let keyCounter = 0;

  function logProxy(method, path, status, rawIdemKey, ruleId = null) {
    proxyLog.push({
      ts: new Date().toISOString(),
      method,
      path,
      status,
      ms: 1,
      idempotencyKey: Boolean(rawIdemKey),
      keyTag: rawIdemKey ? keyTag(rawIdemKey) : null,
      ruleId,
    });
  }

  async function throughProxy(request, signal) {
    const { method, path } = request;
    const rawIdemKey = request.headers?.["Idempotency-Key"];
    const executeUpstream = () => server.route(request);
    const matched = ruleEngine.matchRequest({ method, path });
    if (!matched) {
      const res = executeUpstream();
      logProxy(method, path, res.status, rawIdemKey, null);
      return res;
    }
    const { ruleId, action, waitForRelease } = matched;
    if (action.type === "drop_request") {
      logProxy(method, path, "dropped", rawIdemKey, ruleId);
      return { ok: false, status: "dropped", body: null, dropped: true, aborted: false };
    }
    if (action.type === "status") {
      logProxy(method, path, "synthetic", rawIdemKey, ruleId);
      return { ok: false, status: action.code, body: action.body ?? null, dropped: false, aborted: false };
    }
    if (action.type === "drop_response_after_forward") {
      executeUpstream();
      logProxy(method, path, "dropped", rawIdemKey, ruleId);
      return { ok: false, status: "dropped", body: null, dropped: true, aborted: false };
    }
    if (action.type === "delay") {
      await new Promise((r) => setTimeout(r, Math.min(action.ms, 20)));
      const res = executeUpstream();
      logProxy(method, path, res.status, rawIdemKey, ruleId);
      return res;
    }
    if (action.type === "hold") {
      if (signal) {
        const abortPromise = new Promise((resolveAbort) => {
          if (signal.aborted) resolveAbort("aborted");
          else signal.addEventListener("abort", () => resolveAbort("aborted"), { once: true });
        });
        waitForRelease.then(() => {
          const res = executeUpstream();
          logProxy(method, path, res.status, rawIdemKey, ruleId);
        });
        const winner = await Promise.race([waitForRelease.then(() => "released"), abortPromise]);
        if (winner === "aborted") return { ok: false, status: "aborted", body: null, dropped: true, aborted: true };
      }
      await waitForRelease;
      const res = executeUpstream();
      logProxy(method, path, res.status, rawIdemKey, ruleId);
      return res;
    }
    const res = executeUpstream();
    logProxy(method, path, res.status, rawIdemKey, ruleId);
    return res;
  }

  // The transport the wire context calls (server-cases.mjs httpJson / httpMultipartFile): a request through
  // PROXY_ORIGIN meets the proxy rules first, one through API_ORIGIN goes straight to the server.
  const send = async (origin, path, { method = "GET", token, headers = {}, body, signal, fileBytes, filename, mime } = {}) => {
    const request = { method, path, token, headers, body, form: fileBytes ? { fileBytes, filename, mime } : undefined };
    state.calls.push({ origin, method, path, headers, body });
    return origin === PROXY_ORIGIN ? throughProxy(request, signal) : server.route(request);
  };
  const wire = createWireContext({
    http: send,
    multipart: (origin, path, opts) => send(origin, path, { ...opts, method: "POST" }),
    apiOrigin: API_ORIGIN,
    proxyOrigin: PROXY_ORIGIN,
    tenant: { workspaceId: "ws_1", tokens: ACTOR_TOKENS, users: { deviceA: "user_deviceA", memberB: "user_memberB" } },
    doc: { id: docId, revision: "1" },
    caseId: caseRow.id,
    fixture: { bytes: Buffer.from("fixture-bytes"), mime: "application/pdf", filename: "fixture.pdf" },
    newKey: (prefix) => `${prefix}-${++keyCounter}`,
  });

  return {
    document: { id: docId, revision: "1" },
    beforeCount: 1,
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))),
    newKey: (prefix) => `${prefix}-${++keyCounter}`,
    keyTag,
    ...wire,
    server,
    waitForRuleHeld: async (ruleId) => {
      for (let i = 0; i < 20; i += 1) {
        const found = ruleEngine.getRules().find((r) => r.id === ruleId);
        if ((found?.held ?? 0) >= 1) return found;
        await new Promise((r) => setTimeout(r, 5));
      }
      return null;
    },
    releaseRule: async (ruleId) => ruleEngine.release(ruleId),
    waitForProxyLogCount: async (pred, minCount) => {
      for (let i = 0; i < 20; i += 1) {
        if (proxyLog.filter(pred).length >= minCount) return proxyLog;
        await new Promise((r) => setTimeout(r, 5));
      }
      return proxyLog;
    },
    collectVersions: async () => ({ document_id: docId, versions: [...state.versions], next_cursor: null }),
    collectCaseEnd: async () => ({
      afterVersions: { document_id: docId, versions: [...state.versions], next_cursor: null },
      versionDelta: state.versions.length - 1,
      proxyLog: [...proxyLog],
      proxyLogRaw: `${proxyLog.map((e) => JSON.stringify(e)).join("\n")}\n`,
    }),
  };
}

test("runServerCaseDriver executes all 13 server cases (FQ-01..FQ-13) against a fake transport", async () => {
  const rows = selectServerCases(casesDoc);
  assert.equal(rows.length, 13);
  for (const row of rows) {
    const outcome = await runServerCaseDriver(row, createFakeCaseContext(row));
    const evaluated = evaluateCaseResult({ caseId: row.id, ac: row.ac, assertions: outcome.assertions });
    assert.equal(evaluated.result, "PASS", `${row.id} failed: ${JSON.stringify(evaluated.assertions)}`);
    assert.ok(outcome.intentLog.length > 0, `${row.id} should record intent-log entries`);
  }
  const brokenRow = rows[0];
  const brokenOutcome = await runServerCaseDriver(brokenRow, createFakeCaseContext(brokenRow, { breakCase: true }));
  const brokenResult = evaluateCaseResult({ caseId: brokenRow.id, ac: brokenRow.ac, assertions: brokenOutcome.assertions });
  assert.equal(brokenResult.result, "FAIL");
});

test("runSelectedServerCases reports BLOCKED (77) and writes per-case artifacts when harness is absent", async () => {
  const tempRunDir = mkdtempSync(join(tmpdir(), "fault-server-cases-blocked-"));
  try {
    const { results, exitCode } = await runSelectedServerCases({
      caseId: "FQ-01",
      runDir: tempRunDir,
      env: { OFFICE_EVIDENCE_ID: "ev-unit-test" },
    });
    assert.equal(exitCode, BLOCKED_EXIT_CODE);
    assert.equal(results.length, 1);
    assert.equal(results[0].case, "FQ-01");
    assert.equal(results[0].result, "BLOCKED");

    const caseDir = join(tempRunDir, "fault", "FQ-01");
    for (const file of ["intent-log.jsonl", "server-versions.json", "proxy-log.jsonl", "result.json", "case-result.json"]) {
      assert.equal(existsSync(join(caseDir, file)), true, `missing ${file}`);
    }
    const diskResult = JSON.parse(readFileSync(join(caseDir, "result.json"), "utf8"));
    assert.equal(diskResult.result, "BLOCKED");
    assert.deepEqual(diskResult.ac, ["G5-A06"]);
  } finally {
    rmSync(tempRunDir, { recursive: true, force: true });
  }
});

// A fake of the setup routes with the statuses the handlers really write
// (SETUP_STATUS cites each file:line); the verify route only takes `code`.
function createFakeSetupServer({ code, statuses = {} } = {}) {
  const calls = [];
  const status = (key) => statuses[key] ?? SETUP_STATUS[key];
  let seq = 0;
  async function http(_origin, path, { method = "GET", token, body } = {}) {
    calls.push({ method, path, token, body });
    if (path === "/api/v1/auth/register") return { status: status("register"), body: { access_token: `tok-${++seq}`, user: { id: `user-${seq}` } } };
    if (path === "/api/v1/auth/login") return { status: status("login"), body: { access_token: "tok-login" } };
    if (path === "/api/v1/me/email/verify") return { status: body?.code === code ? status("verifyEmail") : 400, body: {} };
    if (path === "/api/v1/me/onboarding/complete") return { status: status("completeOnboarding"), body: {} };
    if (path === "/api/v1/orgs") return { status: status("createOrganization"), body: { organization: { id: "org-1" } } };
    if (path === "/api/v1/orgs/org-1/workspaces") return { status: status("createWorkspace"), body: { workspace: { id: "ws-1" } } };
    if (path === "/api/v1/workspaces/ws-1/invitations") return { status: status("createInvitation"), body: {} };
    if (path === "/api/v1/me/invitations") return { status: 200, body: { invitations: [{ token: "inv-1", workspace: { id: "ws-1" } }] } };
    if (path === "/api/v1/invitations/inv-1/accept") return { status: status("acceptInvitation"), body: {} };
    return { status: 404, body: null };
  }
  return { http, calls };
}

test("SETUP_STATUS matches the handlers: register answers 200 (not 201), create org/workspace 201", () => {
  assert.equal(SETUP_STATUS.register, 200);
  assert.equal(SETUP_STATUS.login, 200);
  assert.equal(SETUP_STATUS.createOrganization, 201);
  assert.equal(SETUP_STATUS.createWorkspace, 201);
  assert.equal(SETUP_STATUS.createInvitation, 200);
  assert.equal(SETUP_STATUS.acceptInvitation, 200);
});

test("readVerificationCode reads the run's server.env, then the process env, then the harness default", () => {
  const runDir = mkdtempSync(join(tmpdir(), "fault-setup-env-"));
  try {
    assert.equal(readVerificationCode(runDir, {}), "123456");
    assert.equal(readVerificationCode(runDir, { DEV_VERIFICATION_CODE: "654321" }), "654321");
    writeFileSync(join(runDir, "server.env"), "APP_ENV='development'\nDEV_VERIFICATION_CODE='424242'\nJWT_SECRET='x'\n", "utf8");
    assert.equal(readVerificationCode(runDir, { DEV_VERIFICATION_CODE: "654321" }), "424242");
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("registerAndVerifyUser accepts register 200 and sends the run's verification code", async () => {
  const fake = createFakeSetupServer({ code: "424242" });
  const user = await registerAndVerifyUser({ http: fake.http, apiOrigin: "http://api", tag: "deviceA", verificationCode: "424242" });
  assert.equal(user.token, "tok-1");
  assert.equal(user.userId, "user-1");
  assert.deepEqual(fake.calls.map((c) => c.path), ["/api/v1/auth/register", "/api/v1/me/email/verify", "/api/v1/me/onboarding/complete"]);
  assert.deepEqual(fake.calls[1].body, { code: "424242" });
});

test("registerAndVerifyUser names the step and both statuses when the server answers otherwise", async () => {
  const wrongStatus = createFakeSetupServer({ code: "123456", statuses: { register: 201 } });
  await assert.rejects(
    registerAndVerifyUser({ http: wrongStatus.http, apiOrigin: "http://api", tag: "t", verificationCode: "123456" }),
    /register t failed: status 201 \(expected 200\)/,
  );
  const wrongCode = createFakeSetupServer({ code: "424242" });
  await assert.rejects(
    registerAndVerifyUser({ http: wrongCode.http, apiOrigin: "http://api", tag: "t", verificationCode: "000000" }),
    /verify t failed: status 400 \(expected 200\)/,
  );
});

test("seedFaultTenant builds org, workspace and memberB through the real statuses and re-invites idempotently", async () => {
  const fake = createFakeSetupServer({ code: "424242" });
  const tenant = await seedFaultTenant({ http: fake.http, apiOrigin: "http://api", verificationCode: "424242" });
  assert.equal(tenant.orgId, "org-1");
  assert.equal(tenant.workspaceId, "ws-1");
  assert.equal(tenant.tokens.deviceB, "tok-login");
  assert.equal(tenant.tokens.memberB, "tok-2");
  const before = fake.calls.length;
  await tenant.ensureMemberBInWorkspace();
  assert.equal(fake.calls.length - before, 3);
  const broken = createFakeSetupServer({ code: "424242", statuses: { createWorkspace: 200 } });
  await assert.rejects(seedFaultTenant({ http: broken.http, apiOrigin: "http://api", verificationCode: "424242" }), /create workspace failed: status 200 \(expected 201\)/);
});

// One test per corrected wire shape (FIX-2). The fake server above enforces the
// same decode rules as the handlers, so these also pin it against drift.

test("revisions go on the wire as decimal strings and are never a Number (sdi.CommitDocumentVersionSDI.base_revision)", () => {
  assert.deepEqual(commitBody({ uploadId: "up_1", baseRevision: "41" }), { upload_id: "up_1", base_revision: "41" });
  assert.deepEqual(commitBody({ uploadId: "up_1", baseRevision: 41n }), { upload_id: "up_1", base_revision: "41" });
  assert.equal(commitBody({ uploadId: "up_1", baseRevision: "9007199254740993" }).base_revision, "9007199254740993");
  for (const bad of [41, "4.1", "-1", "", null, undefined, {}]) {
    assert.throws(() => commitBody({ uploadId: "up_1", baseRevision: bad }), /base_revision must be a decimal string/);
  }
  assert.equal(revisionString(" 7 "), "7");
});

test("revisionGreater compares decimal strings exactly past 2^53", () => {
  assert.equal(revisionGreater("9007199254740993", "9007199254740992"), true);
  assert.equal(revisionGreater("9007199254740992", "9007199254740993"), false);
  assert.equal(revisionGreater("10", "9"), true);
  assert.equal(revisionGreater("9", "9"), false);
  assert.throws(() => revisionGreater(10, "9"), TypeError);
});

test("the fake server refuses a numeric base_revision like the real commit handler (400 invalid_request)", async () => {
  const ctx = createFakeCaseContext(selectServerCases(casesDoc, { caseId: "FQ-05" })[0]);
  const up = await ctx.uploadDirect("deviceA", ctx.document.id, { idempotencyKey: "k-up", label: "v2" });
  const route = `/api/v1/documents/${ctx.document.id}/versions/commit`;
  const numeric = ctx.server.route({
    method: "POST",
    path: route,
    token: "tok-deviceA",
    headers: { "Idempotency-Key": "k-num" },
    body: { upload_id: up.body.upload_id, base_revision: 1 },
  });
  assert.equal(numeric.status, 400);
  assert.equal(errorCodeOf(numeric.body), "invalid_request");
  const viaWire = await ctx.commitViaProxy("deviceA", ctx.document.id, { idempotencyKey: "k-str", uploadId: up.body.upload_id, baseRevision: "1" });
  assert.equal(viaWire.status, 200);
  assert.equal(typeof viaWire.body.document.revision, "string");
});

test("commit requests carry upload_id and a string base_revision, and the Idempotency-Key header", async () => {
  const ctx = createFakeCaseContext(selectServerCases(casesDoc, { caseId: "FQ-05" })[0]);
  const up = await ctx.uploadDirect("deviceA", ctx.document.id, { idempotencyKey: "k-up", label: "v2" });
  await ctx.commitViaProxy("deviceA", ctx.document.id, { idempotencyKey: "k-commit", uploadId: up.body.upload_id, baseRevision: ctx.document.revision });
  await ctx.uploadAndCommitDirect("deviceB", ctx.document.id, { baseRevision: "2", label: "b" });
  const commits = ctx.server.state.calls.filter((c) => c.method === "POST" && c.path.endsWith("/versions/commit"));
  assert.equal(commits.length, 2);
  for (const call of commits) {
    assert.deepEqual(Object.keys(call.body).sort(), ["base_revision", "upload_id"]);
    assert.equal(typeof call.body.base_revision, "string");
  }
  assert.equal(commits[0].headers["Idempotency-Key"], "k-commit");
});

test("a lookup 410 is parsed from the real envelope {error:{code,fields}} and a 200 from CommitIntentSDO", async () => {
  const ctx = createFakeCaseContext(selectServerCases(casesDoc, { caseId: "FQ-10" })[0]);
  const unknown = await ctx.lookupViaProxy("deviceA", ctx.document.id, { idempotencyKey: "never-sent" });
  assert.equal(unknown.status, 410);
  assert.equal(errorCodeOf(unknown.body), "commit_intent_unknown");
  assert.equal(unknown.body.error.fields.outcome, "unknown");
  assert.equal(describeResponse(unknown), "410:commit_intent_unknown");
  assert.equal(unknown.body.outcome, undefined);

  const committedCtx = createFakeCaseContext(selectServerCases(casesDoc, { caseId: "FQ-05" })[0]);
  const up = await committedCtx.uploadDirect("deviceA", committedCtx.document.id, { idempotencyKey: "u", label: "v2" });
  await committedCtx.commitViaProxy("deviceA", committedCtx.document.id, { idempotencyKey: "c", uploadId: up.body.upload_id, baseRevision: "1" });
  const committed = await committedCtx.lookupViaProxy("deviceA", committedCtx.document.id, { idempotencyKey: "c" });
  assert.equal(describeResponse(committed), "200:committed");
  assert.deepEqual(Object.keys(committed.body).sort(), ["outcome", "revision", "version", "version_id"]);
  assert.equal(committed.body.revision, "2");
});

test("describeResponse names the error code of every refusal, not `undefined`", () => {
  assert.equal(describeResponse({ status: 400, body: { error: { code: "invalid_request" } } }), "400:invalid_request");
  assert.equal(describeResponse({ status: 200, body: { outcome: "not_committed" } }), "200:not_committed");
  assert.equal(describeResponse({ status: "dropped", body: null }), "dropped:");
});

test("a conflict reads fields.current_revision from the envelope as a string revision", async () => {
  const row = selectServerCases(casesDoc, { caseId: "FQ-07" })[0];
  const outcome = await runServerCaseDriver(row, createFakeCaseContext(row));
  const conflict = outcome.assertions.find((item) => item.name === "device_a_commit_409_conflict");
  assert.equal(conflict.ok, true, JSON.stringify(conflict));
  assert.match(conflict.actual, /^409:document_version_conflict:\d+$/);
});

test("the AI turn sends {messages:[{role:user}]} and continues with the X-UniWork-AI-Conversation header", async () => {
  assert.equal(CONVERSATION_HEADER, "X-UniWork-AI-Conversation");
  assert.deepEqual(aiTurnBody("hi"), { messages: [{ role: "user", content: "hi" }] });
  const row = selectServerCases(casesDoc, { caseId: "FQ-11" })[0];
  const ctx = createFakeCaseContext(row);
  const outcome = await runServerCaseDriver(row, ctx);
  assert.equal(evaluateCaseResult({ caseId: row.id, ac: row.ac, assertions: outcome.assertions }).result, "PASS");
  const turns = ctx.server.state.calls.filter((c) => c.path.endsWith("/ai/uniwork/chat/completions"));
  assert.equal(turns.length, 2);
  assert.equal(turns[0].headers[CONVERSATION_HEADER], undefined);
  assert.match(turns[1].headers[CONVERSATION_HEADER], /^conv_/);
  assert.equal(ctx.server.state.continuedTurns, 1);
});

test("restore then move sends a string revision and parent_id, a folder is created with kind folder", async () => {
  assert.deepEqual(folderBody("F"), { title: "F", kind: "folder" });
  assert.deepEqual(moveBody({ parentId: "fld_1", revision: "3" }), { parent_id: "fld_1", revision: "3" });
  assert.deepEqual(moveBody({ revision: "3" }), { parent_id: null, revision: "3" });
  assert.throws(() => moveBody({ parentId: "fld_1", revision: 3 }), /revision must be a decimal string/);
  const ctx = createFakeCaseContext(selectServerCases(casesDoc, { caseId: "FQ-13" })[0]);
  await ctx.archiveDocumentDirect(ctx.document.id);
  const restored = await ctx.restoreAndMoveDocumentDirect(ctx.document.id);
  assert.equal(restored.revision, "3");
  const move = ctx.server.state.calls.find((c) => c.path.endsWith("/move"));
  assert.equal(move.body.revision, "2");
  assert.equal(move.body.parent_id, "folder_1");
});

test("workspace member removal targets /workspaces/{ws}/members/{userId} and answers 204", async () => {
  const ctx = createFakeCaseContext(selectServerCases(casesDoc, { caseId: "FQ-12" })[0]);
  const rev = await ctx.removeWorkspaceMemberDirect("memberB");
  assert.equal(rev.status, 204);
  const call = ctx.server.state.calls.find((c) => c.method === "DELETE");
  assert.equal(call.path, "/api/v1/workspaces/ws_1/members/user_memberB");
});

test("createWireContext builds each upload as a multipart file with the Idempotency-Key header", async () => {
  const calls = [];
  const ok = { ok: true, status: 201, body: { upload_id: "up_1" }, dropped: false };
  const wire = createWireContext({
    http: async () => ok,
    multipart: async (origin, path, opts) => {
      calls.push({ origin, path, opts });
      return ok;
    },
    apiOrigin: "http://api",
    proxyOrigin: "http://proxy",
    tenant: { workspaceId: "ws", tokens: { deviceA: "t" }, users: {} },
    doc: { id: "d", revision: "1" },
    caseId: "FQ-01",
    fixture: { bytes: Buffer.from("abc"), mime: "application/pdf", filename: "a.pdf" },
    newKey: (p) => p,
  });
  await wire.uploadViaProxy("deviceA", "d", { idempotencyKey: "k", label: "v2" });
  await wire.uploadDirect("deviceA", "d", { label: "v3" });
  assert.deepEqual(calls.map((c) => `${c.origin}${c.path}`), ["http://proxy/api/v1/documents/d/uploads", "http://api/api/v1/documents/d/uploads"]);
  assert.equal(calls[0].opts.headers["Idempotency-Key"], "k");
  assert.deepEqual(calls[1].opts.headers, {});
  assert.equal(calls[0].opts.filename, "a.pdf");
  assert.match(calls[0].opts.fileBytes.toString(), /^abc\n<!-- FQ-01:v2 -->$/);
});
