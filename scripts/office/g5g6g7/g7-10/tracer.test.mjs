/* global Buffer, URL, Response */
// Failing-first unit + contract tests for the G7-10 P1 tracer loop driver
// (UNI-1379). Covers:
//   1. Every route in TRACER_API_CALLS matches a real route in
//      server/internal/handler/router (method, path, param target, SDI fields).
//   2. Start-gate propagation: a failed start.sh fails the tracer (exit 1);
//      a blocked start.sh blocks the tracer (exit 77).
//   3. Loop 1 (fx-xlsx-revenue-xyz, G5-A03 / G6-A03):
//      - deterministic X/Y/Z workbook builder embeds expected X/Y/Z strings;
//      - under AI_PROVIDER=fake (or ai_disabled), proves the 0-version AI turn
//        invariant + web frame save -> v2 + workspace change feed delivery, and
//        returns BLOCKED (77) with "no real upstream on this runner; contract-p0 §8"
//        and owner "g7-qa" (never PASS);
//      - if the AI turn itself creates a server version, returns FAIL (1);
//      - if the change feed omits v2 after web save, returns FAIL (1).
//   4. Loop 2 (fx-docx-report-vi, G6-A03 / G5-A03):
//      - counts server versions before and after the AI turn; if versions
//        increase on the AI turn itself, returns FAIL (1);
//      - proves explicit Save creates v2 and commit-intent lookup reconciles,
//        while reporting BLOCKED (77) for the real-model edit segment under
//        AI_PROVIDER=fake;
//   5. Loop 3 (fx-docx-report-vi, G5-A05):
//      - proves offline intent lookup -> commit -> idempotent retry/reconcile
//        produces exactly one v2 receipt;
//      - when the headless VM has no desktop sign-in (session.bin), returns
//        BLOCKED (77) naming the desktop sign-in / keyring precondition;
//      - when signed in and the app settles binding.json to v2 saved receipt,
//        returns PASS (0);
//      - when signed in and binding.json settles to error/conflict, returns FAIL (1).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  paramKind,
  pathParamTarget,
  routeCatalogue,
  sdiFields,
} from "../harness/server-contract.helper.mjs";
import {
  BLOCKED_EXIT,
  TRACER_API_CALLS,
  UPSTREAM_BLOCKED_REASON,
  WEB_SHEETS_HOST_SELECTOR,
  WEB_SHEETS_IFRAME_SELECTOR,
  WEB_SHEETS_READY_SELECTOR,
  buildEditedDocxFixtureBytes,
  buildXlsxRevenueWithXyzBytes,
  classifyAiResponse,
  connectAppController,
  decideAppSignInOutcome,
  decideLoop1Outcome,
  decideLoop2Outcome,
  decideLoop3Outcome,
  interpretCommitIntentLookup,
  listAppSyncIntentFiles,
  parseArgs,
  runTracerLoop,
} from "./tracer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function makeScratchRunDir({ startState = "up", startReason = "", skipApp = false, signedIn = false, userId = "01JTESTUSER000000000000001" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "g7-10-tracer-test-"));
  const userData = join(dir, "userdata");
  const shellDir = join(dir, "shell");
  const electronBin = join(dir, "fake-electron");
  mkdirSync(join(userData, "uniwork-auth"), { recursive: true });
  mkdirSync(shellDir, { recursive: true });
  writeFileSync(electronBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  if (signedIn) {
    writeFileSync(join(userData, "uniwork-auth", "session.bin"), Buffer.from("sealed-session-bytes"));
  }
  writeFileSync(
    join(dir, "start-status.json"),
    `${JSON.stringify({ state: startState, reason: startReason })}\n`,
  );
  const lines = [
    "API_ORIGIN=http://localhost:18080",
    "WEB_ORIGIN=http://localhost:13000",
  ];
  if (!skipApp) {
    lines.push(
      "DISPLAY=:99",
      `UNIWORK_USER_DATA=${userData}`,
      `ELECTRON_BIN=${electronBin}`,
      `SHELL_APP_DIR=${shellDir}`,
      "HARNESS_DEPLOYMENT_ID=default",
    );
  }
  writeFileSync(join(dir, "ports.env"), `${lines.join("\n")}\n`);
  return { dir, userData, userId, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * In-memory fake of the D server routes used by the 3 tracer loops.
 */
function createMockDServer({
  aiMode = "fake", // "fake" | "disabled" | "real-xyz" | "buggy-auto-save"
  omitFromChangeFeed = false,
  userId = "01JTESTUSER000000000000001",
} = {}) {
  const state = {
    docId: "01JDOC00000000000000000001",
    orgId: "01JORG00000000000000000001",
    wsId: "01JWS000000000000000000001",
    versions: [],
    uploads: new Map(),
    intents: new Map(),
    calls: [],
    aiTurns: 0,
  };

  const fetchImpl = async (urlStr, init = {}) => {
    const url = new URL(urlStr);
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname;
    state.calls.push({ method, path, search: url.search, headers: init.headers ?? {} });

    const json = (status, payload) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (method === "POST" && path === "/api/v1/auth/register") {
      return json(201, { access_token: "tok-session", user: { id: userId } });
    }
    if (method === "POST" && path === "/api/v1/me/email/verify") {
      return json(200, { verified: true });
    }
    if (method === "POST" && path === "/api/v1/orgs") {
      return json(201, { organization: { id: state.orgId, slug: "o-g710" } });
    }
    if (method === "POST" && path === `/api/v1/orgs/${state.orgId}/workspaces`) {
      return json(201, { workspace: { id: state.wsId, slug: "w-g710" } });
    }
    if (method === "POST" && path === "/api/v1/me/onboarding/complete") {
      state.onboarded = true;
      return json(200, { user: { id: userId, onboarding_completed_at: "2026-10-14T19:00:00Z" } });
    }
    if (method === "POST" && path === `/api/v1/workspaces/${state.wsId}/documents/files`) {
      if (state.failUpload500) {
        return json(500, { error: { code: "internal_error", message: "simulated server error" } });
      }
      const form = init.body;
      const file = form.get("file");
      const bytes = Buffer.from(await file.arrayBuffer());
      const v1 = {
        id: "01JVER00000000000000000001",
        version: 1,
        revision: "01JREV00000000000000000001",
        checksum_sha256: sha256Hex(bytes),
        size_bytes: bytes.length,
        filename: file.name || "fixture.bin",
        bytes,
      };
      state.versions = [v1];
      return json(201, {
        document: {
          id: state.docId,
          workspace_id: state.wsId,
          organization_id: state.orgId,
          title: v1.filename,
          revision: v1.revision,
          current_version: 1,
        },
      });
    }
    if (method === "POST" && path === `/api/v1/documents/${state.docId}/office/frame-token`) {
      return json(200, {
        token: "tok-frame",
        expires_in: 300,
        document_id: state.docId,
        workspace_id: state.wsId,
        organization_id: state.orgId,
        can_edit: true,
        module: "sheets",
        ai: { ai: true, uniwork_ai: aiMode !== "disabled" },
      });
    }
    if (method === "GET" && path === `/api/v1/office-frame/documents/${state.docId}`) {
      const latest = state.versions.at(-1);
      return json(200, {
        document_id: state.docId,
        workspace_id: state.wsId,
        organization_id: state.orgId,
        revision: latest.revision,
        title: latest.filename,
        module: "sheets",
        can_edit: true,
        file: {
          version_id: latest.id,
          version: latest.version,
          filename: latest.filename,
          checksum_sha256: latest.checksum_sha256,
          size_bytes: latest.size_bytes,
        },
        download_url: `/api/v1/office-frame/documents/${state.docId}/content`,
      });
    }
    if (method === "GET" && path === `/api/v1/office-frame/documents/${state.docId}/content`) {
      const latest = state.versions.at(-1);
      return new Response(latest.bytes, { status: 200 });
    }
    if (method === "GET" && path === `/api/v1/documents/${state.docId}`) {
      const latest = state.versions.at(-1);
      return json(200, {
        document: {
          id: state.docId,
          workspace_id: state.wsId,
          organization_id: state.orgId,
          title: latest.filename,
          revision: latest.revision,
          current_version: latest.version,
          file: {
            version_id: latest.id,
            version: latest.version,
            filename: latest.filename,
            checksum_sha256: latest.checksum_sha256,
            size_bytes: latest.size_bytes,
          },
        },
      });
    }
    if (method === "GET" && path === `/api/v1/documents/${state.docId}/versions`) {
      return json(200, {
        versions: state.versions.map((v) => ({
          id: v.id,
          version: v.version,
          checksum_sha256: v.checksum_sha256,
          size_bytes: v.size_bytes,
        })),
      });
    }
    if (
      method === "POST" &&
      (path === `/api/v1/office-frame/documents/${state.docId}/ai/uniwork/chat/completions` ||
        path === `/api/v1/documents/${state.docId}/ai/uniwork/chat/completions`)
    ) {
      state.aiTurns += 1;
      if (aiMode === "buggy-auto-save") {
        const prev = state.versions.at(-1);
        state.versions.push({
          ...prev,
          id: "01JVERBUGGYAUTOSAVE0000002",
          version: prev.version + 1,
          revision: "01JREVBUGGYAUTOSAVE0000002",
        });
      }
      if (aiMode === "disabled" || aiMode === "503-disabled") {
        return json(503, { error: { code: "ai_disabled", message: "AI chưa được cấu hình trên server" } });
      }
      const content =
        aiMode === "real-xyz"
          ? JSON.stringify({
              upstream: "real",
              xyz: [
                { region: "Miền Bắc", X: 270, Y: 30, Z: 0.25 },
                { region: "Miền Trung", X: 175, Y: 15, Z: 0.1875 },
                { region: "Miền Nam", X: 460, Y: 40, Z: 0.1905 },
              ],
            })
          : "[fake provider] stub response";
      return json(200, {
        id: "chatcmpl-test",
        model: aiMode === "real-xyz" ? "uniwork-real" : "fake-stub",
        provider: aiMode === "real-xyz" ? "upstream" : "fake",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      });
    }
    if (
      method === "POST" &&
      (path === `/api/v1/office-frame/documents/${state.docId}/uploads` ||
        path === `/api/v1/documents/${state.docId}/uploads`)
    ) {
      if (state.failSecondUpload) {
        return json(500, { error: { code: "storage_error", message: "simulated upload failure" } });
      }
      const form = init.body;
      const file = form.get("file");
      const bytes = Buffer.from(await file.arrayBuffer());
      const uploadId = `01JUPL0000000000000000000${state.uploads.size + 1}`;
      const rec = {
        upload_id: uploadId,
        checksum_sha256: sha256Hex(bytes),
        size_bytes: bytes.length,
        filename: file.name || "updated.bin",
        bytes,
      };
      state.uploads.set(uploadId, rec);
      return json(201, {
        upload_id: rec.upload_id,
        checksum_sha256: rec.checksum_sha256,
        size_bytes: rec.size_bytes,
      });
    }
    if (
      method === "POST" &&
      (path === `/api/v1/office-frame/documents/${state.docId}/versions/commit` ||
        path === `/api/v1/documents/${state.docId}/versions/commit`)
    ) {
      const idemKey = init.headers?.["Idempotency-Key"] ?? init.headers?.["idempotency-key"] ?? "";
      if (idemKey && state.intents.has(idemKey)) {
        const existing = state.intents.get(idemKey);
        return json(200, existing.response);
      }
      const body = JSON.parse(init.body);
      const latest = state.versions.at(-1);
      if (body.base_revision !== latest.revision) {
        return json(409, { error: { code: "revision_conflict" } });
      }
      const upload = state.uploads.get(body.upload_id);
      const nextNum = latest.version + 1;
      const nextVer = {
        id: `01JVER0000000000000000000${nextNum}`,
        version: nextNum,
        revision: `01JREV0000000000000000000${nextNum}`,
        checksum_sha256: upload.checksum_sha256,
        size_bytes: upload.size_bytes,
        filename: latest.filename,
        bytes: upload.bytes,
      };
      state.versions.push(nextVer);
      const response = {
        document: {
          id: state.docId,
          workspace_id: state.wsId,
          organization_id: state.orgId,
          revision: nextVer.revision,
          current_version: nextVer.version,
        },
        version: {
          id: nextVer.id,
          version: nextVer.version,
          checksum_sha256: nextVer.checksum_sha256,
          size_bytes: nextVer.size_bytes,
        },
      };
      if (idemKey) {
        state.intents.set(idemKey, { state: "committed", version: nextVer, response });
      }
      return json(200, response);
    }
    if (method === "GET" && path === `/api/v1/documents/${state.docId}/versions/commit`) {
      const idemKey = init.headers?.["Idempotency-Key"] ?? init.headers?.["idempotency-key"] ?? "";
      if (idemKey && state.intents.has(idemKey)) {
        const entry = state.intents.get(idemKey);
        if (entry.state === "in_flight") {
          return json(200, { outcome: "in_flight" });
        }
        if (entry.state === "not_committed") {
          return json(200, { outcome: "not_committed" });
        }
        const hit = entry.version;
        return json(200, {
          outcome: "committed",
          version_id: hit.id,
          version: hit.version,
          revision: hit.revision,
        });
      }
      // G5-07 contract (server/internal/service/document_commit_intent.go:193-197):
      // A key the server holds no intent for answers 410 commit_intent_unknown with fields.outcome="unknown".
      return json(410, {
        error: {
          code: "commit_intent_unknown",
          message: "máy chủ không còn thông tin về lần lưu này",
          fields: { outcome: "unknown" },
        },
      });
    }
    if (method === "GET" && path === `/api/v1/workspaces/${state.wsId}/documents/changes`) {
      const cursor = url.searchParams.get("cursor");
      const latest = state.versions.at(-1);
      const reported = omitFromChangeFeed ? state.versions[0] : latest;
      // Match exact server SDO contract (server/internal/handler/dto/sdo/document_changes.go:7-47):
      // Snapshot rows (DocumentChangeSDO) and incremental feed rows (DocumentChangeFeedSDO) carry
      // document_id, kind, revision (decimal string), current_version (int32), and version_id —
      // NEVER `version` or `checksum_sha256`.
      if (!cursor) {
        const snapshotItem = {
          document_id: state.docId,
          kind: "file",
          revision: String(reported.revision),
          current_version: reported.version,
          version_id: reported.id,
        };
        return json(200, {
          phase: "snapshot",
          changes: [snapshotItem],
          feed: [],
          has_more: false,
          next_cursor: `cur-v${reported.version}`,
          expires_at: "2026-10-21T00:00:00Z",
        });
      }
      const feedItem = {
        document_id: state.docId,
        change_kind: "upsert",
        kind: "file",
        revision: String(reported.revision),
        current_version: reported.version,
        version_id: reported.id,
        archived: false,
        removal: "",
      };
      const feedItems = omitFromChangeFeed ? [] : [feedItem];
      return json(200, {
        phase: "feed",
        changes: [],
        feed: feedItems,
        has_more: false,
        next_cursor: `cur-v${reported.version}`,
        expires_at: "2026-10-21T00:00:00Z",
      });
    }
    if (method === "GET" && path === "/api/v1/auth/desktop/authorize") {
      const attemptId = url.searchParams.get("attempt_id") ?? "";
      return json(200, {
        status: "pending",
        attempt_id: attemptId,
        account_id: userId,
        csrf_token: "csrf-test-token",
      });
    }
    if (method === "POST" && path === "/api/v1/auth/desktop/authorize") {
      if (state.failDesktopConsent) {
        return json(500, { error: { code: "internal_error", message: "consent failed" } });
      }
      const body = JSON.parse(init.body);
      return json(200, {
        status: "approved",
        callback_url: `uniwork-office-dev://auth/callback?code=code-${body.attempt_id}&state=st-test`,
      });
    }
    if (method === "POST" && path === `/api/v1/documents/${state.docId}/office/sessions`) {
      return json(200, { ticket: "tkt-123" });
    }
    if (method === "POST" && path === `/api/v1/orgs/${state.orgId}/privacy/deletion`) {
      state.orgDeletionRequested = true;
      return json(202, { status: "scheduled" });
    }
    return json(404, { error: { code: "not_found", path } });
  };
  fetchImpl.allowRealAiUpstream = aiMode === "real-xyz";

  return { state, fetchImpl };
}

describe("G7-10 tracer API call contract against server/internal/handler", () => {
  const routes = routeCatalogue();
  const officeFrameAiRouter = readFileSync(
    join(REPO_ROOT, "server/internal/handler/router/office_frame_ai.go"),
    "utf8",
  );
  const baseMatch = officeFrameAiRouter.match(/const\s+base\s*=\s*"([^"]+)"/);
  if (baseMatch) {
    for (const m of officeFrameAiRouter.matchAll(
      /\.(Get|Post|Put|Patch|Delete)\(\s*base\s*\+\s*"(\/[^"]*)"\s*,\s*h\.(\w+)/g,
    )) {
      routes.push({
        method: m[1].toUpperCase(),
        path: `${baseMatch[1]}${m[2]}`,
        handler: m[3],
      });
    }
  }

  for (const [name, call] of Object.entries(TRACER_API_CALLS)) {
    it(`${name} (${call.method} ${call.path}) is registered in the Go router with matching params and SDI fields`, () => {
      const route = routes.find((r) => r.method === call.method && r.path === call.path);
      assert.ok(route, `no route ${call.method} ${call.path} in server/internal/handler/router`);
      for (const [param, kind] of Object.entries(call.params ?? {})) {
        assert.ok(call.path.includes(`{${param}}`), `${name} declares {${param}} but the path has none`);
        if (param.endsWith("ID")) {
          assert.equal(kind, "id", `${name}: {${param}} ends in ID so kind must be "id"`);
        } else {
          const target = pathParamTarget(route.handler, param);
          assert.ok(target, `${name}: {${param}} must resolve via pathParamTarget`);
          assert.equal(
            paramKind(target.name),
            kind,
            `${name}: {${param}} reaches ${target.method} as "${target.name}" (${paramKind(target.name)}), expected ${kind}`,
          );
        }
      }
      if (call.sdi) {
        const fields = sdiFields(call.sdi);
        for (const key of call.body ?? []) {
          assert.ok(key in fields, `${name}: ${call.sdi} has no json field "${key}"`);
        }
        for (const [key, { required }] of Object.entries(fields)) {
          if (required) {
            assert.ok((call.body ?? []).includes(key), `${name}: ${call.sdi} requires "${key}"`);
          }
        }
      }
    });
  }
});

