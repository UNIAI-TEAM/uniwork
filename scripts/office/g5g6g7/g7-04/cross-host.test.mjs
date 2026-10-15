/* global Buffer, URL, Response, FormData, Blob */
// Failing-first unit + contract tests for the G7-04 cross-host loop driver
// (UNI-1386 card G7-04, rows G7-A01 and G5-A03). Covers:
//   1. CLI args (`--row`, `--fixture`, `--run-dir`, `--timeout-ms`, `--dry-run`)
//      and the exit mapping (0 PASS / 1 FAIL / 77 BLOCKED).
//   2. Every route the driver calls is a row of the tracer's contract table
//      (`TRACER_API_CALLS`, pinned against the Go router by tracer.test.mjs).
//   3. The pure outcome decision: happy chain PASS, checksum divergence FAIL,
//      dirty-editor replaced FAIL, the web never seeing the reconnect version
//      FAIL, a tally mismatch FAIL, a step that cannot run BLOCKED (77) with a
//      named blocker — never PASS.
//   4. The chain itself, on the same in-memory fake server style as
//      tracer.test.mjs: a happy G5-A03 xlsx chain, a happy G7-A01 docx chain
//      (real-labelled AI), the fake-AI BLOCKED path with the exact
//      acceptance.md l.87 blocker, and the start gate.
//   5. evidence.mjs run + verify over the driver CLI (one line per row x
//      fixture, BLOCKED when the run has no app/stack, verify OK).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { TRACER_API_CALLS } from "../g7-10/tracer.mjs";
import {
  BLOCKED_EXIT,
  CROSS_HOST_API_CALLS,
  DEFAULT_STEP_TIMEOUT_MS,
  FIXTURE_IDS,
  FIXTURE_KIND,
  REAL_AI_BLOCKER,
  ROW_IDS,
  decideCrossHostOutcome,
  exitCodeFor,
  parseCrossHostArgs,
  runCrossHostRow,
} from "./cross-host.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

/**
 * G710-BE-10's rule (repo CLAUDE.md): a test file pins the process env it
 * depends on. `classifyAiResponse` reads `AI_PROVIDER` and the real-upstream
 * guard from the ambient environment, so a cloud VM that exports
 * `AI_PROVIDER=fake` decided the happy G7-A01 tests here before this file
 * pinned it.
 */
