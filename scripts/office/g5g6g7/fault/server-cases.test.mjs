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

function createFakeCaseContext(caseRow, { breakCase = false } = {}) {
  const docId = `doc_${caseRow.id.toLowerCase().replace("-", "_")}`;
  const salt = `salt-${caseRow.id}`;
  const keyTag = (rawKey) => computeKeyTag(rawKey, salt);
  const ruleEngine = createRuleEngine(renderCaseRules(caseRow, { documentId: docId }));

  const state = {
    revision: 1,
    contentRevision: 1,
    archived: false,
    memberBActive: true,
    versions: [{ id: "ver_1", version: 1, revision: 1, checksum_sha256: "sha_v1" }],
    uploads: new Map(),
    uploadByIdemKey: new Map(),
    intents: new Map(),
    conversations: new Map(),
    proxyLog: [],
    keyCounter: 0,
  };

  function logProxy(method, path, status, rawIdemKey, ruleId = null) {
    state.proxyLog.push({
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

  function applyUploadDirect(actor, { idempotencyKey, label }) {
    if (actor === "memberB" && !state.memberBActive) {
      return { ok: false, status: 404, body: { error: { code: "not_found" } }, dropped: false };
    }
    const dedupeKey = idempotencyKey ? `${actor}:${idempotencyKey}` : null;
    if (dedupeKey && state.uploadByIdemKey.has(dedupeKey)) {
      return { ok: true, status: 201, body: state.uploadByIdemKey.get(dedupeKey), dropped: false };
    }
    const uploadId = `upl_${state.uploads.size + 1}_${label}`;
    const rec = { upload_id: uploadId, checksum_sha256: `sha256_${label}`, size_bytes: 128 };
    state.uploads.set(uploadId, rec);
    if (dedupeKey) state.uploadByIdemKey.set(dedupeKey, rec);
    return { ok: true, status: 201, body: rec, dropped: false };
  }

  function applyCommitDirect(actor, { idempotencyKey, uploadId, baseRevision }) {
    if (actor === "memberB" && !state.memberBActive) {
      return { ok: false, status: 404, body: { error: { code: "not_found" } }, dropped: false };
    }
    const existingIntent = state.intents.get(idempotencyKey);
    if (existingIntent && existingIntent.status === "committed") {
      return {
        ok: true,
        status: 200,
        body: { document: { id: docId, revision: String(existingIntent.revision) }, version: existingIntent.versionObj },
        dropped: false,
      };
    }
    if (state.archived) {
      state.intents.set(idempotencyKey, { actor, status: "not_committed" });
      return { ok: false, status: 410, body: { error: { code: "document_deleted" } }, dropped: false };
    }
    const baseNum = Number(baseRevision);
    if (!(state.contentRevision <= baseNum && baseNum <= state.revision)) {
      state.intents.set(idempotencyKey, { actor, status: "not_committed" });
      return {
        ok: false,
        status: 409,
        body: { error: { code: "document_version_conflict", fields: { current_revision: String(state.revision) } } },
        dropped: false,
      };
    }
    state.revision += 1;
    state.contentRevision = state.revision;
    const up = state.uploads.get(uploadId) ?? { checksum_sha256: "sha_unknown" };
    const verNum = breakCase ? state.versions.length : state.versions.length + 1;
    const versionObj = { id: `ver_${verNum}`, document_id: docId, version: verNum, revision: state.revision, checksum_sha256: up.checksum_sha256 };
    if (!breakCase) state.versions.push(versionObj);
    state.intents.set(idempotencyKey, { actor, status: "committed", versionObj, revision: state.revision });
    return { ok: true, status: 200, body: { document: { id: docId, revision: String(state.revision) }, version: versionObj }, dropped: false };
  }

  function applyLookupDirect(actor, { idempotencyKey }) {
    const intent = state.intents.get(idempotencyKey);
    const sameUser =
      intent &&
      (intent.actor === actor ||
        (intent.actor === "deviceA" && actor === "deviceB") ||
        (intent.actor === "deviceB" && actor === "deviceA"));
    if (!intent || !sameUser) {
      return { ok: false, status: 410, body: { error: { code: "commit_intent_unknown", fields: { outcome: "unknown" } } }, dropped: false };
    }
    if (intent.status === "committed") {
      return {
        ok: true,
        status: 200,
        body: { outcome: "committed", version_id: intent.versionObj.id, version: intent.versionObj.version, revision: String(intent.revision) },
        dropped: false,
      };
    }
    return { ok: true, status: 200, body: { outcome: "not_committed" }, dropped: false };
  }

  async function throughProxy(method, path, rawIdemKey, executeUpstream, signal) {
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

  return {
    document: { id: docId, revision: "1" },
    beforeCount: 1,
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))),
    newKey: (prefix) => `${prefix}-${++state.keyCounter}`,
    keyTag,
    uploadViaProxy: (actor, dId, opts) =>
      throughProxy("POST", `/api/v1/documents/${dId}/uploads`, opts.idempotencyKey, () => applyUploadDirect(actor, opts)),
    uploadDirect: async (actor, _dId, opts) => applyUploadDirect(actor, opts),
    commitViaProxy: (actor, dId, opts) =>
      throughProxy("POST", `/api/v1/documents/${dId}/versions/commit`, opts.idempotencyKey, () => applyCommitDirect(actor, opts), opts.signal),
    lookupViaProxy: (actor, dId, opts) =>
      throughProxy("GET", `/api/v1/documents/${dId}/versions/commit`, opts.idempotencyKey, () => applyLookupDirect(actor, opts)),
    getDocumentViaProxy: async (_actor, dId) => {
      logProxy("GET", `/api/v1/documents/${dId}`, 200, null, null);
      return { ok: true, status: 200, body: { document: { id: dId, revision: String(state.revision) } } };
    },
    uploadAndCommitDirect: async (actor, _dId, { baseRevision, label = "direct" }) => {
      const up = applyUploadDirect(actor, { idempotencyKey: `up-dir-${++state.keyCounter}`, label });
      return applyCommitDirect(actor, { idempotencyKey: `com-dir-${++state.keyCounter}`, uploadId: up.body.upload_id, baseRevision });
    },
    seedFailedIntentDirect: async (actor) => {
      const kA = `seed-k-${++state.keyCounter}`;
      const up = applyUploadDirect(actor, { idempotencyKey: `up-seed-${++state.keyCounter}`, label: "seed" });
      applyCommitDirect(actor, { idempotencyKey: kA, uploadId: up.body.upload_id, baseRevision: 999999 });
      return kA;
    },
    aiTurnViaProxy: async (actor, dId, { conversationId = "" }) => {
      const path = `/api/v1/documents/${dId}/ai/uniwork/chat/completions`;
      if (actor === "memberB" && !state.memberBActive) {
        if (conversationId) state.conversations.delete(conversationId);
        logProxy("POST", path, 404, null, null);
        return { ok: false, status: 404, body: { error: { code: "not_found" } }, conversationId: "" };
      }
      const convId = conversationId || `conv_${++state.keyCounter}`;
      state.conversations.set(convId, { actor, docId: dId });
      logProxy("POST", path, 200, null, null);
      return { ok: true, status: 200, body: { choices: [{ message: { role: "assistant", content: "ok" } }] }, conversationId: convId };
    },
    removeWorkspaceMemberDirect: async () => {
      state.memberBActive = false;
      return { ok: true, status: 204, body: null };
    },
    archiveDocumentDirect: async () => {
      state.archived = true;
      return { ok: true, status: 200, body: {} };
    },
    restoreAndMoveDocumentDirect: async () => {
      state.archived = false;
      state.revision += 2;
      return { revision: String(state.revision) };
    },
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
        if (state.proxyLog.filter(pred).length >= minCount) return state.proxyLog;
        await new Promise((r) => setTimeout(r, 5));
      }
      return state.proxyLog;
    },
    collectVersions: async () => ({ document_id: docId, versions: [...state.versions], next_cursor: null }),
    collectCaseEnd: async () => ({
      afterVersions: { document_id: docId, versions: [...state.versions], next_cursor: null },
      versionDelta: state.versions.length - 1,
      proxyLog: [...state.proxyLog],
      proxyLogRaw: `${state.proxyLog.map((e) => JSON.stringify(e)).join("\n")}\n`,
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