describe("G7-10 deterministic fixture builders", () => {
  it("buildXlsxRevenueWithXyzBytes embeds the manifest's expected X/Y/Z values into a valid ZIP/XLSX", () => {
    const { bytes, sha256, expectedXyz } = buildXlsxRevenueWithXyzBytes();
    assert.equal(bytes.subarray(0, 4).toString("binary"), "PK\x03\x04");
    assert.equal(sha256, sha256Hex(bytes));
    assert.equal(expectedXyz.length, 3);
    const raw = bytes.toString("utf8");
    assert.match(raw, /270/);
    assert.match(raw, /175/);
    assert.match(raw, /460/);
    assert.match(raw, /0\.25/);
  });

  it("buildEditedDocxFixtureBytes produces a valid deterministic v2 DOCX distinct from v1", () => {
    const { v1Sha256, v2Bytes, v2Sha256 } = buildEditedDocxFixtureBytes();
    assert.equal(v2Bytes.subarray(0, 4).toString("binary"), "PK\x03\x04");
    assert.notEqual(v1Sha256, v2Sha256);
    assert.equal(v2Sha256, sha256Hex(v2Bytes));
  });
});

describe("G7-10 tracer CLI args and start-gate propagation", () => {
  it("parseArgs resolves --loop aliases 1/2/3 and named slugs", () => {
    assert.equal(parseArgs(["--loop", "1"]).loop, "1");
    assert.equal(parseArgs(["--loop", "xlsx-web-to-app"]).loop, "1");
    assert.equal(parseArgs(["--loop", "2"]).loop, "2");
    assert.equal(parseArgs(["--loop", "docx-ai-save-app"]).loop, "2");
    assert.equal(parseArgs(["--loop", "3"]).loop, "3");
    assert.equal(parseArgs(["--loop", "docx-offline-save-app"]).loop, "3");
  });

  it("fails (exit 1) when start-status.json reports failed", async () => {
    const scratch = makeScratchRunDir({ startState: "failed", startReason: "server build failed" });
    try {
      const res = await runTracerLoop({ loop: "1", runDir: scratch.dir, repoRoot: REPO_ROOT });
      assert.equal(res.exitCode, 1);
      assert.equal(res.status, "FAIL");
      assert.match(res.reason, /server build failed/);
    } finally {
      scratch.cleanup();
    }
  });

  it("blocks (exit 77) when start-status.json reports blocked", async () => {
    const scratch = makeScratchRunDir({ startState: "blocked", startReason: "missing xvfb" });
    try {
      const res = await runTracerLoop({ loop: "1", runDir: scratch.dir, repoRoot: REPO_ROOT });
      assert.equal(res.exitCode, BLOCKED_EXIT);
      assert.equal(res.status, "BLOCKED");
      assert.match(res.reason, /missing xvfb/);
    } finally {
      scratch.cleanup();
    }
  });
});

