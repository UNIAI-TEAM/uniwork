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
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  buildEditedDocxFixtureBytes,
  buildXlsxRevenueWithXyzBytes,
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
    if (method === "POST" && path === `/api/v1/workspaces/${state.wsId}/documents/files`) {
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
      if (aiMode === "disabled") {
        return json(403, { error: { code: "ai_disabled", message: "UniWork AI is disabled" } });
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
        state.intents.set(idemKey, { version: nextVer, response });
      }
      return json(200, response);
    }
    if (method === "GET" && path === `/api/v1/documents/${state.docId}/versions/commit`) {
      const idemKey = init.headers?.["Idempotency-Key"] ?? init.headers?.["idempotency-key"] ?? "";
      if (idemKey && state.intents.has(idemKey)) {
        const hit = state.intents.get(idemKey).version;
        return json(200, {
          outcome: "committed",
          version_id: hit.id,
          version: hit.version,
          revision: hit.revision,
          checksum_sha256: hit.checksum_sha256,
        });
      }
      return json(200, { outcome: "not_committed" });
    }
    if (method === "GET" && path === `/api/v1/workspaces/${state.wsId}/documents/changes`) {
      const cursor = url.searchParams.get("cursor");
      const latest = state.versions.at(-1);
      const reported = omitFromChangeFeed ? state.versions[0] : latest;
      const item = {
        document_id: state.docId,
        workspace_id: state.wsId,
        organization_id: state.orgId,
        version_id: reported.id,
        version: reported.version,
        revision: reported.revision,
        checksum_sha256: reported.checksum_sha256,
        size_bytes: reported.size_bytes,
      };
      if (!cursor) {
        return json(200, {
          phase: "snapshot",
          changes: [item],
          feed: [],
          has_more: false,
          next_cursor: `cur-v${reported.version}`,
        });
      }
      const feedItems = omitFromChangeFeed ? [] : [item];
      return json(200, {
        phase: "feed",
        changes: feedItems,
        feed: feedItems,
        has_more: false,
        next_cursor: `cur-v${reported.version}`,
      });
    }
    if (method === "POST" && path === `/api/v1/documents/${state.docId}/office/sessions`) {
      return json(200, { ticket: "tkt-123" });
    }
    return json(404, { error: { code: "not_found", path } });
  };

  return { state, fetchImpl };
}

describe("G7-10 tracer API call contract against server/internal/handler", () => {
  const routes = routeCatalogue();

  for (const [name, call] of Object.entries(TRACER_API_CALLS)) {
    it(`${name} (${call.method} ${call.path}) is registered in the Go router with matching params and SDI fields`, () => {
      const route = routes.find((r) => r.method === call.method && r.path === call.path);
      assert.ok(route, `no route ${call.method} ${call.path} in server/internal/handler/router`);
      for (const [param, kind] of Object.entries(call.params ?? {})) {
        assert.ok(call.path.includes(`{${param}}`), `${name} declares {${param}} but the path has none`);
        const target = pathParamTarget(route.handler, param);
        if (target) {
          assert.equal(
            paramKind(target.name),
            kind,
            `${name}: {${param}} reaches ${target.method} as "${target.name}" (${paramKind(target.name)}), expected ${kind}`,
          );
        } else {
          assert.match(param, /ID$/, `${name}: {${param}} must end in ID when not passed directly`);
          assert.equal(kind, "id");
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

describe("G7-10 Loop 1 (fx-xlsx-revenue-xyz: web open -> AI turn -> editor X/Y/Z save -> change feed -> app)", () => {
  it("proves 0-version AI turn + web frame v2 save + change feed delivery, and reports BLOCKED (77) under AI_PROVIDER=fake", async () => {
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
      assert.equal(res.details.webSaveAndFeedSegment.status, "PASS");
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
  it("verifies server idempotent commit + receipt reconciliation, and blocks (77) when the VM has no desktop sign-in", async () => {
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
      assert.match(res.reason, /signed in|session\.bin|keyring/i);
      assert.equal(res.details.serverReceiptSegment.status, "PASS");
      assert.equal(res.details.serverReceiptSegment.versionsAfterIdempotentRetry, 2);
    } finally {
      scratch.cleanup();
    }
  });

  it("passes (exit 0) when desktop app is signed in and binding.json settles to the v2 saved receipt", async () => {
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
          const v2 = mock.state.versions.at(-1);
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
              baseRevision: v2.revision,
              baseVersion: v2.version,
              baseVersionId: v2.id,
              baseChecksum: v2.checksum_sha256,
              state: "saved",
              lastSavedAt: new Date().toISOString(),
            }),
          );
          writeFileSync(join(docDir, "fx-docx-report-vi.docx"), v2.bytes);
        },
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.status, "PASS");
      assert.equal(res.details.appReceiptSegment.status, "PASS");
      assert.equal(res.details.appReceiptSegment.baseVersion, 2);
    } finally {
      scratch.cleanup();
    }
  });

  it("fails (exit 1) when desktop app is signed in and binding.json settles to conflict/error", async () => {
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
          writeFileSync(
            join(docDir, "binding.json"),
            JSON.stringify({
              schema: 2,
              documentId: mock.state.docId,
              baseRevision: "01JREV00000000000000000001",
              baseVersion: 1,
              baseChecksum: "deadbeef",
              state: "conflict",
              error: "revision_conflict",
            }),
          );
          writeFileSync(join(docDir, "fx-docx-report-vi.docx"), Buffer.from("conflict"));
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