const PINNED_AI_PROVIDER = "openai";
const PINNED_ENV_KEYS = [
  "AI_PROVIDER",
  "HARNESS_ALLOW_REAL_AI_UPSTREAM",
  "HARNESS_APP_STEP_TIMEOUT_MS",
  "HARNESS_LOOP_TIMEOUT_MS",
  "HARNESS_RUN_DIR",
  "OFFICE_EVIDENCE_ID",
];
const savedEnv = {};
before(() => {
  for (const key of PINNED_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    if (key === "AI_PROVIDER") process.env[key] = PINNED_AI_PROVIDER;
    else delete process.env[key];
  }
});
after(() => {
  for (const key of PINNED_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

const USER_ID = "01JUSER0000000000000000001";
const DOC_ID = "01JDOC00000000000000000001";
const ORG_ID = "01JORG00000000000000000001";
const WS_ID = "01JWS000000000000000000001";

/** A run dir with the files start.sh writes, like tracer.test.mjs' helper. */
function makeScratchRunDir({
  startState = "up",
  startReason = "",
  skipApp = false,
  signedIn = true,
  userId = USER_ID,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "g7-04-cross-host-test-"));
  const userData = join(dir, "userdata");
  const shellDir = join(dir, "shell");
  const electronBin = join(dir, "fake-electron");
  mkdirSync(join(userData, "uniwork-auth"), { recursive: true });
  mkdirSync(shellDir, { recursive: true });
  writeFileSync(electronBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  if (signedIn) writeFileSync(join(userData, "uniwork-auth", "session.bin"), Buffer.from("sealed-session-bytes"));
  writeFileSync(join(dir, "start-status.json"), `${JSON.stringify({ state: startState, reason: startReason })}\n`);
  const lines = ["API_ORIGIN=http://localhost:18080", "WEB_ORIGIN=http://localhost:13000", "APP_CDP_PORT=19222"];
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
 * In-memory fake of the D server routes the cross-host chain calls: the seed
 * (register/org/workspace/onboarding/file upload), the document and version
 * reads, the office-frame open/content/upload/commit routes, the app's commit
 * pair, the commit-intent lookup, the launch session and the AI turn.
 *
 * One `state.versions` list is the single source of truth for both fakes: every
 * commit appends (and records `source`), so a test can see which host made a
 * version and what bytes the server holds.
 */
function createMockDServer({ aiMode = "fake", userId = USER_ID } = {}) {
  const state = {
    docId: DOC_ID,
    orgId: ORG_ID,
    wsId: WS_ID,
    kind: "sheets",
    filename: "fixture.bin",
    versions: [],
    uploads: new Map(),
    intents: new Map(),
    commits: [],
    calls: [],
    aiTurns: 0,
  };

  const json = (status, payload) =>
    new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

  const head = () => state.versions.at(-1);

  const fileMeta = (v) => ({
    version_id: v.id,
    version: v.version,
    filename: v.filename,
    checksum_sha256: v.checksum_sha256,
    size_bytes: v.size_bytes,
  });

  const documentPayload = (v) => ({
    document: {
      id: state.docId,
      workspace_id: state.wsId,
      organization_id: state.orgId,
      title: v.filename,
      revision: v.revision,
      current_version: v.version,
      file: fileMeta(v),
    },
  });

  /** One commit of `bytes` on `baseRevision`: the office-frame and app routes share it. */
  const commit = ({ bytes, baseRevision, source, idempotencyKey = "" }) => {
    const latest = head();
    if (baseRevision !== latest.revision) {
      return { status: 409, body: { error: { code: "document_version_conflict" } } };
    }
    const upload = {
      upload_id: `01JUPL${String(state.uploads.size + 1).padStart(21, "0")}`,
      checksum_sha256: sha256Hex(bytes),
      size_bytes: bytes.length,
      filename: latest.filename,
      bytes,
    };
    state.uploads.set(upload.upload_id, upload);
    const version = latest.version + 1;
    const next = {
      id: `01JVER${String(version).padStart(22, "0")}`,
      version,
      revision: `01JREV${String(version).padStart(22, "0")}`,
      checksum_sha256: upload.checksum_sha256,
      size_bytes: bytes.length,
      filename: latest.filename,
      bytes,
    };
    state.versions.push(next);
    state.commits.push({
      source,
      versionId: next.id,
      version: next.version,
      revision: next.revision,
      checksum: next.checksum_sha256,
      at: Date.now(),
    });
    if (idempotencyKey) state.intents.set(idempotencyKey, { state: "committed", version: next });
    return { status: 200, body: documentPayload(next) };
  };

  const fetchImpl = async (urlStr, init = {}) => {
    const url = new URL(urlStr);
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname;
    state.calls.push({ method, path, search: url.search });

    if (method === "POST" && path === "/api/v1/auth/register") {
      return json(201, { access_token: "tok-seed", user: { id: userId } });
    }
    if (method === "POST" && path === "/api/v1/me/email/verify") return json(200, { verified: true });
    if (method === "POST" && path === "/api/v1/orgs") {
      return json(201, { organization: { id: state.orgId, slug: "o-g704" } });
    }
    if (method === "POST" && path === `/api/v1/orgs/${state.orgId}/workspaces`) {
      return json(201, { workspace: { id: state.wsId, slug: "w-g704" } });
    }
    if (method === "POST" && path === "/api/v1/me/onboarding/complete") {
      return json(200, { user: { id: userId } });
    }
    if (method === "POST" && path === `/api/v1/workspaces/${state.wsId}/documents/files`) {
      const file = init.body.get("file");
      const bytes = Buffer.from(await file.arrayBuffer());
      state.filename = file.name || "fixture.bin";
      const v1 = {
        id: "01JVER0000000000000000000001",
        version: 1,
        revision: "01JREV0000000000000000000001",
        checksum_sha256: sha256Hex(bytes),
        size_bytes: bytes.length,
        filename: state.filename,
        bytes,
      };
      state.versions = [v1];
      state.commits = [];
      return json(201, { document: { ...documentPayload(v1).document } });
    }
    if (method === "GET" && path === `/api/v1/documents/${state.docId}`) {
      return json(200, documentPayload(head()));
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
    if (method === "POST" && path === `/api/v1/documents/${state.docId}/office/frame-token`) {
      return json(200, { token: "tok-frame", can_edit: true, module: state.kind });
    }
    if (method === "GET" && path === `/api/v1/office-frame/documents/${state.docId}`) {
      const v = head();
      return json(200, {
        document_id: state.docId,
        workspace_id: state.wsId,
        organization_id: state.orgId,
        revision: v.revision,
        title: v.filename,
        module: state.kind,
        can_edit: true,
        file: fileMeta(v),
        download_url: `/api/v1/office-frame/documents/${state.docId}/content`,
      });
    }
    if (method === "GET" && path === `/api/v1/office-frame/documents/${state.docId}/content`) {
      return new Response(head().bytes, { status: 200 });
    }
    if (
      method === "POST" &&
      (path === `/api/v1/office-frame/documents/${state.docId}/uploads` ||
        path === `/api/v1/documents/${state.docId}/uploads`)
    ) {
      const file = init.body.get("file");
      const bytes = Buffer.from(await file.arrayBuffer());
      const uploadId = `01JUPL${String(state.uploads.size + 1).padStart(21, "0")}`;
      const rec = {
        upload_id: uploadId,
        checksum_sha256: sha256Hex(bytes),
        size_bytes: bytes.length,
        filename: file.name || head().filename,
        bytes,
      };
      state.uploads.set(uploadId, rec);
      return json(201, { upload_id: uploadId, checksum_sha256: rec.checksum_sha256, size_bytes: rec.size_bytes });
    }
    if (
      method === "POST" &&
      (path === `/api/v1/office-frame/documents/${state.docId}/versions/commit` ||
        path === `/api/v1/documents/${state.docId}/versions/commit`)
    ) {
      const idemKey = init.headers?.["Idempotency-Key"] ?? init.headers?.["idempotency-key"] ?? "";
      if (idemKey && state.intents.has(idemKey)) return json(200, state.intents.get(idemKey).body);
      const body = JSON.parse(init.body);
      const upload = state.uploads.get(body.upload_id);
      if (!upload) return json(400, { error: { code: "unknown_upload" } });
      const source = path.includes("/office-frame/") ? "web" : "app";
      const res = commit({ bytes: upload.bytes, baseRevision: body.base_revision, source, idempotencyKey: idemKey });
      if (idemKey && res.status === 200) state.intents.set(idemKey, { state: "committed", body: res.body });
      return json(res.status, res.body);
    }
    if (method === "GET" && path === `/api/v1/documents/${state.docId}/versions/commit`) {
      const idemKey = init.headers?.["Idempotency-Key"] ?? init.headers?.["idempotency-key"] ?? "";
      const entry = idemKey ? state.intents.get(idemKey) : null;
      if (!entry) {
        return json(410, {
          error: { code: "commit_intent_unknown", message: "gone", fields: { outcome: "unknown" } },
        });
      }
      const v = entry.version ?? state.versions.at(-1);
      return json(200, { outcome: "committed", version_id: v.id, version: v.version, revision: v.revision });
    }
    if (method === "POST" && path === `/api/v1/documents/${state.docId}/office/sessions`) {
      return json(200, {
        ticket: "tkt-cross-host",
        launch_url: "uniwork-office-dev://open?ticket=tkt-cross-host",
      });
    }
    if (
      method === "POST" &&
      (path === `/api/v1/documents/${state.docId}/ai/uniwork/chat/completions` ||
        path === `/api/v1/office-frame/documents/${state.docId}/ai/uniwork/chat/completions`)
    ) {
      state.aiTurns += 1;
      if (aiMode === "buggy-auto-save") {
        const latest = head();
        state.versions.push({
          ...latest,
          id: `01JVERBUGGY${String(state.versions.length + 1).padStart(15, "0")}`,
          version: latest.version + 1,
          revision: `01JREVBUGGY${String(state.versions.length + 1).padStart(15, "0")}`,
        });
      }
      if (aiMode === "disabled") {
        return json(503, { error: { code: "ai_disabled", message: "AI chưa được cấu hình trên server" } });
      }
      const content =
        aiMode === "real-xyz"
          ? JSON.stringify({
              xyz: [
                { region: "Miền Bắc", X: 270, Y: 30, Z: 0.25 },
                { region: "Miền Trung", X: 175, Y: 15, Z: 0.1875 },
                { region: "Miền Nam", X: 460, Y: 40, Z: 0.1905 },
              ],
            })
          : "[fake provider] stub response";
      return json(200, {
        id: "chatcmpl-cross-host",
        model: aiMode === "real-xyz" ? "uniwork-real" : "fake-stub",
        provider: aiMode === "real-xyz" ? "upstream" : "fake",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      });
    }
    if (method === "POST" && path === `/api/v1/orgs/${state.orgId}/privacy/deletion`) {
      return json(202, { status: "scheduled" });
    }
    return json(404, { error: { code: "not_found", path } });
  };
  fetchImpl.allowRealAiUpstream = aiMode === "real-xyz";

  /** The office-frame head read the driver does over protocol (open + checksum). */
  const frameHead = () => {
    const v = head();
    return {
      versionId: v.id,
      version: v.version,
      revision: v.revision,
      checksum: v.checksum_sha256,
      sha256: v.checksum_sha256,
    };
  };

  return { state, fetchImpl, head, commit, frameHead };
}

/** The head bytes with a marker appended (a deterministic "edit" for the fakes). */
function editedBytes(bytes, marker) {
  return Buffer.concat([bytes, Buffer.from(`\n<!-- ${marker} -->`)]);
}

const bindingOf = ({ mock, documentId, kind, filename, versionId, version, revision, checksum, state = "saved" }) => ({
  schema: 2,
  documentId,
  workspaceId: mock.state.wsId,
  orgId: mock.state.orgId,
  kind,
  title: filename,
  filename,
  format: kind === "sheets" ? "xlsx" : "docx",
  access: "edit",
  baseRevision: revision,
  baseVersion: version,
  baseVersionId: versionId,
  baseChecksum: checksum,
  state,
});

/**
 * The fake desktop app controller: the same surface the real CDP controller
 * exposes to the chain, with the working copy, the binding, the sync intents
 * and the S6 surface simulated on disk (the shape `inspectWorkingCopy` and
 * `listAppSyncIntentFiles` read). Knobs drive the failure cases.
 */
function createFakeApp({ runDir, mock, documentId, userId = USER_ID, kind = "sheets", knobs = {} }) {
  const docsDir = join(runDir, "userdata", "uniwork-documents", "default", userId, documentId);
  const intentsDir = join(runDir, "userdata", "uniwork-sync", "store", "default", userId, "intents");
  const filename = kind === "sheets" ? "fx-xlsx-revenue-xyz.xlsx" : "fx-docx-report-vi.docx";
  const workingCopyPath = join(docsDir, filename);
  const app = {
    signedIn: !knobs.signInBlocked && !knobs.signInFailed,
    driven: !knobs.signInBlocked && !knobs.signInFailed,
    signInFailureReason: knobs.signInFailed ? "desktop app sign-in failed while the OS keyring was available" : "",
    blockerReason: knobs.signInBlocked ? "the app is not signed in (no uniwork-auth/session.bin)" : "",
    appSignIn: { accountStatusState: knobs.signInBlocked ? "keyring-unavailable" : "signed-in" },
    dirty: false,
    dirtySource: "none",
    remoteCommits: [],
    calls: [],
    workingCopyPath,
    kind,
    async openDocument() {
      if (!app.signedIn) return { opened: false, reason: app.signInFailureReason || app.blockerReason };
      const v = mock.head();
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(workingCopyPath, v.bytes);
      const binding = bindingOf({
        mock,
        documentId,
        kind,
        filename,
        versionId: v.id,
        version: v.version,
        revision: v.revision,
        checksum: v.checksum_sha256,
        state: "ready",
      });
      writeFileSync(join(docsDir, "binding.json"), JSON.stringify(binding));
      return { opened: true, path: workingCopyPath, kind, binding };
    },
    workingCopy() {
      const bindingPath = join(docsDir, "binding.json");
      if (!existsSync(bindingPath)) {
        return { bindingPresent: false, filePresent: false, binding: null, bindingState: null, workingCopyFilePath: null, sha256: "" };
      }
      const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
      const filePresent = existsSync(workingCopyPath);
      const bytes = filePresent ? readFileSync(workingCopyPath) : Buffer.alloc(0);
      return {
        bindingPresent: true,
        filePresent,
        binding,
        bindingState: binding.state ?? null,
        workingCopyFilePath: workingCopyPath,
        sha256: filePresent ? sha256Hex(bytes) : "",
        bytes,
      };
    },
    intents() {
      const dir = intentsDir;
      if (!existsSync(dir)) return [];
      return readdirSync(dir).filter((name) => name.endsWith(".rec"));
    },
    async makeDirty() {
      app.calls.push("makeDirty");
      if (knobs.dirtyBlocked) return { edited: false, source: "none", reason: knobs.dirtyReason ?? "the editor control surface is not available on this fork" };
      app.dirty = true;
      app.dirtySource = "app-ui";
      return { edited: true, source: "app-ui", plan: kind === "sheets" ? "insert-row" : "split-block" };
    },
    async remoteNewerBar({ version }) {
      app.calls.push(`bar:${version}`);
      const binding = app.workingCopy().binding;
      const told = app.remoteCommits.some((c) => c.versionId && c.version === version);
      const newer = told && binding && Number(binding.baseVersion) < version;
      if (knobs.barMissing) return { visible: false, reason: "no new-version bar on any app page" };
      if (!app.dirty || !newer) return { visible: false, reason: `dirty=${app.dirty} newer=${newer}` };
      return { visible: true, version, text: `Có phiên bản mới hơn trên UniWork (phiên bản ${version})`, where: knobs.barWhere ?? "editor" };
    },
    async clickReload() {
      app.calls.push("clickReload");
      if (knobs.reloadUnavailable) return { clicked: false, reason: "no reload action matched" };
      app.dirty = false;
      app.reloadTo(mock.head());
      return { clicked: true };
    },
    /** The app hears a remote commit (its sync runtime) and records it. */
    noteRemoteCommit(entry) {
      app.remoteCommits.push(entry);
    },
    /** The app reloads the given head (the S6 reload action, or a stray reload = the failure case). */
    reloadTo(v, { state = "saved" } = {}) {
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(workingCopyPath, v.bytes);
      const binding = bindingOf({
        mock,
        documentId,
        kind,
        filename,
        versionId: v.id,
        version: v.version,
        revision: v.revision,
        checksum: v.checksum_sha256,
        state,
      });
      writeFileSync(join(docsDir, "binding.json"), JSON.stringify(binding));
      app.dirty = false;
    },
    async cutLink() {
      app.calls.push("cutLink");
      app.offline = true;
      return { cut: true };
    },
    async restoreLink() {
      app.calls.push("restoreLink");
      app.offline = false;
      return { restored: true };
    },
    /**
     * The app's own Save (`window.aiOffice.uniworkSave`). Offline: the working
     * copy keeps the edited bytes and one `.rec` intent is queued, no server
     * version. Online: the edited bytes are committed and the binding settles.
     */
    async save({ offline = false, bytes = null, standInBytes = null, idempotencyKey = null } = {}) {
      app.calls.push(offline ? "saveOffline" : "saveOnline");
      const binding = app.workingCopy().binding;
      const head = mock.head();
      if (offline === true) {
        mkdirSync(intentsDir, { recursive: true });
        const edited = bytes ?? standInBytes ?? editedBytes(mock.head().bytes, knobs.offlineMarker ?? "desktop-offline-edit");
        writeFileSync(workingCopyPath, edited);
        writeFileSync(join(intentsDir, "01JINTENT00000000000000001.rec"), "encrypted-intent");
        writeFileSync(
          join(docsDir, "binding.json"),
          JSON.stringify({ ...binding, state: "offline", error: "network" }),
        );
        return { saved: false, held: true, binding: app.workingCopy().binding };
      }
      if (app.offline === true && knobs.restoreOnSave !== false) return { saved: false, held: true, binding };
      const edited = bytes ?? standInBytes ?? readFileSync(workingCopyPath);
      const res = mock.commit({
        bytes: edited,
        baseRevision: head.revision,
        source: "app",
        idempotencyKey: idempotencyKey ?? `app-cross-host-${documentId}-${mock.state.versions.length}`,
      });
      if (res.status !== 200) return { saved: false, reason: `commit answered ${res.status}` };
      rmSync(join(intentsDir, "01JINTENT00000000000000001.rec"), { force: true });
      const v = mock.head();
      app.reloadTo(v);
      return { saved: true, binding: app.workingCopy().binding };
    },
    async close() {
      app.calls.push("close");
    },
  };
  return app;
}

/**
 * The fake web host controller: the page "sees" every commit the mock recorded
 * (`announcements`) and reloads the head after one, unless a knob disables it.
 */
function createFakeWeb({ mock, documentId, kind = "sheets", knobs = {} }) {
  return {
    async open() {
      return knobs.frameFailed
        ? { opened: false, status: "blocked", reason: "the web sheets frame did not reach data-state=ready", failureKind: "missing" }
        : { opened: true, status: "ready" };
    },
    async editAndSave({ marker }) {
      if (knobs.webEditFails) return { saved: false, reason: knobs.webEditReason ?? "the frame was not dirty" };
      const head = mock.head();
      const res = mock.commit({
        bytes: editedBytes(head.bytes, marker),
        baseRevision: head.revision,
        source: "web",
      });
      if (res.status !== 200) return { saved: false, reason: `commit answered ${res.status}` };
      const v = mock.head();
      return { saved: true, versionId: v.id, version: v.version, revision: v.revision, checksum: v.checksum_sha256, dirtyObserved: true };
    },
    async fetchHeadViaFrameRoute() {
      const head = mock.frameHead();
      return { ...head, sha256: knobs.divergentWebContent ? sha256Hex(Buffer.from("divergent-web-bytes")) : head.sha256 };
    },
    async announcements({ sinceMs = 0 } = {}) {
      if (knobs.webSees === false) return [];
      return mock.state.commits
        .filter((c) => c.at >= sinceMs && c.source !== "web")
        .map((c) => ({ versionId: c.versionId, version: c.version, revision: c.revision, at: c.at }));
    },
    async waitForReload({ versionId, timeoutMs = 1000 }) {
      if (knobs.webSees === false || knobs.webReloadFails) {
        return { reloaded: false, elapsedMs: timeoutMs, reason: "the frame never reloaded the announced version" };
      }
      const head = mock.frameHead();
      if (head.versionId !== versionId) {
        return { reloaded: false, elapsedMs: 0, reason: `the frame reloaded ${head.versionId}, not ${versionId}` };
      }
      return { reloaded: true, versionId: head.versionId, version: head.version, checksum: head.checksum, revision: head.revision, elapsedMs: 10 };
    },
    async close() {},
  };
}

/** Run the chain with fakes; the shared wiring a test needs. */
async function runChain({ row, fixture, mock, scratch, knobs = {}, stepTimeoutMs = 400 } = {}) {
  const kind = FIXTURE_KIND[fixture];
  const app = createFakeApp({ runDir: scratch.dir, mock, documentId: mock.state.docId, kind, knobs: knobs.app });
  const web = createFakeWeb({ mock, documentId: mock.state.docId, kind, knobs: knobs.web });
  const result = await runCrossHostRow({
    row,
    fixture,
    runDir: scratch.dir,
    repoRoot: REPO_ROOT,
    fetchImpl: mock.fetchImpl,
    stepTimeoutMs,
    pollMs: 20,
    appFactory: async () => app,
    webFactory: async () => web,
    hooks: {
      afterWebSave: (commit) => {
        app.noteRemoteCommit(commit);
        if (knobs.app?.reloadOnWebSave) app.reloadTo(mock.head());
      },
      afterAppCommit: (commit) => app.noteRemoteCommit(commit),
    },
  });
  return { result, app, web };
}

describe("G7-04 cross-host CLI args and exit mapping", () => {
  it("parseCrossHostArgs resolves --row/--fixture/--run-dir/--timeout-ms/--dry-run and the fixture default", () => {
    const args = parseCrossHostArgs(["--row", "G7-A01", "--fixture", "fx-docx-report-vi", "--run-dir", "/tmp/run"]);
    assert.equal(args.row, "G7-A01");
    assert.equal(args.fixture, "fx-docx-report-vi");
    assert.equal(args.runDir, resolve("/tmp/run"));
    assert.equal(args.dryRun, false);
    const all = parseCrossHostArgs(["--row", "G5-A03"]);
    assert.equal(all.fixture, "all");
    assert.equal(parseCrossHostArgs(["--row", "G5-A03", "--dry-run"]).dryRun, true);
    assert.throws(() => parseCrossHostArgs(["--fixture", "fx-docx-report-vi"]), /--row/);
    assert.throws(() => parseCrossHostArgs(["--row", "G8-A01", "--fixture", "all"]), /G7-A01|G5-A03/);
    assert.throws(() => parseCrossHostArgs(["--row", "G7-A01", "--fixture", "fx-pptx-deck-vi"]), /fixture/);
    assert.throws(() => parseCrossHostArgs(["--row", "G7-A01", "--what"]), /unknown argument/);
  });

  it("refuses `--fixture all` under evidence.mjs run (one invocation writes one ledger line)", () => {
    assert.throws(
      () => parseCrossHostArgs(["--row", "G7-A01"], { OFFICE_EVIDENCE_ID: "ev-g7-a01-0001" }),
      /one fixture per evidence line/,
    );
  });

  it("exitCodeFor maps PASS 0 / FAIL 1 / BLOCKED 77 and anything else to 1", () => {
    assert.equal(exitCodeFor("PASS"), 0);
    assert.equal(exitCodeFor("FAIL"), 1);
    assert.equal(exitCodeFor("BLOCKED"), BLOCKED_EXIT);
    assert.equal(exitCodeFor("WAT"), 1);
    assert.equal(DEFAULT_STEP_TIMEOUT_MS > 0, true);
  });

  it("every route the driver calls is a row of the tracer contract table", () => {
    assert.ok(CROSS_HOST_API_CALLS.length >= 10);
    for (const name of CROSS_HOST_API_CALLS) {
      assert.ok(name in TRACER_API_CALLS, `${name} must be in TRACER_API_CALLS`);
    }
  });

  it("ROW_IDS and FIXTURE_IDS name the two matrix rows and two fixture ids", () => {
    assert.deepEqual([...ROW_IDS], ["G7-A01", "G5-A03"]);
    assert.deepEqual([...FIXTURE_IDS], ["fx-xlsx-revenue-xyz", "fx-docx-report-vi"]);
    assert.deepEqual({ ...FIXTURE_KIND }, { "fx-xlsx-revenue-xyz": "sheets", "fx-docx-report-vi": "docs" });
  });
});

describe("G7-04 cross-host outcome decisions (pure)", () => {
  const step = (over = {}) => ({ source: "app", status: "PASS", ...over });
  const chainRecord = (over = {}) => {
    const steps = {
      seed: step({ source: "protocol" }),
      "web-open": step({ source: "web" }),
      "web-save-1": step({ source: "web" }),
      "app-open": step({ source: "app" }),
      "app-dirty": step({ source: "app-ui" }),
      "web-save-2": step({ source: "web" }),
      "dirty-kept": step({ source: "app" }),
      "app-reload": step({ source: "app-ui" }),
      "app-offline-save": step({ source: "app-ui" }),
      "app-reconnect": step({ source: "app" }),
      "web-sees": step({ source: "web" }),
      "ai-turn": step({ source: "protocol" }),
      "ai-save": step({ source: "app" }),
      "final-shas": step({ source: "protocol" }),
    };
    return {
      row: "G7-A01",
      fixture: "fx-docx-report-vi",
      steps,
      versionCounts: { v1: 1, afterWebSave1: 2, afterWebSave2: 3, whileCut: 3, afterReconnect: 4, afterAiTurn: 4, afterAiSave: 5, final: 5 },
      userSaves: [{ version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }],
      aiTurns: [{ versionsBefore: 4, versionsAfter: 4 }],
      checksums: { server: "s1", webContent: "s1", desktopWorkingCopy: "s1" },
      ...over,
    };
  };

  it("PASSes the happy chain and needs no blocker", () => {
    const out = decideCrossHostOutcome(chainRecord());
    assert.equal(out.status, "PASS");
    assert.equal(out.exitCode, 0);
  });

  it("FAILs a checksum divergence between the hosts (never a delay)", () => {
    const out = decideCrossHostOutcome(
      chainRecord({ checksums: { server: "s1", webContent: "s1", desktopWorkingCopy: "s2" } }),
    );
    assert.equal(out.status, "FAIL");
    assert.equal(out.exitCode, 1);
    assert.match(out.reason, /checksum/i);
  });

  it("FAILs when the dirty editor was replaced by the incoming web version", () => {
    const out = decideCrossHostOutcome(
      chainRecord({ steps: { ...chainRecord().steps, "dirty-kept": step({ status: "FAIL", reason: "the app reloaded the incoming version over its dirty edit" }) } }),
    );
    assert.equal(out.status, "FAIL");
    assert.equal(out.exitCode, 1);
    assert.match(out.reason, /dirty/i);
  });

  it("FAILs when the web never observes the reconnect version", () => {
    const out = decideCrossHostOutcome(
      chainRecord({ steps: { ...chainRecord().steps, "web-sees": step({ source: "web", status: "FAIL", reason: "no doc.remoteVersion announcement for v4 within 20000 ms" }) } }),
    );
    assert.equal(out.status, "FAIL");
    assert.equal(out.exitCode, 1);
    assert.match(out.reason, /remoteVersion|web-sees/);
  });

  it("FAILs a tally mismatch: one version per user Save, zero per AI turn", () => {
    const extraAi = decideCrossHostOutcome(
      chainRecord({ aiTurns: [{ versionsBefore: 4, versionsAfter: 5 }], versionCounts: { ...chainRecord().versionCounts, afterAiTurn: 5 } }),
    );
    assert.equal(extraAi.status, "FAIL");
    assert.match(extraAi.reason, /AI turn/i);

    const missingSave = decideCrossHostOutcome(
      chainRecord({ versionCounts: { ...chainRecord().versionCounts, final: 4, afterAiSave: 4 } }),
    );
    assert.equal(missingSave.status, "FAIL");
    assert.match(missingSave.reason, /tally|version/i);
  });

  it("BLOCKS (77) with the acceptance.md l.87 reason when only the AI step could not run", () => {
    const steps = { ...chainRecord().steps, "ai-turn": step({ source: "protocol", status: "BLOCKED", blocker: REAL_AI_BLOCKER, owner: "g7-qa" }) };
    const out = decideCrossHostOutcome(chainRecord({ steps }));
    assert.equal(out.status, "BLOCKED");
    assert.equal(out.exitCode, BLOCKED_EXIT);
    assert.match(out.reason, new RegExp(REAL_AI_BLOCKER));
  });

  it("never PASSes a row whose chain was recorded for another row, and FAILs a step that did not run", () => {
    const missing = chainRecord();
    delete missing.steps["app-dirty"];
    const out = decideCrossHostOutcome({ ...missing, row: "G5-A03" });
    assert.equal(out.status, "FAIL");
    assert.match(out.reason, /app-dirty/);
  });

  it("FAIL wins over BLOCKED", () => {
    const steps = {
      ...chainRecord().steps,
      "ai-turn": step({ source: "protocol", status: "BLOCKED", blocker: REAL_AI_BLOCKER, owner: "g7-qa" }),
      "web-sees": step({ source: "web", status: "FAIL", reason: "no announcement" }),
    };
    const out = decideCrossHostOutcome(chainRecord({ steps }));
    assert.equal(out.status, "FAIL");
    assert.equal(out.exitCode, 1);
  });
});

describe("G7-04 cross-host chain with fakes (rows G7-A01 / G5-A03)", () => {
  it("G5-A03 on fx-xlsx-revenue-xyz: web save -> app receives, dirty app kept, offline desktop save -> web sees it: PASS", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer();
    mock.state.kind = "sheets";
    try {
      const { result } = await runChain({ row: "G5-A03", fixture: "fx-xlsx-revenue-xyz", mock, scratch });
      assert.equal(result.status, "PASS", result.reason);
      assert.equal(result.exitCode, 0);
      assert.equal(result.record.steps["web-save-1"].status, "PASS");
      assert.equal(result.record.steps["app-open"].versionId, result.record.versionIds.v2);
      assert.equal(result.record.steps["dirty-kept"].status, "PASS");
      assert.equal(result.record.steps["app-reload"].status, "PASS");
      assert.equal(result.record.steps["web-sees"].versionId, result.record.versionIds.v4);
      assert.equal(result.record.versionCounts.final, 4);
      assert.deepEqual(result.record.checksums.webContent, result.record.checksums.server);
      assert.deepEqual(result.record.checksums.desktopWorkingCopy, result.record.checksums.server);
      // the AI steps are G7-A01's: a G5-A03 chain must not run them
      assert.equal(result.record.steps["ai-turn"], undefined);
    } finally {
      scratch.cleanup();
    }
  });

  it("G7-A01 on fx-docx-report-vi with a real-labelled AI turn: PASS with one version per Save and zero per AI turn", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM = "1";
    try {
      const { result } = await runChain({ row: "G7-A01", fixture: "fx-docx-report-vi", mock, scratch });
      assert.equal(result.status, "PASS", result.reason);
      assert.equal(result.record.versionCounts.afterAiTurn, result.record.versionCounts.afterReconnect);
      assert.equal(result.record.versionCounts.afterAiSave, result.record.versionCounts.afterReconnect + 1);
      assert.equal(result.record.versionCounts.final, 5);
      assert.equal(result.record.aiTurns[0].versionsAfter - result.record.aiTurns[0].versionsBefore, 0);
      assert.equal(result.record.steps["ai-turn"].status, "PASS");
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });

  it("G7-A01 under AI_PROVIDER=fake is BLOCKED (77) with the acceptance.md l.87 reason and never PASS", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "fake" });
    mock.state.kind = "docs";
    try {
      const { result } = await runChain({ row: "G7-A01", fixture: "fx-docx-report-vi", mock, scratch });
      assert.equal(result.exitCode, BLOCKED_EXIT);
      assert.equal(result.status, "BLOCKED");
      assert.match(result.blocker, new RegExp(REAL_AI_BLOCKER));
      // the deterministic mechanics around the AI turn still ran and are recorded
      assert.equal(result.record.versionCounts.afterAiTurn, result.record.versionCounts.afterReconnect);
      assert.equal(result.record.versionCounts.afterAiSave, result.record.versionCounts.afterReconnect + 1);
      assert.equal(result.record.steps["ai-turn"].status, "BLOCKED");
    } finally {
      scratch.cleanup();
    }
  });

  it("FAILs (exit 1) the whole row when the committed bytes diverge between the hosts", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer();
    try {
      const { result } = await runChain({
        row: "G5-A03",
        fixture: "fx-xlsx-revenue-xyz",
        mock,
        scratch,
        knobs: { web: { divergentWebContent: true } },
      });
      assert.equal(result.status, "FAIL");
      assert.equal(result.exitCode, 1);
      assert.match(result.reason, /checksum/i);
    } finally {
      scratch.cleanup();
    }
  });

  it("FAILs (exit 1) when the app reloads the web version over its dirty edit (G5-A03.3)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer();
    try {
      const { result } = await runChain({
        row: "G5-A03",
        fixture: "fx-xlsx-revenue-xyz",
        mock,
        scratch,
        knobs: { app: { reloadOnWebSave: true } },
      });
      assert.equal(result.status, "FAIL");
      assert.equal(result.exitCode, 1);
      assert.match(result.reason, /dirty/i);
    } finally {
      scratch.cleanup();
    }
  });

  it("FAILs (exit 1) when the web never sees the reconnect version (G5-A03.2 / G7-A01.4)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer();
    try {
      const { result } = await runChain({
        row: "G5-A03",
        fixture: "fx-xlsx-revenue-xyz",
        mock,
        scratch,
        knobs: { web: { webSees: false } },
      });
      assert.equal(result.status, "FAIL");
      assert.equal(result.exitCode, 1);
      assert.match(result.reason, /announcement|remoteVersion|web-sees/);
    } finally {
      scratch.cleanup();
    }
  });

  it("BLOCKS (77) the row with a named reason when the app cannot be made dirty through CDP", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer();
    try {
      const { result } = await runChain({
        row: "G5-A03",
        fixture: "fx-xlsx-revenue-xyz",
        mock,
        scratch,
        knobs: { app: { dirtyBlocked: true, dirtyReason: "the editor page exposes no working control surface on this fork" } },
      });
      assert.equal(result.status, "BLOCKED");
      assert.equal(result.exitCode, BLOCKED_EXIT);
      assert.match(result.blocker, /control surface/i);
      assert.notEqual(result.status, "PASS");
    } finally {
      scratch.cleanup();
    }
  });

  it("FAILs (exit 1) when the AI turn itself creates a version (G6-A03 violation)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "buggy-auto-save" });
    mock.state.kind = "docs";
    try {
      const { result } = await runChain({ row: "G7-A01", fixture: "fx-docx-report-vi", mock, scratch });
      assert.equal(result.status, "FAIL");
      assert.match(result.reason, /AI turn/i);
    } finally {
      scratch.cleanup();
    }
  });
});