describe("G7-10 pure outcome decision functions (G710-L1..L3)", () => {
  it("decideLoop1Outcome refuses PASS when web save or app feed observation is protocol-only, and PASSes only when web UI + app + real AI all hold", () => {
    const valid = {
      versionsBeforeTurn: 1,
      versionsAfterTurn: 1,
      versionsAfterSave: 2,
      v2ContainsExpectedXyz: true,
      changeFeedDeliveredV2: true,
      aiRealUpstream: true,
      webUiDriven: true,
      webSaveSource: "web",
      appSignedIn: true,
      appDriven: true,
      appOpenedV1: true,
      appObservedV2ViaFeed: true,
      appObservedV2Source: "app",
    };
    assert.equal(decideLoop1Outcome(valid).status, "PASS");
    assert.equal(decideLoop1Outcome(valid).exitCode, 0);

    // G710-L1: protocol-only web save or feed poll must never PASS
    assert.notEqual(decideLoop1Outcome({ ...valid, webUiDriven: false, webSaveSource: "protocol" }).status, "PASS");
    assert.equal(decideLoop1Outcome({ ...valid, webUiDriven: false, webSaveSource: "protocol" }).status, "BLOCKED");
    assert.notEqual(
      decideLoop1Outcome({ ...valid, appObservedV2ViaFeed: false, appObservedV2Source: "protocol" }).status,
      "PASS",
    );
    // G710-L3: signed-in driven app that fails to reload v2 from the change feed is FAIL
    assert.equal(
      decideLoop1Outcome({ ...valid, appObservedV2ViaFeed: false, appObservedV2Source: "app" }).status,
      "FAIL",
    );
    // Without a signed-in app, Loop 1 is BLOCKED (77)
    assert.equal(
      decideLoop1Outcome({ ...valid, appSignedIn: false, appDriven: false, appObservedV2ViaFeed: false }).status,
      "BLOCKED",
    );
    // G6-A03: AI turn creating a version is always FAIL (1)
    assert.equal(decideLoop1Outcome({ ...valid, versionsAfterTurn: 2 }).status, "FAIL");
  });

  it("decideLoop2Outcome refuses PASS when save is protocol-only, FAILs on auto-save or queued intent during AI turn, and PASSes only when app saves + real AI", () => {
    const valid = {
      versionsBeforeTurn: 1,
      versionsAfterTurn: 1,
      versionsAfterSave: 2,
      commitIntentOutcome: "committed",
      aiRealUpstream: true,
      appSignedIn: true,
      appDriven: true,
      appOpenedV1: true,
      appIntentsAfterTurn: 0,
      appSavedV2: true,
      saveSource: "app",
    };
    assert.equal(decideLoop2Outcome(valid).status, "PASS");
    assert.equal(decideLoop2Outcome(valid).exitCode, 0);

    // G710-L1: protocol-only save must never PASS
    assert.equal(
      decideLoop2Outcome({ ...valid, appSignedIn: false, appDriven: false, appSavedV2: false, saveSource: "protocol" }).status,
      "BLOCKED",
    );
    // G6-A03: AI turn queueing an app intent or creating a version before Save is FAIL
    assert.equal(decideLoop2Outcome({ ...valid, appIntentsAfterTurn: 1 }).status, "FAIL");
    assert.equal(decideLoop2Outcome({ ...valid, versionsAfterTurn: 2 }).status, "FAIL");
  });

  it("decideLoop3Outcome FAILs the r1 false-PASS path (test-made HTTP commit + app opens v2) and PASSes only when app opens v1, holds offline intent while cut, and commits v2 on reconnect (G710-L2)", () => {
    const valid = {
      appSignedIn: true,
      appDriven: true,
      appOpenedV1: true,
      appHeldOfflineIntentWhileCut: true,
      serverVersionsWhileCut: 1,
      testCommittedBeforeApp: false,
      commitSource: "app",
      appBindingAfterReconnect: { state: "saved", baseVersion: 2 },
      appIntentsAfterReconnect: 0,
      serverVersionsAfterReconnect: 2,
    };
    assert.equal(decideLoop3Outcome(valid).status, "PASS");
    assert.equal(decideLoop3Outcome(valid).exitCode, 0);

    // G710-L2: the r1 false-PASS path (test committed v2 over HTTP before handing app the deep link) MUST be FAIL (1), never PASS
    const r1FalsePass = decideLoop3Outcome({
      ...valid,
      appOpenedV1: false,
      appHeldOfflineIntentWhileCut: false,
      testCommittedBeforeApp: true,
      commitSource: "protocol",
      appBindingAfterReconnect: { state: "saved", baseVersion: 2 },
    });
    assert.equal(r1FalsePass.status, "FAIL");
    assert.equal(r1FalsePass.exitCode, 1);
    assert.match(r1FalsePass.reason, /protocol|test committed|v1/i);

    // Server already having v2 while the app link is cut means the cut failed or test committed early -> FAIL
    assert.equal(decideLoop3Outcome({ ...valid, serverVersionsWhileCut: 2 }).status, "FAIL");
    // App not holding offline state/intent while cut -> FAIL
    assert.equal(decideLoop3Outcome({ ...valid, appHeldOfflineIntentWhileCut: false }).status, "FAIL");
    // App not signed in or Save cannot be driven headlessly -> BLOCKED (77, owner g7-qa)
    const blockedNoApp = decideLoop3Outcome({
      ...valid,
      appSignedIn: false,
      appDriven: false,
      commitSource: "protocol",
    });
    assert.equal(blockedNoApp.status, "BLOCKED");
    assert.equal(blockedNoApp.exitCode, BLOCKED_EXIT);
  });

  it("decideAppSignInOutcome: BLOCKED (77) when keyring is absent/locked, FAIL (1) when keyring is up and sign-in fails or leaves no session.bin, PASS (0) when signed-in + session.bin", () => {
    // 1. Keyring unavailable / locked -> BLOCKED (77)
    const noKeyring = decideAppSignInOutcome({
      appStarted: true,
      cdpConnected: true,
      keyringAvailable: false,
      accountState: "keyring-unavailable",
      sessionBinExists: false,
    });
    assert.equal(noKeyring.status, "BLOCKED");
    assert.equal(noKeyring.exitCode, BLOCKED_EXIT);
    assert.equal(noKeyring.signedIn, false);

    const lockedKeystore = decideAppSignInOutcome({
      appStarted: true,
      cdpConnected: true,
      keyringAvailable: false,
      accountState: "keystore-locked",
      sessionBinExists: false,
    });
    assert.equal(lockedKeystore.status, "BLOCKED");
    assert.equal(lockedKeystore.exitCode, BLOCKED_EXIT);

    // 2. Keyring is up, sign-in throws an error -> FAIL (1) with reason
    const errWithKeyring = decideAppSignInOutcome({
      appStarted: true,
      cdpConnected: true,
      keyringAvailable: true,
      accountState: "signed-out",
      sessionBinExists: false,
      signInError: "POST /api/v1/auth/desktop/authorize -> 500",
    });
    assert.equal(errWithKeyring.status, "FAIL");
    assert.equal(errWithKeyring.exitCode, 1);
    assert.match(errWithKeyring.reason, /500/);

    // 3. Keyring is up, accountStatus did not reach signed-in -> FAIL (1)
    const notSignedIn = decideAppSignInOutcome({
      appStarted: true,
      cdpConnected: true,
      keyringAvailable: true,
      accountState: "signed-out",
      sessionBinExists: false,
    });
    assert.equal(notSignedIn.status, "FAIL");
    assert.equal(notSignedIn.exitCode, 1);

    // 4. Keyring is up, accountStatus is signed-in, but session.bin is missing on disk -> FAIL (1)
    const noSessionBin = decideAppSignInOutcome({
      appStarted: true,
      cdpConnected: true,
      keyringAvailable: true,
      accountState: "signed-in",
      sessionBinExists: false,
      signedInUserId: "01JUSER1",
      expectedUserId: "01JUSER1",
    });
    assert.equal(noSessionBin.status, "FAIL");
    assert.equal(noSessionBin.exitCode, 1);
    assert.match(noSessionBin.reason, /session\.bin/);

    // 5. Keyring is up, signed in as wrong user -> FAIL (1)
    const wrongUser = decideAppSignInOutcome({
      appStarted: true,
      cdpConnected: true,
      keyringAvailable: true,
      accountState: "signed-in",
      sessionBinExists: true,
      signedInUserId: "01JOTHER",
      expectedUserId: "01JUSER1",
    });
    assert.equal(wrongUser.status, "FAIL");
    assert.equal(wrongUser.exitCode, 1);

    // 6. Keyring is up, accountStatus is signed-in, session.bin exists on disk -> PASS (0)
    const pass = decideAppSignInOutcome({
      appStarted: true,
      cdpConnected: true,
      keyringAvailable: true,
      accountState: "signed-in",
      sessionBinExists: true,
      signedInUserId: "01JUSER1",
      expectedUserId: "01JUSER1",
    });
    assert.equal(pass.status, "PASS");
    assert.equal(pass.exitCode, 0);
    assert.equal(pass.signedIn, true);
  });

  it("decideLoop1Outcome, decideLoop2Outcome, and decideLoop3Outcome return FAIL (1) when appSignInFailureReason is set (keyring up, sign-in failed), never BLOCKED", () => {
    const l1 = decideLoop1Outcome({
      versionsBeforeTurn: 1,
      versionsAfterTurn: 1,
      versionsAfterSave: 2,
      v2ContainsExpectedXyz: true,
      changeFeedDeliveredV2: true,
      aiRealUpstream: false,
      webUiDriven: false,
      webSaveSource: "protocol",
      appSignedIn: false,
      appDriven: false,
      appSignInFailureReason: "desktop app sign-in failed while the OS keyring was available: consent 500",
    });
    assert.equal(l1.status, "FAIL");
    assert.equal(l1.exitCode, 1);
    assert.match(l1.reason, /consent 500/);

    const l2 = decideLoop2Outcome({
      versionsBeforeTurn: 1,
      versionsAfterTurn: 1,
      versionsAfterSave: 2,
      commitIntentOutcome: "committed",
      aiRealUpstream: false,
      appSignedIn: false,
      appDriven: false,
      appSignInFailureReason: "desktop app sign-in failed while the OS keyring was available: no session.bin",
    });
    assert.equal(l2.status, "FAIL");
    assert.equal(l2.exitCode, 1);
    assert.match(l2.reason, /no session\.bin/);

    const l3 = decideLoop3Outcome({
      appSignedIn: false,
      appDriven: false,
      appOpenedV1: false,
      appHeldOfflineIntentWhileCut: false,
      serverVersionsWhileCut: 1,
      appSignInFailureReason: "desktop app sign-in failed while the OS keyring was available: callback rejected",
    });
    assert.equal(l3.status, "FAIL");
    assert.equal(l3.exitCode, 1);
    assert.match(l3.reason, /callback rejected/);
  });
});

describe("G7-10 desktop app self sign-in when keyring is available (r3)", () => {
  function makeFakeCdpBrowser({
    initialState = "signed-out",
    userDataDir,
    signedInAccountId,
    writeSessionBinOnCallback = true,
    transitionToSignedInOnCallback = true,
  }) {
    let currentState = initialState;
    let currentProfile = null;
    const deliveredCallbacks = [];
    const page = {
      evaluate: async (fn) => {
        const src = String(fn);
        if (src.includes("typeof window.aiOffice")) return true;
        if (src.includes("accountStatus")) {
          return { state: currentState, profile: currentProfile };
        }
        if (src.includes("onAccountLogin") && src.includes("accountLogin")) {
          return "http://127.0.0.1:18080/auth/desktop/authorize?attempt_id=01JATTEMPT000000000000001";
        }
        return null;
      },
    };
    const browser = {
      contexts: () => [{ pages: () => [page] }],
      close: async () => {},
    };
    const deepLinkDeliverer = (_portsEnv, url) => {
      deliveredCallbacks.push(url);
      if (String(url).includes("/auth/callback")) {
        if (writeSessionBinOnCallback) {
          writeFileSync(join(userDataDir, "uniwork-auth", "session.bin"), Buffer.from("encrypted-session-bin"));
        }
        if (transitionToSignedInOnCallback) {
          currentState = "signed-in";
          currentProfile = { accountId: signedInAccountId, email: "seeded@example.com", name: "G7-10 tracer" };
        }
      }
      return { status: 0 };
    };
    return { browser, deliveredCallbacks, cdpConnector: async () => browser, deepLinkDeliverer };
  }

  it("signs the app in before Loop 1 when keyring is available and no session.bin exists yet (accountLogin -> authorize -> callback -> session.bin + signed-in)", async () => {
    const scratch = makeScratchRunDir({ startState: "up", signedIn: false });
    writeFileSync(
      join(scratch.dir, "ports.env"),
      `${readFileSync(join(scratch.dir, "ports.env"), "utf8")}APP_CDP_PORT=19222\n`,
    );
    const mock = createMockDServer({ aiMode: "fake", userId: scratch.userId });
    const fakeCdp = makeFakeCdpBrowser({
      initialState: "signed-out",
      userDataDir: scratch.userData,
      signedInAccountId: scratch.userId,
    });
    try {
      const ctrl = await connectAppController({
        portsEnv: {
          UNIWORK_USER_DATA: scratch.userData,
          ELECTRON_BIN: join(scratch.dir, "fake-electron"),
          SHELL_APP_DIR: join(scratch.dir, "shell"),
          APP_CDP_PORT: "19222",
        },
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        apiOrigin: "http://localhost:18080",
        fetchImpl: mock.fetchImpl,
        token: "tok-session",
        userId: scratch.userId,
        cdpConnector: fakeCdp.cdpConnector,
        deepLinkDeliverer: fakeCdp.deepLinkDeliverer,
      });
      assert.equal(ctrl.signedIn, true);
      assert.equal(ctrl.driven, true);
      assert.equal(ctrl.signInFailureReason ?? "", "");
      assert.equal(fakeCdp.deliveredCallbacks.length, 1);
      assert.match(fakeCdp.deliveredCallbacks[0], /^uniwork-office-dev:\/\/auth\/callback\?code=code-01JATTEMPT000000000000001/);
      await ctrl.close();
    } finally {
      scratch.cleanup();
    }
  });

  it("returns FAIL (exit 1) when the keyring is available and self sign-in fails (e.g. consent fails or session.bin is not written)", async () => {
    const scratch = makeScratchRunDir({ startState: "up", signedIn: false });
    writeFileSync(
      join(scratch.dir, "ports.env"),
      `${readFileSync(join(scratch.dir, "ports.env"), "utf8")}APP_CDP_PORT=19222\n`,
    );
    const mock = createMockDServer({ aiMode: "fake", userId: scratch.userId });
    const fakeCdp = makeFakeCdpBrowser({
      initialState: "signed-out",
      userDataDir: scratch.userData,
      signedInAccountId: scratch.userId,
      writeSessionBinOnCallback: false,
    });
    try {
      const res = await runTracerLoop({
        loop: "1",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
        cdpConnector: fakeCdp.cdpConnector,
        deepLinkDeliverer: fakeCdp.deepLinkDeliverer,
      });
      assert.equal(res.exitCode, 1);
      assert.equal(res.status, "FAIL");
      assert.match(res.reason, /session\.bin/);
    } finally {
      scratch.cleanup();
    }
  });

  it("returns BLOCKED (exit 77) when the keyring is unavailable (accountStatus.state === keyring-unavailable)", async () => {
    const scratch = makeScratchRunDir({ startState: "up", signedIn: false });
    writeFileSync(
      join(scratch.dir, "ports.env"),
      `${readFileSync(join(scratch.dir, "ports.env"), "utf8")}APP_CDP_PORT=19222\n`,
    );
    const mock = createMockDServer({ aiMode: "fake", userId: scratch.userId });
    const fakeCdp = makeFakeCdpBrowser({
      initialState: "keyring-unavailable",
      userDataDir: scratch.userData,
      signedInAccountId: scratch.userId,
    });
    try {
      const res = await runTracerLoop({
        loop: "3",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
        cdpConnector: fakeCdp.cdpConnector,
        deepLinkDeliverer: fakeCdp.deepLinkDeliverer,
      });
      assert.equal(res.exitCode, BLOCKED_EXIT);
      assert.equal(res.status, "BLOCKED");
      assert.match(res.reason, /keyring-unavailable|keyring/);
    } finally {
      scratch.cleanup();
    }
  });
});

describe("G7-10 Loop 1 (fx-xlsx-revenue-xyz: web open -> AI turn -> editor X/Y/Z save -> change feed -> app)", () => {
  it("proves 0-version AI turn + protocol diagnostic under AI_PROVIDER=fake and reports BLOCKED (77), never PASS", async () => {
    const scratch = makeScratchRunDir({ startState: "up", skipApp: true });
    const mock = createMockDServer({ aiMode: "fake" });
    try {
      const res = await runTracerLoop({
        loop: "1",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
      });
      assert.equal(res.exitCode, BLOCKED_EXIT);
      assert.equal(res.status, "BLOCKED");
      assert.equal(res.owner, "g7-qa");
      assert.match(res.reason, new RegExp(UPSTREAM_BLOCKED_REASON));
      assert.equal(res.details.versionsBeforeTurn, 1);
      assert.equal(res.details.versionsAfterTurn, 1);
      assert.equal(res.details.versionsAfterSave, 2);
      assert.equal(res.details.changeFeedDeliveredV2, true);
      assert.equal(res.details.aiSegment.status, "BLOCKED");
      assert.equal(res.details.protocolDiagnosticSegment.source, "protocol");
    } finally {
      scratch.cleanup();
    }
  });

  it("PASSes (exit 0) when app opens v1, web UI saves v2 with X/Y/Z, and app's SyncRuntime reloads binding.json to v2 (G710-L3)", async () => {
    const scratch = makeScratchRunDir({ startState: "up", signedIn: true });
    const mock = createMockDServer({ aiMode: "real-xyz" });
    try {
      const docDir = join(
        scratch.userData,
        "uniwork-documents",
        "default",
        scratch.userId,
        mock.state.docId,
      );
      const res = await runTracerLoop({
        loop: "1",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
        webDriver: async ({ apiOrigin, token, documentId }) => {
          // Simulates the real Playwright web frame saving v2 after editing X/Y/Z
          const v1 = mock.state.versions[0];
          const { bytes } = buildXlsxRevenueWithXyzBytes();
          const form = new FormData();
          form.set("file", new Blob([bytes]), "fx-xlsx-revenue-xyz.xlsx");
          const upRes = await mock.fetchImpl(`${apiOrigin}/api/v1/office-frame/documents/${documentId}/uploads`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          });
          const up = await upRes.json();
          await mock.fetchImpl(`${apiOrigin}/api/v1/office-frame/documents/${documentId}/versions/commit`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ base_revision: v1.revision, upload_id: up.upload_id }),
          });
          return { driven: true, saved: true, source: "web" };
        },
        appDriver: {
          signedIn: true,
          driven: true,
          openDocumentV1: async () => {
            mkdirSync(docDir, { recursive: true });
            const v1 = mock.state.versions[0];
            const bindingV1 = {
              schema: 2,
              documentId: mock.state.docId,
              workspaceId: mock.state.wsId,
              orgId: mock.state.orgId,
              title: "fx-xlsx-revenue-xyz.xlsx",
              filename: "fx-xlsx-revenue-xyz.xlsx",
              format: "xlsx",
              access: "edit",
              baseRevision: v1.revision,
              baseVersion: 1,
              baseVersionId: v1.id,
              baseChecksum: v1.checksum_sha256,
              state: "ready",
            };
            writeFileSync(join(docDir, "binding.json"), JSON.stringify(bindingV1));
            writeFileSync(join(docDir, "fx-xlsx-revenue-xyz.xlsx"), v1.bytes);
            return { opened: true, binding: bindingV1 };
          },
          waitForFeedReloadV2: async ({ wsId, token, apiOrigin }) => {
            // App's SyncRuntime polls the workspace change feed and guardedReload updates binding.json to v2
            const feedRes = await mock.fetchImpl(
              `${apiOrigin}/api/v1/workspaces/${wsId}/documents/changes?cursor=cur-v1&limit=50`,
              { method: "GET", headers: { Authorization: `Bearer ${token}` } },
            );
            const feed = await feedRes.json();
            const hit = [...(feed.feed ?? []), ...(feed.changes ?? [])].find(
              (c) => c.document_id === mock.state.docId && c.current_version === 2,
            );
            if (!hit) return { reloaded: false, binding: null };
            const v2 = mock.state.versions.at(-1);
            const bindingV2 = {
              schema: 2,
              documentId: mock.state.docId,
              workspaceId: mock.state.wsId,
              orgId: mock.state.orgId,
              title: "fx-xlsx-revenue-xyz.xlsx",
              filename: "fx-xlsx-revenue-xyz.xlsx",
              format: "xlsx",
              access: "edit",
              baseRevision: v2.revision,
              baseVersion: 2,
              baseVersionId: v2.id,
              baseChecksum: v2.checksum_sha256,
              state: "saved",
            };
            writeFileSync(join(docDir, "binding.json"), JSON.stringify(bindingV2));
            writeFileSync(join(docDir, "fx-xlsx-revenue-xyz.xlsx"), v2.bytes);
            return { reloaded: true, binding: bindingV2 };
          },
        },
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.status, "PASS");
      assert.equal(res.details.appOpenedV1, true);
      assert.equal(res.details.appObservedV2ViaFeed, true);
      assert.equal(res.details.webSaveSource, "web");
      assert.equal(res.details.appObservedV2Source, "app");
    } finally {
      scratch.cleanup();
    }
  });

  it("returns FAIL (1) if the AI turn auto-creates a server version (G6-A03 violation)", async () => {
    const scratch = makeScratchRunDir({ startState: "up", skipApp: true });
    const mock = createMockDServer({ aiMode: "buggy-auto-save" });
    try {
      const res = await runTracerLoop({
        loop: "1",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
      });
      assert.equal(res.exitCode, 1);
      assert.equal(res.status, "FAIL");
      assert.match(res.reason, /G6-A03|AI turn created/i);
    } finally {
      scratch.cleanup();
    }
  });

  it("returns FAIL (1) if the workspace change feed does not report v2 after web Save", async () => {
    const scratch = makeScratchRunDir({ startState: "up", skipApp: true });
    const mock = createMockDServer({ aiMode: "fake", omitFromChangeFeed: true });
    try {
      const res = await runTracerLoop({
        loop: "1",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
      });
      assert.equal(res.exitCode, 1);
      assert.equal(res.status, "FAIL");
      assert.match(res.reason, /change feed/i);
    } finally {
      scratch.cleanup();
    }
  });
});