describe("G7-04 cross-host start gate and dry run", () => {
  it("FAILs (exit 1) when start-status.json reports failed", async () => {
    const scratch = makeScratchRunDir({ startState: "failed", startReason: "server build failed" });
    const mock = createMockDServer();
    try {
      const result = await runCrossHostRow({
        row: "G7-A01",
        fixture: "fx-docx-report-vi",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
      });
      assert.equal(result.exitCode, 1);
      assert.equal(result.status, "FAIL");
      assert.match(result.reason, /server build failed/);
    } finally {
      scratch.cleanup();
    }
  });

  it("BLOCKS (exit 77) when start-status.json reports blocked", async () => {
    const scratch = makeScratchRunDir({ startState: "blocked", startReason: "missing xvfb" });
    const mock = createMockDServer();
    try {
      const result = await runCrossHostRow({
        row: "G5-A03",
        fixture: "fx-xlsx-revenue-xyz",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
      });
      assert.equal(result.exitCode, BLOCKED_EXIT);
      assert.equal(result.status, "BLOCKED");
      assert.match(result.blocker, /missing xvfb/);
    } finally {
      scratch.cleanup();
    }
  });

  it("--dry-run returns the gate's outcome without touching the stack or the fakes", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer();
    let factoryCalls = 0;
    try {
      const result = await runCrossHostRow({
        row: "G7-A01",
        fixture: "fx-docx-report-vi",
        runDir: scratch.dir,
        repoRoot: REPO_ROOT,
        fetchImpl: mock.fetchImpl,
        dryRun: true,
        appFactory: async () => {
          factoryCalls += 1;
          return createFakeApp({ runDir: scratch.dir, mock, documentId: DOC_ID });
        },
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.status, "PASS");
      assert.equal(factoryCalls, 0, "a dry run must not connect to the app");
      assert.equal(mock.state.calls.length, 0, "a dry run must not call the server");
      assert.match(JSON.stringify(result.plan), /dry-run/);
    } finally {
      scratch.cleanup();
    }
  });
});