describe("G7-10 Loop 2 (fx-docx-report-vi: AI edit turn creates 0 versions -> explicit Save creates v2)", () => {
  it("counts versions before/after AI turn (1 -> 1) and after Save (2), returning BLOCKED (77) for the fake AI upstream segment", async () => {
    const scratch = makeScratchRunDir({ startState: "up", skipApp: true });
    const mock = createMockDServer({ aiMode: "fake" });
    try {
      const res = await runTracerLoop({
        loop: "2",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
      });
      assert.equal(res.exitCode, BLOCKED_EXIT);
      assert.equal(res.status, "BLOCKED");
      assert.equal(res.owner, "g7-qa");
      assert.match(res.reason, new RegExp(UPSTREAM_BLOCKED_REASON));
      assert.equal(res.details.versionsBeforeTurn, 1);
      assert.equal(res.details.versionsAfterTurn, 1);
      assert.equal(res.details.versionsAfterSave, 2);
      assert.equal(res.details.commitIntentOutcome, "committed");
      assert.equal(res.details.noAutoSaveSegment.status, "PASS");
      assert.equal(res.details.aiEditQualitySegment.status, "BLOCKED");
    } finally {
      scratch.cleanup();
    }
  });

  it("returns FAIL (1) if the document AI turn creates a version before explicit Save", async () => {
    const scratch = makeScratchRunDir({ startState: "up", skipApp: true });
    const mock = createMockDServer({ aiMode: "buggy-auto-save" });
    try {
      const res = await runTracerLoop({
        loop: "2",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
      });
      assert.equal(res.exitCode, 1);
      assert.equal(res.status, "FAIL");
      assert.match(res.reason, /G6-A03|AI turn created/i);
    } finally {
      scratch.cleanup();
    }
  });
});

describe("G7-10 Loop 3 (fx-docx-report-vi: offline Save in app -> reconnect -> receipt)", () => {
  it("blocks (77) when the VM has no desktop sign-in and records server receipt check as protocol-only", async () => {
    const scratch = makeScratchRunDir({ startState: "up", signedIn: false });
    const mock = createMockDServer();
    try {
      const res = await runTracerLoop({
        loop: "3",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
      });
      assert.equal(res.exitCode, BLOCKED_EXIT);
      assert.equal(res.status, "BLOCKED");
      assert.equal(res.owner, "g7-qa");
      assert.match(res.reason, /signed in|session\.bin|keyring/i);
      assert.equal(res.details.protocolDiagnosticSegment.source, "protocol");
      assert.equal(res.details.protocolDiagnosticSegment.versionsAfterIdempotentRetry, 2);
    } finally {
      scratch.cleanup();
    }
  });

  it("FAILs (exit 1, never PASS) on the r1 false-PASS path where a hook only writes binding.json at v2 without v1 open and offline intent while cut (G710-L2)", async () => {
    const scratch = makeScratchRunDir({ startState: "up", signedIn: true });
    const mock = createMockDServer();
    try {
      const docDir = join(
        scratch.userData,
        "uniwork-documents",
        "default",
        scratch.userId,
        mock.state.docId,
      );
      const res = await runTracerLoop({
        loop: "3",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
        spawnAppHook: () => {
          mkdirSync(docDir, { recursive: true });
          const v1 = mock.state.versions[0];
          writeFileSync(
            join(docDir, "binding.json"),
            JSON.stringify({
              schema: 2,
              documentId: mock.state.docId,
              workspaceId: mock.state.wsId,
              orgId: mock.state.orgId,
              title: "fx-docx-report-vi.docx",
              filename: "fx-docx-report-vi.docx",
              format: "docx",
              access: "edit",
              baseRevision: v1.revision,
              baseVersion: 2,
              baseVersionId: v1.id,
              baseChecksum: v1.checksum_sha256,
              state: "saved",
              lastSavedAt: new Date().toISOString(),
            }),
          );
          writeFileSync(join(docDir, "fx-docx-report-vi.docx"), v1.bytes);
        },
      });
      assert.notEqual(res.status, "PASS");
      assert.equal(res.exitCode, 1);
      assert.equal(res.status, "FAIL");
    } finally {
      scratch.cleanup();
    }
  });

  it("PASSes (exit 0) when the app opens v1, saves while the harness proxy cuts the app link (holding offline state + .rec intent while server stays at v1), and commits v2 on reconnect (G710-L2)", async () => {
    const scratch = makeScratchRunDir({ startState: "up", signedIn: true });
    const mock = createMockDServer();
    try {
      const docDir = join(
        scratch.userData,
        "uniwork-documents",
        "default",
        scratch.userId,
        mock.state.docId,
      );
      const intentsDir = join(
        scratch.userData,
        "uniwork-sync",
        "store",
        "default",
        scratch.userId,
        "intents",
      );
      const res = await runTracerLoop({
        loop: "3",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
        appDriver: {
          signedIn: true,
          driven: true,
          openDocumentV1: async () => {
            mkdirSync(docDir, { recursive: true });
            const v1 = mock.state.versions[0];
            const bindingV1 = {
              schema: 2,
              documentId: mock.state.docId,
              workspaceId: mock.state.wsId,
              orgId: mock.state.orgId,
              title: "fx-docx-report-vi.docx",
              filename: "fx-docx-report-vi.docx",
              format: "docx",
              access: "edit",
              baseRevision: v1.revision,
              baseVersion: 1,
              baseVersionId: v1.id,
              baseChecksum: v1.checksum_sha256,
              state: "ready",
            };
            writeFileSync(join(docDir, "binding.json"), JSON.stringify(bindingV1));
            writeFileSync(join(docDir, "fx-docx-report-vi.docx"), v1.bytes);
            return { opened: true, binding: bindingV1 };
          },
          saveOfflineWhileCut: async ({ v2Bytes, v2Sha256 }) => {
            // App writes local working copy and queues encrypted .rec intent while proxy is cut
            const v1 = mock.state.versions[0];
            mkdirSync(intentsDir, { recursive: true });
            writeFileSync(join(intentsDir, "01JINTENT00000000000000001.rec"), "encrypted-intent");
            const bindingOffline = {
              schema: 2,
              documentId: mock.state.docId,
              workspaceId: mock.state.wsId,
              orgId: mock.state.orgId,
              title: "fx-docx-report-vi.docx",
              filename: "fx-docx-report-vi.docx",
              format: "docx",
              access: "edit",
              baseRevision: v1.revision,
              baseVersion: 1,
              baseVersionId: v1.id,
              baseChecksum: v1.checksum_sha256,
              state: "offline",
              error: "network",
            };
            writeFileSync(join(docDir, "binding.json"), JSON.stringify(bindingOffline));
            writeFileSync(join(docDir, "fx-docx-report-vi.docx"), v2Bytes);
            return {
              bindingWhileCut: bindingOffline,
              intentFilesWhileCut: listAppSyncIntentFiles(scratch.userData, "default", scratch.userId),
              v2Sha256,
            };
          },
          reconnectAndFlushSave: async ({ apiOrigin, token, documentId, v2Bytes }) => {
            // Proxy is back online; app's SaveCoordinator uploads + commits with Idempotency-Key and clears .rec
            const v1 = mock.state.versions[0];
            const form = new FormData();
            form.set("file", new Blob([v2Bytes]), "fx-docx-report-vi.docx");
            const upRes = await mock.fetchImpl(`${apiOrigin}/api/v1/documents/${documentId}/uploads`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
              body: form,
            });
            const up = await upRes.json();
            await mock.fetchImpl(`${apiOrigin}/api/v1/documents/${documentId}/versions/commit`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "Idempotency-Key": "01JINTENT00000000000000001",
              },
              body: JSON.stringify({ base_revision: v1.revision, upload_id: up.upload_id }),
            });
            rmSync(join(intentsDir, "01JINTENT00000000000000001.rec"), { force: true });
            const v2 = mock.state.versions.at(-1);
            const bindingSaved = {
              schema: 2,
              documentId: mock.state.docId,
              workspaceId: mock.state.wsId,
              orgId: mock.state.orgId,
              title: "fx-docx-report-vi.docx",
              filename: "fx-docx-report-vi.docx",
              format: "docx",
              access: "edit",
              baseRevision: v2.revision,
              baseVersion: 2,
              baseVersionId: v2.id,
              baseChecksum: v2.checksum_sha256,
              state: "saved",
              lastSavedAt: new Date().toISOString(),
            };
            writeFileSync(join(docDir, "binding.json"), JSON.stringify(bindingSaved));
            return {
              bindingAfterReconnect: bindingSaved,
              intentFilesAfterReconnect: listAppSyncIntentFiles(scratch.userData, "default", scratch.userId),
            };
          },
        },
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.status, "PASS");
      assert.equal(res.details.appOpenedV1, true);
      assert.equal(res.details.serverVersionsWhileCut, 1);
      assert.equal(res.details.appHeldOfflineIntentWhileCut, true);
      assert.equal(res.details.appReceiptSegment.status, "PASS");
      assert.equal(res.details.appReceiptSegment.baseVersion, 2);
      assert.equal(res.details.serverVersionsAfterReconnect, 2);
    } finally {
      scratch.cleanup();
    }
  });

  it("fails (exit 1) when desktop app is signed in and binding.json settles to conflict/error after reconnect", async () => {
    const scratch = makeScratchRunDir({ startState: "up", signedIn: true });
    const mock = createMockDServer();
    try {
      const docDir = join(
        scratch.userData,
        "uniwork-documents",
        "default",
        scratch.userId,
        mock.state.docId,
      );
      const res = await runTracerLoop({
        loop: "3",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
        appDriver: {
          signedIn: true,
          driven: true,
          openDocumentV1: async () => {
            mkdirSync(docDir, { recursive: true });
            const v1 = mock.state.versions[0];
            const bindingV1 = {
              schema: 2,
              documentId: mock.state.docId,
              baseRevision: v1.revision,
              baseVersion: 1,
              baseChecksum: v1.checksum_sha256,
              state: "ready",
            };
            writeFileSync(join(docDir, "binding.json"), JSON.stringify(bindingV1));
            return { opened: true, binding: bindingV1 };
          },
          saveOfflineWhileCut: async () => {
            const bindingOffline = {
              schema: 2,
              documentId: mock.state.docId,
              baseRevision: "01JREV00000000000000000001",
              baseVersion: 1,
              baseChecksum: "deadbeef",
              state: "offline",
            };
            writeFileSync(join(docDir, "binding.json"), JSON.stringify(bindingOffline));
            return { bindingWhileCut: bindingOffline, intentFilesWhileCut: ["intent.rec"] };
          },
          reconnectAndFlushSave: async () => {
            const bindingConflict = {
              schema: 2,
              documentId: mock.state.docId,
              baseRevision: "01JREV00000000000000000001",
              baseVersion: 1,
              baseChecksum: "deadbeef",
              state: "conflict",
              error: "revision_conflict",
            };
            writeFileSync(join(docDir, "binding.json"), JSON.stringify(bindingConflict));
            return { bindingAfterReconnect: bindingConflict, intentFilesAfterReconnect: [] };
          },
        },
      });
      assert.equal(res.exitCode, 1);
      assert.equal(res.status, "FAIL");
      assert.match(res.reason, /conflict/i);
    } finally {
      scratch.cleanup();
    }
  });
});

describe("G7-10 evidence.mjs run + verify integration across all 3 loops", () => {
  it("produces one valid evidence line per loop/AC and passes evidence.mjs verify", async () => {
    const mock = createMockDServer({ aiMode: "fake" });
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks);
      const url = `http://localhost${req.url}`;
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : rawBody,
      });
      let initBody;
      const ct = String(req.headers["content-type"] ?? "");
      if (ct.includes("multipart/form-data")) {
        initBody = await request.formData();
      } else if (rawBody.length > 0) {
        initBody = rawBody.toString("utf8");
      }
      const response = await mock.fetchImpl(url, {
        method: req.method,
        headers: req.headers,
        body: initBody,
      });
      res.statusCode = response.status;
      for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
      res.end(Buffer.from(await response.arrayBuffer()));
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const scratch = makeScratchRunDir({ startState: "up", skipApp: false, signedIn: false });
    writeFileSync(
      join(scratch.dir, "ports.env"),
      [
        `API_ORIGIN=http://127.0.0.1:${port}`,
        "WEB_ORIGIN=http://127.0.0.1:13000",
        "DISPLAY=:99",
        `UNIWORK_USER_DATA=${scratch.userData}`,
        `ELECTRON_BIN=${join(scratch.dir, "fake-electron")}`,
        `SHELL_APP_DIR=${join(scratch.dir, "shell")}`,
        "HARNESS_DEPLOYMENT_ID=default",
        "",
      ].join("\n"),
    );

    const outDir = join(scratch.dir, "evidence-out");
    const ledgerPath = join(outDir, "evidence.jsonl");
    const evidenceScript = join(REPO_ROOT, "scripts/office/g5g6g7/evidence.mjs");
    const tracerScript = join(REPO_ROOT, "scripts/office/g5g6g7/g7-10/tracer.mjs");

    const runCmd = (args, env = process.env) =>
      new Promise((resolveRun, rejectRun) => {
        const child = spawn(process.execPath, args, { cwd: REPO_ROOT, env });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => {
          stdout += d.toString("utf8");
        });
        child.stderr.on("data", (d) => {
          stderr += d.toString("utf8");
        });
        child.on("error", rejectRun);
        child.on("close", (status) => resolveRun({ status, stdout, stderr }));
      });

    try {
      const cases = [
        { loop: "1", req: "G5-A03", fixture: "fx-xlsx-revenue-xyz" },
        { loop: "2", req: "G6-A03", fixture: "fx-docx-report-vi" },
        { loop: "3", req: "G5-A05", fixture: "fx-docx-report-vi" },
      ];
      for (const c of cases) {
        const run = await runCmd(
          [
            evidenceScript,
            "run",
            "--req",
            c.req,
            "--fixture",
            c.fixture,
            "--checker",
            "tester-cloud",
            "--out",
            outDir,
            "--",
            process.execPath,
            tracerScript,
            "--loop",
            c.loop,
            "--run-dir",
            scratch.dir,
          ],
          { ...process.env, OFFICE_FORK_SHA: "ab12238f" },
        );
        assert.equal(run.status, BLOCKED_EXIT, `loop ${c.loop} exit status (${run.stderr})`);
      }

      const verify = await runCmd([evidenceScript, "verify", "--out", outDir]);
      assert.equal(verify.status, 0, `evidence.mjs verify failed: ${verify.stderr}`);
      assert.match(verify.stdout, /evidence verify: OK \(3 records\)/);

      const lines = readFileSync(ledgerPath, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      assert.equal(lines.length, 3);
      assert.deepEqual(
        lines.map((l) => ({ req: l.requirementId, fixture: l.fixtureId, result: l.result, exitCode: l.exitCode })),
        [
          { req: "G5-A03", fixture: "fx-xlsx-revenue-xyz", result: "BLOCKED", exitCode: 77 },
          { req: "G6-A03", fixture: "fx-docx-report-vi", result: "BLOCKED", exitCode: 77 },
          { req: "G5-A05", fixture: "fx-docx-report-vi", result: "BLOCKED", exitCode: 77 },
        ],
      );
      for (const line of lines) {
        assert.equal(line.blocker, "command reported skip (exit 77)");
      }
      const art0 = readFileSync(join(REPO_ROOT, lines[0].artifact), "utf8");
      const art1 = readFileSync(join(REPO_ROOT, lines[1].artifact), "utf8");
      const art2 = readFileSync(join(REPO_ROOT, lines[2].artifact), "utf8");
      assert.match(art0, new RegExp(UPSTREAM_BLOCKED_REASON));
      assert.match(art1, new RegExp(UPSTREAM_BLOCKED_REASON));
      assert.match(art2, /signed in|session\.bin|keyring/i);
    } finally {
      await new Promise((r) => server.close(r));
      scratch.cleanup();
    }
  });
});

describe("G7-10 ADDENDUM r3 fixes (C1-C5)", () => {
  it("C2: seeds completeOnboarding so web navigation never redirects to /onboarding, and uses real OfficeModuleFrame selectors from e2e/office-modules-web.spec.ts", async () => {
    const frameHostSource = readFileSync(
      join(REPO_ROOT, "packages/views/office/frame/office-module-frame.tsx"),
      "utf8",
    );
    const e2eFixturesSource = readFileSync(
      join(REPO_ROOT, "e2e/office-module-web-fixtures.ts"),
      "utf8",
    );
    const e2eSpecSource = readFileSync(
      join(REPO_ROOT, "e2e/office-modules-web.spec.ts"),
      "utf8",
    );
    assert.equal(WEB_SHEETS_HOST_SELECTOR, '[data-office-docs-frame][data-office-module="sheets"]');
    assert.equal(
      WEB_SHEETS_READY_SELECTOR,
      '[data-office-docs-frame][data-office-module="sheets"][data-state="ready"]',
    );
    assert.equal(WEB_SHEETS_IFRAME_SELECTOR, 'iframe[src*="/office-frame/sheets/"]');
    assert.match(frameHostSource, /data-office-docs-frame/);
    assert.match(frameHostSource, /data-office-module=\{module\}/);
    assert.match(frameHostSource, /data-state=\{session\.status\}/);
    assert.match(e2eFixturesSource, /\[data-office-docs-frame\]\[data-office-module="\$\{module\}"\]/);
    assert.match(e2eSpecSource, /iframe\[src\*="\/office-frame\/\$\{c\.module\}\/"\]/);

    assert.ok("completeOnboarding" in TRACER_API_CALLS, "TRACER_API_CALLS must include completeOnboarding");

    const scratch = makeScratchRunDir({ startState: "up", skipApp: true });
    const mock = createMockDServer({ aiMode: "fake" });
    try {
      await runTracerLoop({
        loop: "1",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
      });
      assert.equal(mock.state.onboarded, true, "seedFixtureDocument must call POST /api/v1/me/onboarding/complete");
    } finally {
      scratch.cleanup();
    }
  });

  it("C3: interpretCommitIntentLookup handles 410 commit_intent_unknown (outcome=unknown), 200 not_committed, 200 in_flight, and 200 committed per G5-07 contract", () => {
    const unknown410 = interpretCommitIntentLookup({
      status: 410,
      ok: false,
      data: {
        error: {
          code: "commit_intent_unknown",
          message: "máy chủ không còn thông tin về lần lưu này",
          fields: { outcome: "unknown" },
        },
      },
    });
    assert.deepEqual(unknown410, {
      httpStatus: 410,
      code: "commit_intent_unknown",
      outcome: "unknown",
      hasCommitted: false,
      hasClaim: false,
    });

    const notCommitted200 = interpretCommitIntentLookup({
      status: 200,
      ok: true,
      data: { outcome: "not_committed" },
    });
    assert.deepEqual(notCommitted200, {
      httpStatus: 200,
      code: null,
      outcome: "not_committed",
      hasCommitted: false,
      hasClaim: true,
    });

    const inFlight200 = interpretCommitIntentLookup({
      status: 200,
      ok: true,
      data: { outcome: "in_flight" },
    });
    assert.deepEqual(inFlight200, {
      httpStatus: 200,
      code: null,
      outcome: "in_flight",
      hasCommitted: false,
      hasClaim: true,
    });

    const committed200 = interpretCommitIntentLookup({
      status: 200,
      ok: true,
      data: {
        outcome: "committed",
        version_id: "01JVER0002",
        version: 2,
        revision: "2",
      },
    });
    assert.deepEqual(committed200, {
      httpStatus: 200,
      code: null,
      outcome: "committed",
      hasCommitted: true,
      hasClaim: true,
      versionId: "01JVER0002",
      version: 2,
      revision: "2",
    });
  });

  it("C4: POST /api/v1/documents/{id}/ai/uniwork/chat/completions answering 503 ai_disabled on fake deployment is BLOCKED (reason + owner), not FAIL, and G6-A03 version/intent counts still run", async () => {
    const classified = classifyAiResponse({
      status: 503,
      ok: false,
      data: { error: { code: "ai_disabled", message: "AI chưa được cấu hình trên server" } },
    });
    assert.equal(classified.status, "BLOCKED");
    assert.equal(classified.owner, "g7-qa");
    assert.equal(classified.reason, UPSTREAM_BLOCKED_REASON);
    assert.equal(classified.httpStatus, 503);
    assert.equal(classified.errorCode, "ai_disabled");

    const scratch = makeScratchRunDir({ startState: "up", skipApp: true });
    const mock = createMockDServer({ aiMode: "503-disabled" });
    try {
      const res = await runTracerLoop({
        loop: "2",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
      });
      assert.equal(res.exitCode, BLOCKED_EXIT);
      assert.equal(res.status, "BLOCKED");
      assert.equal(res.owner, "g7-qa");
      assert.match(res.reason, new RegExp(UPSTREAM_BLOCKED_REASON));
      assert.equal(res.details.versionsBeforeTurn, 1);
      assert.equal(res.details.versionsAfterTurn, 1);
      assert.equal(res.details.versionsAfterSave, 2);
      assert.equal(res.details.commitIntentBeforeSave.httpStatus, 410);
      assert.equal(res.details.commitIntentBeforeSave.outcome, "unknown");
      assert.equal(res.details.commitIntentOutcome, "committed");
    } finally {
      scratch.cleanup();
    }
  });

  it("C5: on every exit path (FAIL included) the loop JSON carries owner, reason, per-step source (web/app/protocol), and version counts collected so far", async () => {
    // 1. Loop 1 FAIL when web UI fails on live WEB_ORIGIN: still carries owner, steps (web/app/protocol), and versionCounts
    const scratch1 = makeScratchRunDir({ startState: "up", skipApp: true });
    const mock1 = createMockDServer({ aiMode: "real-xyz" });
    try {
      const res1 = await runTracerLoop({
        loop: "1",
        runDir: scratch1.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock1.fetchImpl,
        webDriver: async () => ({
          driven: true,
          saved: false,
          source: "web",
          error: "Playwright timeout on sheets frame",
          reason: "Playwright timeout on sheets frame",
        }),
      });
      assert.equal(res1.exitCode, 1);
      assert.equal(res1.status, "FAIL");
      assert.equal(res1.owner, "g7-qa");
      assert.match(res1.reason, /Playwright timeout on sheets frame/);
      assert.ok(res1.steps, "FAIL JSON must carry top-level steps");
      assert.equal(res1.steps.webSave.source, "web");
      assert.equal(res1.steps.webSave.status, "FAIL");
      assert.equal(res1.steps.aiTurn.source, "protocol");
      assert.equal(res1.steps.appReloadV2.source, "protocol");
      assert.ok(res1.versionCounts, "FAIL JSON must carry top-level versionCounts");
      assert.equal(res1.versionCounts.versionsBeforeTurn, 1);
      assert.equal(res1.versionCounts.versionsAfterTurn, 1);
      assert.equal(res1.details.owner, "g7-qa");
      assert.equal(res1.details.webSaveSource, "web");
    } finally {
      scratch1.cleanup();
    }

    // 2. Loop 2 FAIL when an API call throws mid-loop (after AI turn, during upload): still carries owner, steps, and versionCounts collected so far
    const scratch2 = makeScratchRunDir({ startState: "up", skipApp: true });
    const mock2 = createMockDServer({ aiMode: "503-disabled" });
    mock2.state.failSecondUpload = true;
    try {
      const res2 = await runTracerLoop({
        loop: "2",
        runDir: scratch2.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock2.fetchImpl,
      });
      assert.equal(res2.exitCode, 1);
      assert.equal(res2.status, "FAIL");
      assert.equal(res2.owner, "g7-qa");
      assert.match(res2.reason, /uploads -> 500/);
      assert.ok(res2.steps, "Loop 2 FAIL JSON must carry steps");
      assert.equal(res2.steps.aiTurn.source, "protocol");
      assert.equal(res2.steps.saveV2.source, "protocol");
      assert.equal(res2.steps.saveV2.status, "FAIL");
      assert.ok(res2.versionCounts, "Loop 2 FAIL JSON must carry versionCounts");
      assert.equal(res2.versionCounts.versionsBeforeTurn, 1);
      assert.equal(res2.versionCounts.versionsAfterTurn, 1);
      assert.equal(res2.details.versionsBeforeTurn, 1);
      assert.equal(res2.details.versionsAfterTurn, 1);
    } finally {
      scratch2.cleanup();
    }

    // 3. Loop 3 FAIL when an API call throws mid-loop: still carries owner, steps, and versionCounts collected so far
    const scratch3 = makeScratchRunDir({ startState: "up", skipApp: true });
    const mock3 = createMockDServer({ aiMode: "fake" });
    mock3.state.failSecondUpload = true;
    try {
      const res3 = await runTracerLoop({
        loop: "3",
        runDir: scratch3.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock3.fetchImpl,
      });
      assert.equal(res3.exitCode, 1);
      assert.equal(res3.status, "FAIL");
      assert.equal(res3.owner, "g7-qa");
      assert.match(res3.reason, /uploads -> 500/);
      assert.ok(res3.steps, "Loop 3 FAIL JSON must carry steps");
      assert.equal(res3.steps.appOfflineSave.source, "app");
      assert.equal(res3.steps.protocolReconnectDiagnostic.source, "protocol");
      assert.equal(res3.steps.protocolReconnectDiagnostic.status, "FAIL");
      assert.ok(res3.versionCounts, "Loop 3 FAIL JSON must carry versionCounts");
      assert.equal(res3.versionCounts.versionsBeforeCut, 1);
    } finally {
      scratch3.cleanup();
    }
  });
});