describe("G7-04 evidence.mjs run + verify integration", () => {
  it("writes one ledger line per (row, fixture) through evidence.mjs and passes evidence.mjs verify", async () => {
    const mock = createMockDServer();
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
      if (ct.includes("multipart/form-data")) initBody = await request.formData();
      else if (rawBody.length > 0) initBody = rawBody.toString("utf8");
      const response = await mock.fetchImpl(url, { method: req.method, headers: req.headers, body: initBody });
      res.statusCode = response.status;
      for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    const scratch = makeScratchRunDir({ signedIn: false });
    writeFileSync(
      join(scratch.dir, "ports.env"),
      [
        `API_ORIGIN=http://127.0.0.1:${port}`,
        "WEB_ORIGIN=http://127.0.0.1:13000",
        "HARNESS_SKIP_APP=1",
        "",
      ].join("\n"),
    );
    const outDir = join(scratch.dir, "evidence-out");
    const evidenceScript = join(REPO_ROOT, "scripts/office/g5g6g7/evidence.mjs");
    const driverScript = join(REPO_ROOT, "scripts/office/g5g6g7/g7-04/cross-host.mjs");

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
        { row: "G7-A01", fixture: "fx-xlsx-revenue-xyz" },
        { row: "G7-A01", fixture: "fx-docx-report-vi" },
        { row: "G5-A03", fixture: "fx-xlsx-revenue-xyz" },
        { row: "G5-A03", fixture: "fx-docx-report-vi" },
      ];
      for (const c of cases) {
        const run = await runCmd(
          [
            evidenceScript,
            "run",
            "--req",
            c.row,
            "--fixture",
            c.fixture,
            "--checker",
            "tester-cloud",
            "--out",
            outDir,
            "--",
            process.execPath,
            driverScript,
            "--row",
            c.row,
            "--fixture",
            c.fixture,
            "--run-dir",
            scratch.dir,
          ],
          { ...process.env, OFFICE_FORK_SHA: "ab12238f" },
        );
        assert.equal(run.status, BLOCKED_EXIT, `${c.row}/${c.fixture} exit status (${run.stderr})`);
      }
      const verify = await runCmd([evidenceScript, "verify", "--out", outDir]);
      assert.equal(verify.status, 0, `evidence.mjs verify failed: ${verify.stderr}`);
      assert.match(verify.stdout, /evidence verify: OK \(4 records\)/);

      const lines = readFileSync(join(outDir, "evidence.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      assert.deepEqual(
        lines.map((l) => ({ req: l.requirementId, fixture: l.fixtureId, result: l.result, exitCode: l.exitCode })),
        [
          { req: "G7-A01", fixture: "fx-xlsx-revenue-xyz", result: "BLOCKED", exitCode: 77 },
          { req: "G7-A01", fixture: "fx-docx-report-vi", result: "BLOCKED", exitCode: 77 },
          { req: "G5-A03", fixture: "fx-xlsx-revenue-xyz", result: "BLOCKED", exitCode: 77 },
          { req: "G5-A03", fixture: "fx-docx-report-vi", result: "BLOCKED", exitCode: 77 },
        ],
      );
      for (const line of lines) {
        assert.equal(line.blocker, "command reported skip (exit 77)");
        const artifact = readFileSync(resolve(REPO_ROOT, line.artifact), "utf8");
        assert.match(artifact, /not started the fork app|no live WEB_ORIGIN|did not start the fork app/i);
      }
    } finally {
      await new Promise((r) => server.close(r));
      scratch.cleanup();
    }
  });
});