describe("G7-10 r4 cloud r2 findings (F1-F4)", () => {
  it("F1a: Loop 1 recognizes v2 in GET /api/v1/workspaces/{id}/documents/changes when the server returns the real DocumentChangeFeedSDO shape (current_version=2, change_kind='upsert', version_id, revision, no version or checksum_sha256 field)", async () => {
    const scratch = makeScratchRunDir({ startState: "up", skipApp: false });
    const mock = createMockDServer({ aiMode: "real-xyz" });
    try {
      const v2Workbook = buildXlsxRevenueWithXyzBytes(REPO_ROOT);
      const res = await runTracerLoop({
        loop: "1",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
        webDriver: async ({ token, documentId }) => {
          const v1Revision = mock.state.versions[0].revision;
          const uploadForm = new FormData();
          uploadForm.append("file", new Blob([v2Workbook.bytes]), "revenue-q1-q2.xlsx");
          const upRes = await mock.fetchImpl(
            `http://127.0.0.1:18080/api/v1/office-frame/documents/${documentId}/uploads`,
            { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: uploadForm },
          );
          const upData = await upRes.json();
          await mock.fetchImpl(
            `http://127.0.0.1:18080/api/v1/office-frame/documents/${documentId}/versions/commit`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "Idempotency-Key": `web-ui-f1-${documentId}`,
              },
              body: JSON.stringify({ upload_id: upData.upload_id, base_revision: v1Revision }),
            },
          );
          return { driven: true, saved: true, source: "web", editorCellsTyped: true };
        },
        appDriver: {
          signedIn: true,
          driven: true,
          openDocumentV1: async () => ({ opened: true, binding: { baseVersion: 1, state: "ready" } }),
          waitForFeedReloadV2: async () => ({ reloaded: true, binding: { baseVersion: 2, state: "saved" } }),
        },
      });
      assert.equal(res.details.changeFeedDeliveredV2, true, "changeFeedDeliveredV2 must be true for real DocumentChangeFeedSDO");
      assert.equal(res.steps.changeFeed.status, "PASS");
      assert.equal(res.exitCode, 0);
      assert.equal(res.status, "PASS");
    } finally {
      scratch.cleanup();
    }
  });

  it("F1b: waitForFeedReloadV2 keeps the document tab open (does not call aiOfficeTabs.close) so UniworkDocsService.noteRemoteChange (which checks isPathOpen(doc.path)) reloads binding.json to v2", async () => {
    const scratch = makeScratchRunDir({ startState: "up", skipApp: false });
    const mock = createMockDServer({ aiMode: "503-disabled" });
    try {
      const userId = "01JUSER0000000000000000001";
      const docId = mock.state.docId;
      const v1Bytes = Buffer.from("v1-xlsx-bytes-without-xyz");
      const v1Sha256 = sha256Hex(v1Bytes);
      const v2Workbook = buildXlsxRevenueWithXyzBytes(REPO_ROOT);
      const sessionBinDir = join(scratch.userData, "uniwork-auth");
      mkdirSync(sessionBinDir, { recursive: true });
      writeFileSync(join(sessionBinDir, "session.bin"), "encrypted-session-bytes");

      const docDir = join(scratch.userData, "uniwork-documents", "default", userId, docId);
      mkdirSync(docDir, { recursive: true });
      const wcFilePath = join(docDir, "revenue-q1-q2.xlsx");
      writeFileSync(wcFilePath, v1Bytes);
      writeFileSync(
        join(docDir, "binding.json"),
        JSON.stringify({
          schema: 2,
          documentId: docId,
          accountId: userId,
          deploymentId: "default",
          filename: "revenue-q1-q2.xlsx",
          baseVersion: 1,
          baseRevision: "1",
          baseChecksum: v1Sha256,
          state: "ready",
        }),
      );

      let tabOpen = true;
      let closedTabsCount = 0;

      const fakePage = {
        evaluate: async (fn, arg) => {
          const src = fn.toString();
          if (src.includes("aiOfficeTabs")) {
            // Simulate window.aiOfficeTabs.list() / close()
            const win = {
              aiOfficeTabs: {
                list: async () => ({
                  tabs: tabOpen ? [{ id: "tab-1", filePath: wcFilePath }] : [],
                }),
                close: async () => {
                  tabOpen = false;
                  closedTabsCount += 1;
                },
              },
            };
            // If tracer calls closeOpenTabForPath, tabOpen becomes false!
            if (src.includes("aiOfficeTabs.close") || src.includes("aiOfficeTabs?.close")) {
              await win.aiOfficeTabs.close("tab-1");
            }
            return;
          }
          if (src.includes("typeof window.aiOffice")) return true;
          if (src.includes("accountStatus")) {
            return { state: "signed-in", profile: { accountId: userId } };
          }
          if (src.includes("accountRetry")) {
            // Simulate SyncRuntime -> UniworkDocsService.noteRemoteChange:
            // service.ts:2577 checks `if (!doc || !this.deps.isPathOpen(doc.path)) return`!
            if (tabOpen) {
              writeFileSync(wcFilePath, v2Workbook.bytes);
              writeFileSync(
                join(docDir, "binding.json"),
                JSON.stringify({
                  schema: 2,
                  documentId: docId,
                  accountId: userId,
                  deploymentId: "default",
                  filename: "revenue-q1-q2.xlsx",
                  baseVersion: 2,
                  baseRevision: "2",
                  baseChecksum: v2Workbook.sha256,
                  state: "saved",
                }),
              );
            }
            return;
          }
          return null;
        },
      };

      const ctrl = await connectAppController({
        portsEnv: {
          UNIWORK_USER_DATA: scratch.userData,
          ELECTRON_BIN: "/bin/true",
          SHELL_APP_DIR: scratch.dir,
          APP_CDP_PORT: "19222",
        },
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        apiOrigin: "http://127.0.0.1:18080",
        fetchImpl: mock.fetchImpl,
        token: "tok-session",
        userId,
        timeoutMs: 1_500,
        cdpConnector: async () => ({
          contexts: () => [{ pages: () => [fakePage] }],
          close: async () => {},
        }),
        deepLinkDeliverer: () => ({ status: 0, error: null }),
      });

      const reloadRes = await ctrl.waitForFeedReloadV2({
        documentId: docId,
        expectedSha256: v2Workbook.sha256,
      });
      await ctrl.close();

      assert.equal(closedTabsCount, 0, "waitForFeedReloadV2 must NOT close the open tab before feed reload");
      assert.equal(reloadRes.reloaded, true, "waitForFeedReloadV2 must observe v2 reload when tab stays open");
      assert.equal(reloadRes.binding?.baseVersion, 2);
      assert.equal(reloadRes.binding?.state, "saved");
    } finally {
      scratch.cleanup();
    }
  });

  it("F2 / G710-BE-3 / G710-BE-4: Loop 1 verifies committed v2 bytes + sha256 contain X/Y/Z, passes real v2ContainsExpectedXyz to decideLoop1Outcome (FAIL if missing), and words steps.webSave.detail as page-level Control+s", async () => {
    const scratch = makeScratchRunDir({ startState: "up", skipApp: true });
    const mockMissingXyz = createMockDServer({ aiMode: "503-disabled" });
    try {
      const v1Bytes = Buffer.from("v1-xlsx-bytes-without-xyz");
      // Case 1 (G710-BE-3): webDriver saves v2 bytes that DO NOT contain X/Y/Z -> must FAIL (exit 1), never hardcoded true!
      const resMissingXyz = await runTracerLoop({
        loop: "1",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mockMissingXyz.fetchImpl,
        webDriver: async ({ token, documentId }) => {
          const v1Revision = mockMissingXyz.state.versions[0].revision;
          const uploadForm = new FormData();
          uploadForm.append("file", new Blob([v1Bytes]), "revenue-q1-q2.xlsx");
          const upRes = await mockMissingXyz.fetchImpl(
            `http://127.0.0.1:18080/api/v1/office-frame/documents/${documentId}/uploads`,
            { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: uploadForm },
          );
          const upData = await upRes.json();
          await mockMissingXyz.fetchImpl(
            `http://127.0.0.1:18080/api/v1/office-frame/documents/${documentId}/versions/commit`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "Idempotency-Key": `web-ui-f2-no-xyz-${documentId}`,
              },
              body: JSON.stringify({ upload_id: upData.upload_id, base_revision: v1Revision }),
            },
          );
          return { driven: true, saved: true, source: "web", editorCellsTyped: false };
        },
      });
      assert.equal(resMissingXyz.exitCode, 1, "G710-BE-3: Loop 1 must FAIL when committed v2 bytes lack X/Y/Z");
      assert.equal(resMissingXyz.status, "FAIL");
      assert.equal(resMissingXyz.details.v2ContainsExpectedXyz, false);
      assert.match(resMissingXyz.reason, /committed v2 workbook bytes do not contain the expected X\/Y\/Z values/);

      // Case 2 (G710-BE-4 / F2): webDriver types X/Y/Z cells in editor and saves v2 via page-level Control+s
      const mockEdited = createMockDServer({ aiMode: "503-disabled" });
      const resCellEdited = await runTracerLoop({
        loop: "1",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mockEdited.fetchImpl,
        webDriver: async ({ token, documentId }) => {
          const v1Revision = mockEdited.state.versions[0].revision;
          const { bytes } = buildXlsxRevenueWithXyzBytes();
          const uploadForm = new FormData();
          uploadForm.append("file", new Blob([bytes]), "revenue-q1-q2.xlsx");
          const upRes = await mockEdited.fetchImpl(
            `http://127.0.0.1:18080/api/v1/office-frame/documents/${documentId}/uploads`,
            { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: uploadForm },
          );
          const upData = await upRes.json();
          await mockEdited.fetchImpl(
            `http://127.0.0.1:18080/api/v1/office-frame/documents/${documentId}/versions/commit`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "Idempotency-Key": `web-ui-f2-edited-${documentId}`,
              },
              body: JSON.stringify({ upload_id: upData.upload_id, base_revision: v1Revision }),
            },
          );
          return { driven: true, saved: true, source: "web", editorCellsTyped: true };
        },
      });
      assert.equal(
        resCellEdited.steps.webSave.detail,
        "Playwright typed X/Y/Z cells (E1:G4) through the sheets frame name box and saved v2 via page-level Control+s with focus in the frame; committed v2 bytes and sha256 verified",
      );
      assert.equal(resCellEdited.details.v2ContainsExpectedXyz, true);
      assert.equal(resCellEdited.details.v2BytesSha256Verified, true);
    } finally {
      scratch.cleanup();
    }
  });

  it("F3: every loop JSON records the sanitized appSignIn decision object (decideAppSignInOutcome input and result, accountStatusState, sessionBinExists) and never any token or credential", async () => {
    const scratch = makeScratchRunDir({ startState: "up", skipApp: true });
    const mock = createMockDServer({ aiMode: "503-disabled" });
    try {
      for (const loop of ["1", "2", "3"]) {
        const res = await runTracerLoop({
          loop,
          runDir: scratch.dir,
          repoRoot: REPO_ROOT,
          fetchImpl: mock.fetchImpl,
        });
        assert.ok(res.appSignIn, `loop ${loop} top-level appSignIn must be present`);
        assert.ok(res.details.appSignIn, `loop ${loop} details.appSignIn must be present`);
        assert.equal(typeof res.appSignIn.accountStatusState, "string");
        assert.equal(typeof res.appSignIn.sessionBinExists, "boolean");
        assert.ok(res.appSignIn.decisionInput, `loop ${loop} appSignIn.decisionInput must be present`);
        assert.ok(res.appSignIn.decisionResult, `loop ${loop} appSignIn.decisionResult must be present`);
        assert.equal(res.appSignIn.decisionResult.status, "BLOCKED");
        const serialized = JSON.stringify(res.appSignIn);
        assert.ok(!serialized.includes("tok-session"), "appSignIn must never contain any session token");
        assert.ok(!serialized.includes("password"), "appSignIn must never contain any password");
      }
    } finally {
      scratch.cleanup();
    }
  });

  it("F4: running tracer.mjs CLI on a warm runDir truncates/replaces tracer-loop-N.json instead of appending behind a stale round's JSON object", async () => {
    const scratch = makeScratchRunDir({ startState: "up", skipApp: true });
    const mock = createMockDServer({ aiMode: "503-disabled" });
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks);
      const url = `http://localhost${req.url}`;
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : rawBody,
      });
      let initBody;
      const ct = String(req.headers["content-type"] ?? "");
      if (ct.includes("multipart/form-data")) {
        initBody = await request.formData();
      } else if (rawBody.length > 0) {
        initBody = rawBody.toString("utf8");
      }
      const response = await mock.fetchImpl(url, {
        method: req.method,
        headers: req.headers,
        body: initBody,
      });
      res.statusCode = response.status;
      for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
      res.end(Buffer.from(await response.arrayBuffer()));
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    writeFileSync(
      join(scratch.dir, "ports.env"),
      `API_ORIGIN=http://127.0.0.1:${port}\nHARNESS_SKIP_APP=1\n`,
    );

    const artifactPath = join(scratch.dir, "tracer-loop-2.json");
    writeFileSync(artifactPath, `${JSON.stringify({ staleRound: 1, status: "OLD" }, null, 2)}\n`);

    try {
      const tracerScript = resolve(HERE, "tracer.mjs");
      await new Promise((resolveRun, rejectRun) => {
        const child = spawn(process.execPath, [tracerScript, "--loop", "2", "--run-dir", scratch.dir], {
          env: { ...process.env, OFFICE_EVIDENCE_ID: "ev-f4-test" },
          stdio: "ignore",
        });
        child.on("error", rejectRun);
        child.on("close", () => resolveRun());
      });

      const raw = readFileSync(artifactPath, "utf8");
      const parsed = JSON.parse(raw);
      assert.equal(parsed.staleRound, undefined, "stale round 1 JSON object must be replaced, not kept");
      assert.equal(parsed.details?.loop, "2");
    } finally {
      await new Promise((r) => server.close(r));
      scratch.cleanup();
    }
  });

  it("G710-BE-5: classifyAiResponse refuses provider==='upstream' unless allowRealUpstream / HARNESS_ALLOW_REAL_AI_UPSTREAM=1 is explicitly enabled", () => {
    const fakeAnsweringUpstream = {
      ok: true,
      status: 200,
      data: {
        provider: "upstream",
        model: "uniwork-real",
        choices: [{ message: { content: "270 30 175 15 460 40" } }],
      },
    };
    const withoutOverride = classifyAiResponse(fakeAnsweringUpstream, null, { allowRealUpstream: false });
    assert.equal(withoutOverride.status, "BLOCKED", "provider=upstream without explicit allowRealUpstream must be BLOCKED");
    assert.equal(withoutOverride.owner, "g7-qa");

    const withOverride = classifyAiResponse(fakeAnsweringUpstream, null, { allowRealUpstream: true });
    assert.equal(withOverride.status, "PASS", "provider=upstream with explicit allowRealUpstream=true may PASS");
  });

  it("G710-BE-7: Loop 2 performs a real G5-07 lookupCommitIntent (GET /documents/{id}/versions/commit) on the app path when an idempotencyKey is available", async () => {
    const scratch = makeScratchRunDir({ startState: "up", signedIn: true });
    const mock = createMockDServer({ aiMode: "503-disabled" });
    try {
      const appIdemKey = "app-save-idem-key-g710-be7";
      const res = await runTracerLoop({
        loop: "2",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
        appDriver: {
          signedIn: true,
          driven: true,
          openDocumentV1: async () => ({ opened: true, binding: { baseVersion: 1, state: "ready" } }),
          saveOnlineInApp: async ({ documentId, v2Bytes }) => {
            const v1Revision = mock.state.versions[0].revision;
            const uploadForm = new FormData();
            uploadForm.append("file", new Blob([v2Bytes]), "report.docx");
            const upRes = await mock.fetchImpl(
              `http://127.0.0.1:18080/api/v1/documents/${documentId}/uploads`,
              { method: "POST", headers: { Authorization: "Bearer tok-session-01" }, body: uploadForm },
            );
            const upData = await upRes.json();
            await mock.fetchImpl(
              `http://127.0.0.1:18080/api/v1/documents/${documentId}/versions/commit`,
              {
                method: "POST",
                headers: {
                  Authorization: "Bearer tok-session-01",
                  "Content-Type": "application/json",
                  "Idempotency-Key": appIdemKey,
                },
                body: JSON.stringify({ upload_id: upData.upload_id, base_revision: v1Revision }),
              },
            );
            return {
              saved: true,
              binding: { baseVersion: 2, state: "saved" },
              idempotencyKey: appIdemKey,
            };
          },
        },
      });
      assert.ok(res.details.commitIntentAfterSave, "Loop 2 app path with idempotencyKey must record commitIntentAfterSave from GET /versions/commit");
      assert.equal(res.details.commitIntentAfterSave.httpStatus, 200);
      assert.equal(res.details.commitIntentAfterSave.outcome, "committed");
      assert.equal(res.details.commitIntentAfterSave.version, 2);
      assert.equal(res.details.commitIntentReceiptSource, "endpoint_lookup");
    } finally {
      scratch.cleanup();
    }
  });

  it("G710-BE-9: Loop 3 appHeldOfflineIntentWhileCut requires bindingWhileCut at baseVersion === 1 (cannot be satisfied by intentFilesWhileCut alone when binding is missing or already at v2)", async () => {
    const scratch = makeScratchRunDir({ startState: "up", signedIn: true });
    const mock = createMockDServer({ aiMode: "503-disabled" });
    try {
      const res = await runTracerLoop({
        loop: "3",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
        appDriver: {
          signedIn: true,
          driven: true,
          openDocumentV1: async () => ({ opened: true, binding: { baseVersion: 1, state: "ready" } }),
          saveOfflineWhileCut: async () => ({
            // Stub writes a .rec file but bindingWhileCut is already at baseVersion 2 (or null)
            bindingWhileCut: { baseVersion: 2, state: "saved" },
            intentFilesWhileCut: ["harness-writable-stub.rec"],
          }),
          reconnectAndFlushSave: async ({ documentId, v2Bytes }) => {
            const v1Revision = mock.state.versions[0].revision;
            const uploadForm = new FormData();
            uploadForm.append("file", new Blob([v2Bytes]), "report.docx");
            const upRes = await mock.fetchImpl(
              `http://127.0.0.1:18080/api/v1/documents/${documentId}/uploads`,
              { method: "POST", headers: { Authorization: "Bearer tok-session-01" }, body: uploadForm },
            );
            const upData = await upRes.json();
            await mock.fetchImpl(
              `http://127.0.0.1:18080/api/v1/documents/${documentId}/versions/commit`,
              {
                method: "POST",
                headers: {
                  Authorization: "Bearer tok-session-01",
                  "Content-Type": "application/json",
                  "Idempotency-Key": "loop3-be9",
                },
                body: JSON.stringify({ upload_id: upData.upload_id, base_revision: v1Revision }),
              },
            );
            return {
              bindingAfterReconnect: { baseVersion: 2, state: "saved" },
              intentFilesAfterReconnect: [],
            };
          },
        },
      });
      assert.equal(res.details.appHeldOfflineIntentWhileCut, false, "intentFilesWhileCut alone without bindingWhileCut at v1 must not satisfy appHeldOfflineIntentWhileCut");
      assert.equal(res.exitCode, 1);
      assert.equal(res.status, "FAIL");
    } finally {
      scratch.cleanup();
    }
  });
});



