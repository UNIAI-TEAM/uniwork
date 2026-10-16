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

import { EDIT_DRIVERS } from "../g8-19/anchors.mjs";
import { TRACER_API_CALLS } from "../g7-10/tracer.mjs";
import {
  ANNOUNCE_OPEN_TOLERANCE_MS,
  BLOCKED_EXIT,
  CROSS_HOST_API_CALLS,
  DEFAULT_STEP_TIMEOUT_MS,
  DIRTY_EDIT_PLANS,
  FEED_NUDGE_LIMIT,
  FIXTURE_IDS,
  FIXTURE_KIND,
  FRAME_READ_NO_BUDGET,
  REAL_AI_BLOCKER,
  ROW_IDS,
  ROW_REQUIRED_STEPS,
  announceGuardVerdict,
  appIntentRecordName,
  decideCrossHostOutcome,
  dependentSteps,
  driveAppConflictReloadFlow,
  driveFrameReloadFlow,
  evaluateReloadWindow,
  exitCodeFor,
  frameRemoteState,
  freshOpensAfter,
  installFrameRecorder,
  isDecimalRevisionText,
  makeAppDirty,
  newerBarReport,
  parseCrossHostArgs,
  readFrameMessages,
  readFrameReports,
  readFrameRemoteSurface,
  readRemoteNewerSurface,
  remoteNewerMissReason,
  revisionOfFile,
  runCrossHostRow,
  signOutPreviousSession,
  summarizeFrameRecordings,
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
/** Another document of the same user: its `.rec` must never satisfy THIS row's offline Save (BE-704-404). */
const OTHER_DOC_ID = "01JDOC00000000000000000002";
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
  // The fork names one intent record after its KEY: `recordFileName(key) = sha256(key).rec`
  // (`uniwork-sync/store/paths.ts`) and the intent key is the working-copy folder segment, which is
  // the document id (`uniwork-docs/service.ts` `dirFor(deploymentId, accountId, documentId)`,
  // `save-coordinator.ts` `intents.put(doc.key, …)`). The fake writes the same names the fork
  // writes, so a row that accepts another document's record is caught (BE-704-404).
  const ownIntentName = appIntentRecordName(documentId);
  const otherDocIntentName = appIntentRecordName(OTHER_DOC_ID);
  const writeIntent = (name) => {
    mkdirSync(intentsDir, { recursive: true });
    writeFileSync(join(intentsDir, name), "sealed-intent");
  };
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
    nudges: 0,
    // a write the real app makes only after its own Save round-trip (D2-01)
    pendingSettle: null,
    workingCopyPath,
    kind,
    /**
     * The real app writes its offline receipt (the intent file and the binding)
     * only once the module's own Save lands: `aiOffice.uniworkSave` asks the
     * module to write and returns (`service.ts:3642`), and the module's Save is
     * what calls `onUserSave` (`service.ts:2936`) -> the coordinator mints the
     * intent (`save-coordinator.ts:477-518`). A fake that writes it inline hides
     * a driver that reads once, so this arms the write to happen after `reads`
     * reads of `workingCopy()`.
     */
    deferSettle(reads, apply) {
      const remaining = Number(reads) || 0;
      if (remaining <= 0) {
        apply();
        return;
      }
      app.pendingSettle = { remaining, apply };
    },
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
      // a deferred settle lands on the read that reaches zero (never inside
      // `apply`, so a nested read cannot tick twice)
      const pending = app.pendingSettle;
      if (pending && --pending.remaining <= 0) {
        app.pendingSettle = null;
        pending.apply();
      }
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
      // a bar that names another version: the step must not accept it as this
      // version's bar (BE-704-303)
      if (knobs.barVersion !== undefined && knobs.barVersion !== version) {
        return { visible: true, version: knobs.barVersion, text: `Có phiên bản mới hơn trên UniWork (phiên bản ${knobs.barVersion})`, where: "editor" };
      }
      // the bar only after the app's own feed pass: the nth nudge brings it (D2-04)
      if (knobs.barAfterNudges && app.nudges < knobs.barAfterNudges) {
        return { visible: false, reason: `the feed has not told the app yet (nudges=${app.nudges})` };
      }
      if (!app.dirty || !newer) return { visible: false, reason: `dirty=${app.dirty} newer=${newer}` };
      return { visible: true, version, text: `Có phiên bản mới hơn trên UniWork (phiên bản ${version})`, where: knobs.barWhere ?? "editor" };
    },
    async clickReload({ version = null } = {}) {
      app.calls.push(`clickReload:${version ?? "any"}`);
      if (knobs.reloadUnavailable) return { clicked: false, reason: "no reload action matched" };
      // the fork's confirm refuses while the keep choice is unmade (D4-02):
      // `canSubmit = selectedKeep === 'discard' || …` (uniwork-conflict-model.ts:326)
      if (knobs.reloadConfirmStaysDisabled) {
        return {
          clicked: true,
          confirmed: false,
          choseDiscard: false,
          confirmReason: 'the reload confirm "Reload" stayed disabled (the dialog waits for the keep choice)',
        };
      }
      // the working copy reaches the web Save's bytes ANYWAY (a stray reload, another sync path)
      // while the click the driver made was never confirmed with the discard choice: the row must
      // not accept the final state on that alone (BE-704-403)
      if (knobs.reloadUnconfirmedButSettles) {
        app.dirty = false;
        app.reloadTo(mock.head());
        return { clicked: true, confirmed: false, choseDiscard: true, confirmReason: "the reload confirm never became usable" };
      }
      app.dirty = false;
      app.reloadTo(mock.head());
      return { clicked: true, confirmed: true, confirmText: "Reload", choseDiscard: true };
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
    /** The tracer's forced feed pass: cut, retry, restore, retry (counted for D2-04). */
    async nudgeSync() {
      app.calls.push("nudgeSync");
      app.nudges += 1;
      return { nudged: true };
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
        const edited = bytes ?? standInBytes ?? editedBytes(mock.head().bytes, knobs.offlineMarker ?? "desktop-offline-edit");
        const hold = () => {
          writeIntent(ownIntentName);
          mkdirSync(docsDir, { recursive: true });
          writeFileSync(workingCopyPath, edited);
          writeFileSync(
            join(docsDir, "binding.json"),
            JSON.stringify({ ...binding, baseVersion: Number(binding.baseVersion) + (knobs.offlineBaseMoves ? 1 : 0), state: "offline", error: "network" }),
          );
        };
        // an app that never writes its receipt: no intent, no offline state
        if (knobs.otherDocIntentAfterReads > 0) {
          // another open document of the same user writes ITS OWN new `.rec` while THIS document's
          // Save is held: the row must not read that as its own receipt (BE-704-404)
          app.deferSettle(knobs.otherDocIntentAfterReads, () => writeIntent(otherDocIntentName));
        }
        if (knobs.offlineNeverHolds) return { saved: false, held: false, binding };
        app.deferSettle(knobs.offlineIntentAfterReads, hold);
        return { saved: false, held: true, binding };
      }
      if (app.offline === true && knobs.restoreOnSave !== false) return { saved: false, held: true, binding };
      const edited = bytes ?? standInBytes ?? readFileSync(workingCopyPath);
      const commit = () => {
        const res = mock.commit({
          bytes: edited,
          baseRevision: head.revision,
          source: "app",
          idempotencyKey: idempotencyKey ?? `app-cross-host-${documentId}-${mock.state.versions.length}`,
        });
        if (res.status !== 200) return { saved: false, reason: `commit answered ${res.status}` };
        rmSync(join(intentsDir, ownIntentName), { force: true });
        const v = mock.head();
        app.reloadTo(v);
        return { saved: true, binding: app.workingCopy().binding };
      };
      // the stand-in Save is the one after the AI turn; knobs delay or drop its
      // commit + binding the way the real one lands after the IPC call returns
      if (standInBytes && knobs.standInSaveNeverSettles) return { saved: false, held: false, binding };
      // the commit lands and the binding names it, but the local bytes are not the
      // committed ones: the `ai-save` poll's checksum half is what fails (BE-704-305)
      if (standInBytes && knobs.standInSaveLocalBytesMismatch) {
        const res = commit();
        if (res.saved) writeFileSync(workingCopyPath, editedBytes(mock.head().bytes, "local-mismatch"));
        return res;
      }
      if (standInBytes && Number(knobs.standInSaveSettleAfterReads) > 0) {
        app.deferSettle(knobs.standInSaveSettleAfterReads, commit);
        return { saved: false, held: false, binding };
      }
      return commit();
    },
    async close() {
      app.calls.push("close");
    },
  };
  // A previous row's parked work: `confirmed` sign-out parks unsent work rather
  // than dropping it (the pinned fork parks/locks it), so the user-level intents
  // dir can already hold a `.rec` before THIS row's Save (BE-704-302). It belongs
  // to ANOTHER document's key, which is why it can never be this row's receipt
  // (BE-704-404).
  if (knobs.staleIntent) writeIntent(otherDocIntentName);
  return app;
}

/**
 * The fake web host controller: the page "sees" every commit the mock recorded
 * (`announcements`) and reloads the head after one, unless a knob disables it.
 */
function createFakeWeb({ mock, documentId, kind = "sheets", knobs = {} } = {}) {
  // the documents of the page: one real (message-reading) frame, or N renderers that never answer
  // so a row's frame reads are what the test measures (BE-704-405)
  const frames = Array.from({ length: Math.max(1, Number(knobs.hungFrames) || 1) }, (_, index) => ({
    url: () => `http://localhost:36009/office-frame/${index === 0 ? "docs" : `frame${index}`}/index.html`,
    evaluate: () => (knobs.hungFrames ? new Promise(() => {}) : Promise.resolve([])),
  }));
  const web = {
    calls: [],
    reloadWindow: null,
    /** The frame's own `office-frame` GETs, recorded the way the real controller records them. */
    opens: [],
    /** When the announce the fake delivered last landed, so an open can be timed against it. */
    announceAt: 0,
    async open() {
      web.calls.push("open");
      return knobs.frameFailed
        ? { opened: false, status: "blocked", reason: "the web sheets frame did not reach data-state=ready", failureKind: "missing" }
        : { opened: true, status: "ready" };
    },
    async editAndSave({ marker }) {
      web.calls.push("editAndSave");
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
    async announcements({ sinceMs = 0, deadlineMs = null } = {}) {
      web.calls.push("announcements");
      if (knobs.hungFrames) {
        // the REAL reader over hung renderers (BE-704-405): what the row must bound is the reads
        // the poll itself makes, so this path uses the driver's own implementation, not a canned answer
        const reports = await readFrameReports({
          frames,
          deadlineMs: Number.isFinite(deadlineMs) ? deadlineMs : Date.now() + (Number(knobs.hungFrameBudgetMs) || 250),
          perReadTimeoutMs: Number(knobs.hungFramePerReadMs) || 10_000,
        });
        return summarizeFrameRecordings(reports, sinceMs).announcements;
      }
      if (knobs.webSees === false) return [];
      const list = mock.state.commits
        .filter((c) => c.at >= sinceMs && c.source !== "web")
        .map((c) => ({
          kind: "event",
          type: "doc.remoteVersion",
          ns: "uniwork.office.docs",
          v: 1,
          versionId: c.versionId,
          version: c.version,
          // the D host announces the DOCUMENT revision, a decimal string (its `doc.revision`
          // after the commit); the fake carried the mock's revision id here, which is no
          // decimal at all — the measurement would then name a guard the real wire never fails
          revision: String(c.version),
          revisionType: "string",
          documentId: documentId,
          documentIdType: typeof documentId,
          versionIdType: typeof c.versionId,
          savedAt: "2026-10-16T00:00:00Z",
          savedAtType: "string",
          href: "http://localhost:36009/office-frame/docs/index.html",
          origin: "http://localhost:36009",
          fromParent: true,
          at: c.at,
          ...(knobs.announce ?? {}),
        }));
      if (list.length > 0) web.announceAt = list[list.length - 1].at;
      return list;
    },
    /**
     * The reload action INSIDE the frame (D4-01/BE-704-402): the real one is a click on the
     * frame's own control, and the driver drives it before it waits for the fresh `api.open`.
     * A CLEAN frame reloads the moment the announce lands, so its GET is recorded HERE — before
     * this call returns (BE-704-401). It carries the announced version id, never a `download`
     * choice (BE-704-402).
     */
    async clickReload({ versionId = null } = {}) {
      web.calls.push(`clickReload:${versionId ?? "any"}`);
      const head = mock.frameHead();
      const announced = mock.state.commits.filter((c) => c.source !== "web").at(-1);
      if (announced) web.announceAt = announced.at;
      if (knobs.reloadClickUnavailable) return { clicked: false, bar: false, reason: "the frame carries no reload action" };
      if (knobs.reloadNoDiscardChoice) {
        // the pinned reload step pushes `download` FIRST when the host can download
        // (`conflict-dialog.ts:424-446`): a driver that clicks the first `[data-choice]` would
        // click it and never reload — so NO fresh GET is recorded here (BE-704-402)
        return {
          clicked: true,
          bar: true,
          choseDiscard: false,
          frame: "docs",
          label: "Reload latest…",
          choices: ["download", "back"],
          reason: 'the reload step offers no "discard" choice (it offers: download, back)',
        };
      }
      // the reload HAPPENS from here: its GET is recorded, for a CLEAN frame the moment the
      // announce lands — i.e. before this call returns (BE-704-401)
      if (!knobs.webReloadFails) {
        web.opens.push({
          at: knobs.autoOpenBeforeAnnounce ? web.announceAt - 60 : web.announceAt + 5,
          pathname: `/api/v1/office-frame/documents/${documentId}`,
          answered: true,
          failed: false,
          versionId: head.versionId,
          version: head.version,
          revision: String(head.version),
          checksum: head.checksum_sha256,
        });
      }
      return { clicked: true, bar: true, choseDiscard: true, frame: "docs", label: "Reload latest…" };
    },
    /**
     * The fresh `office-frame` GET poll: the driver's OWN window logic (`evaluateReloadWindow`)
     * over the opens recorded by the click, so the announce anchor is what decides here
     * (BE-704-401) instead of a canned answer.
     */
    async waitForReload({ versionId, sinceMs = null, timeoutMs = 1000 }) {
      web.calls.push("waitForReload");
      web.reloadWindow = sinceMs;
      const verdict = evaluateReloadWindow(web.opens, { versionId, sinceMs });
      if (knobs.webSees === false || knobs.webReloadFails) {
        return { reloaded: false, elapsedMs: timeoutMs, opensSeen: verdict.opensSeen, opensBefore: verdict.opensBefore, reason: verdict.reason };
      }
      if (!verdict.reloaded) {
        return { reloaded: false, elapsedMs: 0, opensSeen: verdict.opensSeen, opensBefore: verdict.opensBefore, reason: verdict.reason };
      }
      const hit = verdict.hit;
      return { reloaded: true, versionId: hit.versionId, version: hit.version, checksum: hit.checksum, revision: hit.revision, elapsedMs: 10 };
    },
    /** What a frame audit read: the recorder counts, and any per-read failure (BE-704-304/405). */
    async frameAudit({ deadlineMs = null } = {}) {
      web.calls.push("frameAudit");
      if (knobs.hungFrames) {
        const reports = await readFrameReports({
          frames,
          deadlineMs: Number.isFinite(deadlineMs) ? deadlineMs : Date.now() + (Number(knobs.hungFrameBudgetMs) || 250),
          perReadTimeoutMs: Number(knobs.hungFramePerReadMs) || 10_000,
        });
        return summarizeFrameRecordings(reports, 0);
      }
      const failed = Number(knobs.frameReadErrors) || 0;
      return {
        announcements: [],
        frames: failed > 0 ? failed : 1,
        recorders: 0,
        events: 0,
        types: [],
        readErrors: failed,
        readErrorReasons: failed > 0 ? [`the frame read timed out after ${Number(knobs.frameReadTimeoutMs) || 5000} ms`] : [],
      };
    },
    /** What each document showed when the reload did not happen (D4-01). */
    async frameSurface() {
      web.calls.push("frameSurface");
      return [
        {
          url: `http://localhost:36009/acme/ws/documents/${documentId}`,
          host: knobs.frameHost ?? { state: "ready", dirty: true, saveState: "idle" },
          surface: null,
          error: "",
        },
        {
          url: "http://localhost:36009/office-frame/docs/index.html",
          host: null,
          surface: knobs.frameBar ?? null,
          error: knobs.frameSurfaceError ?? "",
        },
      ];
    },
    /**
     * What the frame's own realm held and heard (D5-01), built from `knobs.frameRealm` and run
     * through the driver's own helpers — the way the real controller reads it off Playwright's
     * frames. The default realm is the editor frame holding the seeded version 1 and receiving
     * the announce the mock recorded.
     */
    async frameEvidence({ versionId = null } = {}) {
      web.calls.push("frameEvidence");
      const announcements = await web.announcements({ sinceMs: 0 });
      const realm =
        typeof knobs.frameRealm === "function" ? knobs.frameRealm({ documentId, announcements, versionId }) : knobs.frameRealm;
      const reports = realm ?? [
        { url: `http://localhost:36009/acme/ws/documents/${documentId}`, messages: [], readError: "" },
        {
          url: "http://localhost:36009/office-frame/docs/index.html",
          messages: [
            { kind: "request", type: "open", file: { fileId: documentId, versionId: "v-seeded", revision: "1", etag: null }, at: 1 },
            ...announcements,
          ],
          readError: "",
        },
      ];
      const state = frameRemoteState(reports, { versionId });
      return { ...state, verdict: announceGuardVerdict(state) };
    },
    async close() {},
  };
  return web;
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

  it("FAILs a BLOCKED step with no named blocker (BE-704-10): it cannot be attributed, so it is not a BLOCKED", () => {
    const steps = { ...chainRecord().steps, "app-dirty": step({ source: "app-ui", status: "BLOCKED", blocker: "   " }) };
    const out = decideCrossHostOutcome(chainRecord({ row: "G5-A03", steps }));
    assert.equal(out.status, "FAIL");
    assert.equal(out.exitCode, 1);
    assert.match(out.reason, /app-dirty/);
    assert.match(out.reason, /blocker/i);
    // a BLOCKED step that DOES name its blocker keeps the row BLOCKED (77)
    const named = { ...chainRecord().steps, "app-dirty": step({ source: "app-ui", status: "BLOCKED", blocker: "the editor refused the plan", owner: "g7-qa" }) };
    assert.equal(decideCrossHostOutcome(chainRecord({ row: "G5-A03", steps: named })).status, "BLOCKED");
  });

  it("D1-04: a BLOCKED step skips exactly the steps that consume its result, and G7-A01 runs no dirty-editor step", () => {
    // the G5-A03 dirty cluster: web-save-2/dirty-kept/app-reload read the dirty
    // edit; the desktop half and final-shas read nothing it produced
    assert.deepEqual(dependentSteps("G5-A03", "app-dirty"), ["web-save-2", "dirty-kept", "app-reload"]);
    assert.deepEqual(dependentSteps("G5-A03", "app-reconnect"), ["web-sees", "final-shas"]);
    assert.deepEqual(dependentSteps("G5-A03", "app-dirty").includes("app-offline-save"), false);
    // a BLOCKED AI turn stops nothing (the Save after it still runs, D1-04/l.87)
    assert.deepEqual(dependentSteps("G7-A01", "ai-turn"), []);
    // the dirty-editor step belongs to G5-A03.3 only
    assert.deepEqual([...ROW_REQUIRED_STEPS["G7-A01"]].filter((name) => ["app-dirty", "web-save-2", "dirty-kept", "app-reload"].includes(name)), []);
    assert.deepEqual([...ROW_REQUIRED_STEPS["G5-A03"]].filter((name) => ["app-dirty", "web-save-2", "dirty-kept", "app-reload"].includes(name)), ["app-dirty", "web-save-2", "dirty-kept", "app-reload"]);
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

  it("records per edit step whether the run drove it through the editor UI (uiEdits: real|standin, BE-704-08), in the record and the artifact", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer();
    try {
      const { result } = await runChain({ row: "G5-A03", fixture: "fx-xlsx-revenue-xyz", mock, scratch });
      // the fake editor page drives both edits (the dirty one and the offline one)
      assert.deepEqual(result.record.uiEdits, { dirty: "real", offlineSave: "real", aiSave: "standin" });
      const artifact = JSON.parse(readFileSync(result.artifactPath, "utf8"));
      assert.deepEqual(artifact.uiEdits, result.record.uiEdits);
      // a stand-in offline edit stays allowed, and stays visible at row level
      const standIn = await runChain({
        row: "G5-A03",
        fixture: "fx-xlsx-revenue-xyz",
        mock: createMockDServer(),
        scratch,
        knobs: { app: { dirtyBlocked: true, dirtyReason: "the editor page exposes no working control surface on this fork" } },
      });
      assert.equal(standIn.result.record.steps["app-offline-save"].status, "PASS");
      assert.equal(standIn.result.record.uiEdits.offlineSave, "standin");
      assert.equal(standIn.result.record.uiEdits.dirty, "standin", "a step that never ran drove no UI edit");
      assert.match(standIn.result.record.notes.join(" "), /stand-in/i);
    } finally {
      scratch.cleanup();
    }
  });

  it("G7-A01 on fx-docx-report-vi with a real-labelled AI turn: PASS, one version per Save, zero per AI turn, no dirty-edit step (D1-04)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM = "1";
    try {
      const { result } = await runChain({ row: "G7-A01", fixture: "fx-docx-report-vi", mock, scratch });
      assert.equal(result.status, "PASS", result.reason);
      assert.equal(result.record.versionCounts.afterAiTurn, result.record.versionCounts.afterReconnect);
      assert.equal(result.record.versionCounts.afterAiSave, result.record.versionCounts.afterReconnect + 1);
      // seed v1 + web-save-1 + reconnect + ai-save: the dirty-editor web Save is G5-A03's
      assert.equal(result.record.versionCounts.final, 4);
      assert.equal(result.record.aiTurns[0].versionsAfter - result.record.aiTurns[0].versionsBefore, 0);
      assert.equal(result.record.steps["ai-turn"].status, "PASS");
      // an editor control that never becomes ready cannot block G7-A01: it drives no dirty step
      for (const name of ["app-dirty", "web-save-2", "dirty-kept", "app-reload"]) {
        assert.equal(result.record.steps[name], undefined, `${name} must not run in the G7-A01 chain`);
      }
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

  it("BLOCKS (77) the row with a named reason when the app cannot be made dirty through CDP, and the desktop half still runs (D1-04)", async () => {
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
      assert.equal(result.record.steps["app-dirty"].status, "BLOCKED");
      // the steps that read the dirty edit are skipped, not failed
      for (const name of ["web-save-2", "dirty-kept", "app-reload"]) {
        assert.equal(result.record.steps[name].status, "SKIPPED", `${name} consumes the dirty edit's result`);
        assert.match(result.record.steps[name].reason, /BLOCKED/);
      }
      // ... and the steps that read nothing the dirty step produced still ran (G5-A03.2)
      for (const name of ["app-offline-save", "app-reconnect", "web-sees", "final-shas"]) {
        assert.equal(result.record.steps[name].status, "PASS", `${name} must still run after a BLOCKED dirty step`);
      }
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

describe("G7-04 cross-host D2-01: the app's own Save is read asynchronously (round 2)", () => {
  /** The G7-A01 chain with the real-labelled AI turn the row needs. */
  const runG7A01 = (mock, scratch, knobs, stepTimeoutMs) => {
    process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM = "1";
    return runChain({ row: "G7-A01", fixture: "fx-docx-report-vi", mock, scratch, knobs, stepTimeoutMs });
  };

  it("app-offline-save waits for the app's own receipt: an intent that lands only after N polls still PASSes", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      const { result, app } = await runG7A01(mock, scratch, { app: { offlineIntentAfterReads: 3 } });
      assert.equal(result.status, "PASS", result.reason);
      const step = result.record.steps["app-offline-save"];
      assert.equal(step.status, "PASS");
      assert.equal(step.intentFiles, 1, "the settled step must report the intent the app wrote");
      // the offline Save held: no server version while the link was cut
      assert.equal(result.record.versionCounts.whileCut, 2);
      assert.equal(app.calls.filter((call) => call === "saveOffline").length, 1);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });

  it("app-offline-save FAILs after the bound with the observed intent count, binding state and baseVersion when the app never holds the Save", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      const { result } = await runG7A01(mock, scratch, { app: { offlineNeverHolds: true } }, 300);
      assert.equal(result.status, "FAIL");
      assert.equal(result.exitCode, 1);
      const step = result.record.steps["app-offline-save"];
      assert.equal(step.status, "FAIL");
      assert.match(step.reason, /no NEW save intent and no offline state/i);
      assert.match(step.reason, /intents=0/);
      assert.match(step.reason, /binding state "ready"/);
      assert.match(step.reason, /baseVersion=2/);
      assert.ok(step.elapsedMs >= 300, `the step must wait its whole bound before failing (waited ${step.elapsedMs} ms)`);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });

  it("app-offline-save still FAILs when the app parks an intent but moves its base while cut", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      const { result } = await runG7A01(mock, scratch, { app: { offlineIntentAfterReads: 2, offlineBaseMoves: true } });
      assert.equal(result.status, "FAIL");
      assert.match(result.record.steps["app-offline-save"].reason, /moved the app base/);
      assert.match(result.record.steps["app-offline-save"].reason, /want v2/);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });

  it("app-offline-save FAILs on a STALE prior-row intent: this row's Save must be NEW (BE-704-302)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      // the user-level dir already holds a `.rec` from an earlier parked row, and
      // THIS row's offline Save never writes one and never parks the binding
      const { result } = await runG7A01(mock, scratch, { app: { staleIntent: true, offlineNeverHolds: true } }, 300);
      assert.equal(result.status, "FAIL");
      assert.equal(result.exitCode, 1);
      const step = result.record.steps["app-offline-save"];
      assert.equal(step.status, "FAIL");
      // the measured values: the stale count is visible, the NEW count is what failed
      assert.match(step.reason, /intents=1\b/);
      assert.match(step.reason, /newIntents=0\b/);
      assert.match(step.reason, /binding state "ready"/);
      assert.match(step.reason, /baseVersion=2/);
      assert.ok(step.elapsedMs >= 300, `the step must wait its whole bound before failing (waited ${step.elapsedMs} ms)`);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });

  it("app-offline-save PASSes on the current Save's own new intent beside a stale one (BE-704-302)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      const { result, app } = await runG7A01(mock, scratch, { app: { staleIntent: true, offlineIntentAfterReads: 2 } });
      assert.equal(result.status, "PASS", result.reason);
      const step = result.record.steps["app-offline-save"];
      assert.equal(step.status, "PASS");
      assert.equal(step.intentFiles, 2, "both the stale intent and this Save's own are on disk");
      assert.equal(step.newIntentFiles, 1, "only this Save's intent is new");
      assert.equal(step.documentIntentFiles, 1, "and only ONE of them belongs to this document (BE-704-404)");
      assert.equal(app.calls.filter((call) => call === "saveOffline").length, 1);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });

  it("ai-save waits for the commit and the app binding: a Save that settles only after N polls still PASSes", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      const { result } = await runG7A01(mock, scratch, { app: { standInSaveSettleAfterReads: 3 } });
      assert.equal(result.status, "PASS", result.reason);
      const step = result.record.steps["ai-save"];
      assert.equal(step.status, "PASS");
      assert.equal(result.record.versionCounts.afterAiSave, result.record.versionCounts.afterReconnect + 1);
      assert.equal(result.record.checksums.desktopWorkingCopy, result.record.checksums.server);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });

  it("ai-save FAILs after the bound with what it observed when the app binding never reaches the Save", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      const { result } = await runG7A01(mock, scratch, { app: { standInSaveNeverSettles: true } }, 300);
      assert.equal(result.status, "FAIL");
      // the reconnect committed normally: only the Save after the AI turn is missing
      assert.equal(result.record.steps["app-reconnect"].status, "PASS");
      const step = result.record.steps["ai-save"];
      assert.equal(step.status, "FAIL");
      assert.match(step.reason, /did not create exactly one version/);
      assert.match(step.reason, new RegExp(`server v${result.record.versionCounts.afterReconnect}\\b`));
      assert.match(step.reason, new RegExp(`want v${result.record.versionCounts.afterReconnect + 1}`));
      assert.ok(step.elapsedMs >= 300, `the step must wait its whole bound before failing (waited ${step.elapsedMs} ms)`);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });

  it("ai-save's timeout names the measured checksums when the working copy is not the committed bytes (BE-704-305)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      // the Save commits vN and the binding names it, but the local bytes differ:
      // the poll's checksum half is what never settles, and a reason that printed
      // only the versions would hide it (the D2-01 test above cannot catch that)
      const { result } = await runG7A01(mock, scratch, { app: { standInSaveLocalBytesMismatch: true } }, 300);
      assert.equal(result.status, "FAIL");
      const step = result.record.steps["ai-save"];
      assert.equal(step.status, "FAIL");
      assert.ok(step.elapsedMs >= 300, `the step must wait its whole bound before failing (waited ${step.elapsedMs} ms)`);
      const want = result.record.versionCounts.afterReconnect + 1;
      assert.match(step.reason, new RegExp(`server v${want}\\b`));
      assert.match(step.reason, new RegExp(`app v${want}\\b`));
      assert.match(step.reason, new RegExp(`want v${want}\\b`));
      assert.ok(!/Checksum=<redacted>/.test(step.reason), `the measured checksums must survive the artifact's redactor: ${step.reason}`);
      // the reason groups each digest with a `.` every 8 chars so `redactSignInError` leaves it
      // alone; the grouped value is the full measured checksum
      const serverChecksum = /serverChecksum=([0-9a-f.]{16,})/.exec(step.reason)?.[1]?.replace(/\./g, "");
      const appChecksum = /appChecksum=([0-9a-f.]{16,})/.exec(step.reason)?.[1]?.replace(/\./g, "");
      assert.match(serverChecksum ?? "", /^[0-9a-f]{64}$/, `the reason must name the server head's measured checksum: ${step.reason}`);
      assert.match(appChecksum ?? "", /^[0-9a-f]{64}$/, `the reason must name the app working copy's measured checksum: ${step.reason}`);
      assert.notEqual(appChecksum, serverChecksum, "the mismatch is the point: the two measured checksums must differ");
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });
});

describe("G7-04 cross-host D2-04: the S6 new-version bar is read from the fork's own wording", () => {
  /** Run `readRemoteNewerSurface` against a page whose DOM the caller describes. */
  const withPage = (elements, actions, run) => {
    const saved = globalThis.document;
    globalThis.document = {
      querySelectorAll: (selector) => (selector.includes("button") ? actions : elements),
    };
    try {
      return run();
    } finally {
      if (saved === undefined) delete globalThis.document;
      else globalThis.document = saved;
    }
  };

  const textEl = (text) => ({ textContent: text });
  const reloadEl = (label) => ({ textContent: label, getAttribute: () => null, click: () => {} });

  it("finds a dirty document's bar (vi) and the version it names, with its reload action", () => {
    // the fork's own strings: uwRemoteNewerDirty + uwRemoteReload at e99471fe2
    const message =
      "Có phiên bản mới hơn trên UniWork (phiên bản 3). Thay đổi của bạn chưa lưu nên tài liệu không tự tải lại.";
    const probe = withPage([textEl(message)], [reloadEl("Tải lại bản mới nhất…")], () => readRemoteNewerSurface({ version: 3 }));
    assert.equal(probe.visible, true);
    assert.equal(probe.version, 3);
    assert.equal(probe.actionFound, true);
    assert.match(probe.text, /phiên bản mới hơn trên UniWork/);
  });

  it("finds the English wording too, and ignores the auto-hide 'updated' bar the step must not mistake for it", () => {
    const english = "A newer version is on UniWork (version 4). You have unsaved changes, so the document didn’t reload.";
    assert.equal(withPage([textEl(english)], [reloadEl("Reload latest…")], () => readRemoteNewerSurface({ version: 4 })).version, 4);
    // the clean bar ("Đã cập nhật lên phiên bản 3 …" / "Updated to version 3 …") is not this step's bar
    const updated = "Đã cập nhật lên phiên bản 3 do một thành viên lưu lúc 10:00.";
    const probe = withPage([textEl(updated)], [reloadEl("Tải lại bản mới nhất…")], () => readRemoteNewerSurface({ version: 3 }));
    assert.equal(probe.visible, false);
  });

  it("says the probe could not run when it threw, never 'no new-version bar' (D3-02)", () => {
    assert.equal(remoteNewerMissReason(3, []), "no new-version bar naming version 3 on any app page");
    const threw = remoteNewerMissReason(3, ["REMOTE_NEWER_TEXT is not defined"]);
    assert.equal(threw, "the new-version probe could not run: REMOTE_NEWER_TEXT is not defined");
    assert.ok(!threw.includes("no new-version bar"), `a harness failure must not read as a product miss: ${threw}`);
    assert.equal(remoteNewerMissReason(null, [null, "page crashed"]), "the new-version probe could not run: page crashed");
    // the bar the step records: a probe that threw never reaches the step as "no bar" (D3-02)
    assert.deepEqual(newerBarReport({ page: null, probe: null, probeErrors: ["REMOTE_NEWER_TEXT is not defined"] }, 3), {
      visible: false,
      reason: "the new-version probe could not run: REMOTE_NEWER_TEXT is not defined",
    });
  });

  it("is self-contained: the page-style evaluation of the probe finds the bar (D3-02, the cloud D3 crash)", () => {
    // Playwright serializes only the function's own source (new Function("return (" + fn + ")")),
    // so a module-scope wording never reaches the page; this is that evaluation, exactly.
    const asPageSeesIt = new Function("return (" + String(readRemoteNewerSurface) + ")")();
    const vi = "Có phiên bản mới hơn trên UniWork (phiên bản 5). Thay đổi của bạn chưa lưu nên tài liệu không tự tải lại.";
    const en = "A newer version is on UniWork (version 6). You have unsaved changes, so the document didn’t reload.";
    const viProbe = withPage([textEl(vi)], [reloadEl("Tải lại bản mới nhất…")], () => asPageSeesIt({ version: 5 }));
    const enProbe = withPage([textEl(en)], [reloadEl("Reload latest…")], () => asPageSeesIt({ version: 6 }));
    assert.equal(viProbe.visible, true);
    assert.equal(viProbe.version, 5);
    assert.equal(enProbe.visible, true);
    assert.equal(enProbe.version, 6);
  });

  it("the bar's verdict keeps the page when the probe answered (D3-02)", () => {
    const page = { url: () => "genoffice-app://docs/index.html?mode=tab" };
    assert.deepEqual(newerBarReport({ page, probe: { version: 3, text: "phiên bản 3" }, probeErrors: [] }, 3), {
      visible: true,
      version: 3,
      text: "phiên bản 3",
      where: "docs",
    });
    assert.deepEqual(newerBarReport({ page: null, probe: null, probeErrors: [] }, 3), {
      visible: false,
      reason: "no new-version bar naming version 3 on any app page",
    });
  });

  it("never treats another version's bar as the requested one (BE-704-303)", () => {
    // the page shows a valid bar for version 3 while the step asks for version 4
    const v3 = "A newer version is on UniWork (version 3). You have unsaved changes, so the document didn’t reload.";
    const probe = withPage([textEl(v3)], [reloadEl("Reload latest…")], () => readRemoteNewerSurface({ version: 4 }));
    assert.equal(probe.visible, false, "a bar for another version is not this step's bar");
    assert.equal(probe.version, null, "no bar names version 4, so no version is reported for it");
    assert.equal(probe.actionFound, true, "the page still carries the reload action");
    // the same guard at the caller's verdict, so a page pair can never smuggle it through
    const page = { url: () => "genoffice-app://docs/index.html?mode=tab" };
    assert.deepEqual(newerBarReport({ page, probe: { version: 3, text: v3 }, probeErrors: [] }, 4), {
      visible: false,
      reason: "no new-version bar naming version 4 on any app page",
    });
    // with no version asked for, any bar is still an answer (clickReload's own search)
    assert.equal(withPage([textEl(v3)], [reloadEl("Reload latest…")], () => readRemoteNewerSurface({ version: null })).visible, true);
  });

  it("re-runs the feed nudge while the bar is missing: a bar that only lands on the 2nd nudge still PASSes dirty-kept", async () => {
    assert.ok(FEED_NUDGE_LIMIT >= 2, "the step must be allowed more than one nudge");
    const scratch = makeScratchRunDir();
    const mock = createMockDServer();
    try {
      const { result, app } = await runChain({
        row: "G5-A03",
        fixture: "fx-xlsx-revenue-xyz",
        mock,
        scratch,
        knobs: { app: { barAfterNudges: 2 } },
      });
      assert.equal(result.status, "PASS", result.reason);
      assert.equal(result.record.steps["dirty-kept"].status, "PASS");
      assert.equal(result.record.steps["dirty-kept"].feedNudges, 2);
      assert.ok(app.nudges >= 2, `the app must have been nudged twice, got ${app.nudges}`);
      // then the bar's reload is driven on the same surface
      assert.equal(result.record.steps["app-reload"].status, "PASS");
    } finally {
      scratch.cleanup();
    }
  });

  it("dirty-kept FAILs when the only bar names another version (BE-704-303)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer();
    try {
      // the page carries a bar for v2 while the web just saved v3
      const { result } = await runChain({
        row: "G5-A03",
        fixture: "fx-xlsx-revenue-xyz",
        mock,
        scratch,
        knobs: { app: { barVersion: 2 } },
      });
      assert.equal(result.status, "FAIL");
      const step = result.record.steps["dirty-kept"];
      assert.equal(step.status, "FAIL");
      assert.match(step.reason, /names version 2, not 3/);
    } finally {
      scratch.cleanup();
    }
  });
});

describe("G7-04 cross-host D3-01: the web announce is read from every document's recorder", () => {
  /** The protocol envelope the vendored host posts (packages/core/office/docs-frame-protocol.ts). */
  const envelope = (kind, type, payload) => ({ ns: "uniwork.office.docs", v: 1, kind, type, payload });
  const remote = (versionId, revision) => envelope("event", "doc.remoteVersion", { document_id: DOC_ID, revision, version_id: versionId, saved_at: "2026-10-16T00:00:00Z" });
  // The recorder and the reader both travel into the page, so both are built here the way
  // Playwright builds them: from their own source, with no module scope in reach.
  const asPageSeesIt = (fn) => new Function("return (" + String(fn) + ")")();
  /** A document that ran the recorder (addInitScript) and then received `messages`. */
  const received = (messages, realm = {}) => {
    const url = realm.url ?? "http://localhost:36009/office-frame/docs/index.html";
    const handlers = [];
    const win = {
      addEventListener: (name, fn) => handlers.push([name, fn]),
      location: { href: url },
      parent: "parent" in realm ? realm.parent : { parent: true },
    };
    asPageSeesIt(installFrameRecorder)(win);
    for (const message of messages) {
      // a bare envelope is wrapped the way the page receives it (from the parent window); an
      // explicit event (with its own `source`/`origin`) is passed through, which is how the
      // D5-01 fields are measured
      const event =
        message && typeof message === "object" && "data" in message
          ? { origin: new URL(url).origin, source: win.parent, ...message }
          : { data: message, origin: new URL(url).origin, source: win.parent };
      for (const [name, fn] of handlers) if (name === "message") fn(event);
    }
    return win;
  };
  const read = (win) => asPageSeesIt(readFrameMessages)(win);

  it("records the announce a document receives and answers the page-style reader", () => {
    const win = received([remote("v3", "10"), envelope("event", "theme", { theme: "light" }), "not an envelope", { kind: "event" }, null]);
    const list = read(win);
    assert.equal(list.length, 2, "only protocol envelopes are recorded");
    assert.deepEqual(
      { ...list[0], at: undefined },
      {
        kind: "event",
        type: "doc.remoteVersion",
        ns: "uniwork.office.docs",
        v: 1,
        versionId: "v3",
        versionIdType: "string",
        version: null,
        revision: "10",
        revisionType: "string",
        documentId: DOC_ID,
        documentIdType: "string",
        savedAt: "2026-10-16T00:00:00Z",
        savedAtType: "string",
        reason: null,
        file: null,
        href: "http://localhost:36009/office-frame/docs/index.html",
        origin: "http://localhost:36009",
        fromParent: true,
        at: undefined,
      },
    );
    assert.ok(Number.isInteger(list[0].at));
  });

  it("records the announce's own JS types, its realm and whether the parent sent it (D5-01)", () => {
    // the round-5 wording ("the frame's own guard needs a DECIMAL revision") asserted a type
    // nobody had read: these are the fields that measure it, and a message that did NOT come
    // from the parent window is recorded as such instead of being counted as delivered
    const stranger = { stranger: true };
    const win = received(
      [
        { data: remote("v3", "10"), origin: "http://evil.example", source: stranger },
        remote("v4", 11),
      ],
      { url: "http://localhost:36009/office-frame/docs/index.html" },
    );
    const [dropped, numeric] = read(win);
    assert.equal(dropped.fromParent, false, "a message from another window is measured, not assumed");
    assert.equal(dropped.origin, "http://evil.example");
    assert.equal(dropped.revisionType, "string");
    assert.equal(numeric.revision, 11);
    assert.equal(numeric.revisionType, "number");
    // the frame's own window: the recorder says which realm recorded the announce
    assert.equal(numeric.href, "http://localhost:36009/office-frame/docs/index.html");
  });

  it("records the file a host open push or an api.open / api.save reply carried (D5-01)", () => {
    const file = (over = {}) => ({ fileId: DOC_ID, versionId: "v1", revision: "1", etag: null, ...over });
    const win = received([
      envelope("request", "open", { file: file(), source: { kind: "bytes" } }),
      envelope("response", "api.save", { ok: true, file: file({ versionId: "v2", revision: "2" }), versionId: "v2" }),
      envelope("response", "api.saveAs", { save: { ok: true, file: file({ versionId: "v9" }) }, rebind: {} }),
      envelope("event", "theme", { theme: "dark" }),
    ]);
    const list = read(win);
    assert.deepEqual(list[0].file, { fileId: DOC_ID, versionId: "v1", revision: "1", etag: null });
    assert.deepEqual(list[1].file, { fileId: DOC_ID, versionId: "v2", revision: "2", etag: null });
    assert.equal(list[2].file.versionId, "v9", "an api.saveAs reply's file is read from its `save`");
    assert.equal(list[3].file, null, "a message without a file records none");
  });

  it("finds the announce in the FRAME that received it, not in the top page (the D3-01 miss)", () => {
    const top = read(received([envelope("event", "theme", { theme: "light" })]));
    const frame = read(received([remote("v3", "10")]));
    const reports = [
      { url: "http://localhost:36009/acme/ws/documents/" + DOC_ID, messages: top },
      { url: "http://localhost:36009/office-frame/docs/index.html", messages: frame },
    ];
    // Reading the top page alone (the round-2 driver) can never see the host's announce, which
    // the D host posts to the FRAME's window (docs-frame-endpoint.ts:238, peer = iframe.contentWindow)...
    assert.deepEqual(summarizeFrameRecordings([reports[0]], 0).announcements, []);
    // ... and the merge over every document of the page finds it, once.
    const summary = summarizeFrameRecordings(reports, 0);
    assert.deepEqual(summary.announcements.map((a) => a.versionId), ["v3"]);
    assert.equal(summary.recorders, 2);
    // a `sinceMs` after the announce keeps a poll looking instead of matching an old one
    assert.deepEqual(summarizeFrameRecordings(reports, Date.now() + 1).announcements, []);
  });

  it("a miss reports what was measured: the documents read, the recorders found, the protocol types", () => {
    const summary = summarizeFrameRecordings(
      [
        { url: "http://localhost:36009/acme/ws/documents/" + DOC_ID, messages: read(received([envelope("request", "api.open", {}), envelope("response", "api.open", {})])) },
        { url: "about:blank", messages: null },
      ],
      0,
    );
    assert.equal(summary.frames, 2);
    assert.equal(summary.recorders, 1, "a document without the recorder is counted, not hidden");
    assert.equal(summary.events, 0);
    assert.deepEqual(summary.types, ["request:api.open x1", "response:api.open x1"]);
  });
});

describe("G7-04 cross-host BE-704-304: every frame read has its own timeout", () => {
  it("bounds a hung frame read and reports the expiry instead of waiting forever", async () => {
    const hung = { url: () => "http://localhost:36009/office-frame/docs/index.html", evaluate: () => new Promise(() => {}) };
    const started = Date.now();
    const [report] = await readFrameReports({ frames: [hung], deadlineMs: Date.now() + 60, perReadTimeoutMs: 60 });
    assert.equal(report.messages, null, "a read that never answered reports no messages");
    assert.match(report.readError, /timed out after \d\d ms/);
    assert.ok(Date.now() - started >= 55, `the read must hold its bound before answering (answered after ${Date.now() - started} ms)`);
  });

  it("keeps a read's own failure, so a broken frame reads as a measured miss too", async () => {
    const broken = { url: () => "about:blank", evaluate: () => Promise.reject(new Error("frame detached")) };
    const [report] = await readFrameReports({ frames: [broken], deadlineMs: Date.now() + 5_000 });
    assert.equal(report.messages, null);
    assert.match(report.readError, /frame detached/);
  });

  it("an answered frame still yields its recorded envelopes", async () => {
    const frame = { url: () => "about:blank", evaluate: async () => [{ kind: "event", type: "doc.remoteVersion", versionId: "v3", at: 1 }] };
    const [report] = await readFrameReports({ frames: [frame], deadlineMs: Date.now() + 5_000 });
    assert.equal(report.readError, "");
    assert.deepEqual(report.messages.map((m) => m.versionId), ["v3"]);
  });

  it("counts the failed reads in the merge the miss reason reports", () => {
    const summary = summarizeFrameRecordings(
      [
        { url: "http://localhost/doc", messages: [{ kind: "event", type: "theme", at: 1 }], readError: "" },
        { url: "http://localhost/frame", messages: null, readError: "the frame read timed out after 60 ms" },
      ],
      0,
    );
    assert.equal(summary.frames, 2);
    assert.equal(summary.recorders, 1, "a read that failed is not a document that carried the recorder");
    assert.equal(summary.readErrors, 1);
    assert.deepEqual(summary.readErrorReasons, ["the frame read timed out after 60 ms"]);
  });

  it("reports the failed read in the web-sees miss, measured, instead of hiding it", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM = "1";
      const { result } = await runChain({
        row: "G7-A01",
        fixture: "fx-docx-report-vi",
        mock,
        scratch,
        knobs: { web: { webSees: false, frameReadErrors: 1, frameReadTimeoutMs: 9000 } },
        stepTimeoutMs: 300,
      });
      assert.equal(result.status, "FAIL");
      const step = result.record.steps["web-sees"];
      assert.equal(step.status, "FAIL");
      assert.match(step.reason, /announced no doc\.remoteVersion/);
      assert.match(step.reason, /1 frame read\(s\) failed: the frame read timed out after 9000 ms/);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });
});

describe("G7-04 cross-host D4-01: the frame's own S6 reload is driven and measured", () => {
  const runG7A01 = (mock, scratch, knobs, stepTimeoutMs) => {
    process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM = "1";
    return runChain({ row: "G7-A01", fixture: "fx-docx-report-vi", mock, scratch, knobs, stepTimeoutMs });
  };

  it("drives the frame's reload control after the announce, then requires the fresh open", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      const { result, web } = await runG7A01(mock, scratch, {});
      assert.equal(result.status, "PASS", result.reason);
      const step = result.record.steps["web-sees"];
      assert.equal(step.status, "PASS");
      const reconnectVersionId = result.record.versionIds[`v${result.record.versionCounts.afterReconnect}`];
      assert.ok(
        web.calls.includes(`clickReload:${reconnectVersionId}`),
        `the frame's own reload must be driven for the announced version: ${web.calls.join(", ")}`,
      );
      assert.ok(web.calls.includes("waitForReload"), "the fresh open is still required after the click");
      // the step records what the click did, so a record says whether a bar had to be clicked
      assert.equal(result.record.details.webSees.reloadClick.clicked, true);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });

  it("FAILs with the measured frame surface and the click outcome when the reload never happens (D4-01)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      const { result } = await runG7A01(
        mock,
        scratch,
        {
          web: {
            webReloadFails: true,
            frameBar: {
              bar: "A newer version is on UniWork (version 3). You have unsaved changes, so the document didn’t reload.",
              actions: [{ action: "reload", label: "Reload latest…" }],
              dialog: false,
              choices: [],
              dirty: true,
            },
          },
        },
        300,
      );
      assert.equal(result.status, "FAIL");
      const step = result.record.steps["web-sees"];
      assert.equal(step.status, "FAIL");
      assert.match(step.reason, /did not reload the announced version/);
      // the click outcome and what the frame showed are both in the reason (never "no reload" alone)
      assert.match(step.reason, /announced version_id \S+ revision \S+/);
      assert.match(step.reason, /clicked "Reload latest…" in the docs frame/);
      assert.match(step.reason, /host\(state "ready", dirty=true\)/);
      assert.match(step.reason, /frame surface: /);
      assert.match(step.reason, /bar="A newer version is on UniWork/);
      assert.match(step.reason, /"action":"reload"/);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });
});

describe("G7-04 cross-host D5-01: the drop is named from measured values, and the window is the announce's", () => {
  /** The protocol envelope the vendored host posts (packages/core/office/docs-frame-protocol.ts). */
  const envelope = (kind, type, payload) => ({ ns: "uniwork.office.docs", v: 1, kind, type, payload });
  const file = (over = {}) => ({ fileId: DOC_ID, versionId: "v3", revision: "3", etag: null, ...over });
  const announce = (over = {}) => envelope("event", "doc.remoteVersion", { document_id: DOC_ID, revision: "3", version_id: "v3", saved_at: "2026-10-16T00:00:00Z", ...over });
  /** One document's records, built by the page-style recorder — the shape `frameRemoteState` reads. */
  const records = (messages, { url = "http://localhost:36009/office-frame/docs/index.html", parent = {} } = {}) => {
    const handlers = [];
    const win = { addEventListener: (name, fn) => handlers.push([name, fn]), location: { href: url }, parent };
    new Function("return (" + String(installFrameRecorder) + ")")()(win);
    for (const message of messages) {
      const event =
        message && typeof message === "object" && "data" in message
          ? { origin: new URL(url).origin, source: parent, ...message }
          : { data: message, origin: new URL(url).origin, source: parent };
      for (const [name, fn] of handlers) if (name === "message") fn(event);
    }
    return new Function("return (" + String(readFrameMessages) + ")")()(win);
  };
  const reported = (messages, { url = "http://localhost:36009/office-frame/docs/index.html", parent = {} } = {}) => [
    { url: `http://localhost:36009/acme/ws/documents/${DOC_ID}`, messages: [], readError: "" },
    { url, messages: records(messages, { url, parent }), readError: "" },
  ];
  const open = (over = {}) => envelope("request", "open", { file: file(over), source: { kind: "bytes" } });

  it("the pin's decimal predicate and its revisionOf are mirrored, not re-invented", () => {
    assert.equal(isDecimalRevisionText("3"), true);
    assert.equal(isDecimalRevisionText(3), false, "a JSON number is not the wire's revision");
    assert.equal(isDecimalRevisionText("03"), false);
    assert.equal(revisionOfFile({ revision: "3", etag: '"9"' }), "3", "the file's own revision wins");
    assert.equal(revisionOfFile({ revision: undefined, etag: '"9"' }), "9", "else its etag, quotes stripped");
    assert.equal(revisionOfFile({ etag: "not-a-number" }), null);
    assert.equal(revisionOfFile(null), null);
  });

  it("reads the frame's held file out of the realm that RECEIVED the announce", () => {
    const reports = [
      { url: `http://localhost:36009/acme/ws/documents/${DOC_ID}`, messages: records([open({ revision: "1" })], { url: "http://localhost:36009/acme/ws/documents/" + DOC_ID }), readError: "" },
      {
        url: "http://localhost:36009/office-frame/sheets/index.html",
        messages: records([
          open({ revision: "2", versionId: "v2" }),
          announce(),
          envelope("response", "api.save", { ok: true, file: file({ revision: "2", versionId: "v2", etag: '"2"' }), versionId: "v2" }),
        ]),
        readError: "",
      },
    ];
    const state = frameRemoteState(reports, { versionId: "v3" });
    assert.equal(state.announceRealm.isTop, false);
    assert.equal(state.announceRealm.url, "http://localhost:36009/office-frame/sheets/index.html");
    assert.equal(state.announce.revision, "3");
    assert.deepEqual(state.held, { fileId: DOC_ID, versionId: "v2", revision: "2", etag: '"2"', revisionOf: "2", at: state.held.at, envelope: "response:api.save" });
    assert.equal(state.documents.length, 2);
    assert.deepEqual(state.documents.map((d) => [d.isTop, d.messages]), [[true, 1], [false, 3]], "the page first (Playwright's frame order), then the frame");
  });

  it("names the guard the measured values fail, in the pin's own order (D5-01)", () => {
    const state = frameRemoteState(reported([open({ revision: "2" }), announce()]), { versionId: "v3" });
    // the values pass every guard: the driver must say so instead of inventing a guard
    assert.equal(announceGuardVerdict(state).guard, null);
    assert.match(announceGuardVerdict(state).detail, /no guard at the pin explains the drop/);
    // a revision that is not a decimal string: the one guard the round-5 wording guessed at,
    // now named only because the type was MEASURED
    const numeric = frameRemoteState(reported([open({ revision: "2" }), announce({ revision: 3 })]), { versionId: "v3" });
    assert.match(announceGuardVerdict(numeric).guard, /remote-version\.ts:443/);
    assert.match(announceGuardVerdict(numeric).detail, /3 \(number\)/);
    // the frame's fileId is another document's
    const other = frameRemoteState(reported([open({ fileId: "01JOTHER0000000000000000001", revision: "2" }), announce()]), { versionId: "v3" });
    assert.match(announceGuardVerdict(other).guard, /remote-version\.ts:445/);
    // the frame is already at (or past) the announced revision
    const ahead = frameRemoteState(reported([open({ revision: "3" }), announce()]), { versionId: "v3" });
    assert.match(announceGuardVerdict(ahead).guard, /remote-version\.ts:448/);
  });

  it("names the envelope-level drops too: the wrong window, the wrong source, the wrong ns", () => {
    // the announce was recorded in the TOP page: the frame never received it at all
    const topOnly = frameRemoteState(
      [
        { url: `http://localhost:36009/acme/ws/documents/${DOC_ID}`, messages: records([announce()], { url: "http://localhost:36009/acme/ws/documents/" + DOC_ID }), readError: "" },
        { url: "http://localhost:36009/office-frame/docs/index.html", messages: records([]), readError: "" },
      ],
      { versionId: "v3" },
    );
    assert.match(announceGuardVerdict(topOnly).guard, /post target/);
    // a message that did not come from the parent window is dropped by the endpoint's own check
    const stranger = frameRemoteState(
      reported([
        { data: announce(), origin: "http://evil.example", source: { stranger: true } },
        open({ revision: "2" }),
      ]),
      { versionId: "v3" },
    );
    assert.match(announceGuardVerdict(stranger).guard, /endpoint\.ts:264-275/);
    assert.match(announceGuardVerdict(stranger).detail, /origin "http:\/\/evil\.example", fromParent false/);
    // a foreign namespace never reaches a handler
    const foreign = frameRemoteState(
      reported([{ ...announce(), ns: "uniwork.office.other" }, open({ revision: "2" })]),
      { versionId: "v3" },
    );
    assert.match(announceGuardVerdict(foreign).guard, /types\.ts:1758-1760/);
    // and an unmeasured held file is reported as unmeasured, never as a guard
    const unmeasured = frameRemoteState(reported([announce()]), { versionId: "v3" });
    assert.equal(announceGuardVerdict(unmeasured).guard, null);
    assert.match(announceGuardVerdict(unmeasured).detail, /host\.current\(\) could not be measured/);
  });

  it("the reload window is the ANNOUNCE's own timestamp, so a reload recorded before the wait still counts (D5-01)", () => {
    const announceAt = 10_000;
    // the reload landed 40 ms after the announce and 900 ms before the driver started waiting:
    // round 5's window (the wait's own clock) filtered exactly this GET out
    const opens = [
      { at: announceAt - 5_000, pathname: "/api/v1/office-frame/documents/x", versionId: "v1" },
      { at: announceAt + 40, pathname: "/api/v1/office-frame/documents/x", versionId: "v3" },
      { at: announceAt + 3_000, pathname: "/api/v1/office-frame/documents/x", versionId: "v3" },
    ];
    assert.deepEqual(freshOpensAfter(opens, announceAt).map((o) => o.at), [announceAt + 40, announceAt + 3_000]);
    assert.deepEqual(freshOpensAfter(opens, announceAt + 900).map((o) => o.at), [announceAt + 3_000], "the old window, for contrast");
    assert.deepEqual(freshOpensAfter(opens, null).map((o) => o.at), opens.map((o) => o.at), "no anchor: everything recorded is fresh");
  });

  it("hands the announce's own timestamp to the wait, and reports the GETs that landed before it", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM = "1";
      const { result, web } = await runChain({
        row: "G7-A01",
        fixture: "fx-docx-report-vi",
        mock,
        scratch,
        knobs: { web: { webReloadFails: true } },
        stepTimeoutMs: 300,
      });
      assert.equal(result.status, "FAIL");
      const step = result.record.steps["web-sees"];
      assert.equal(step.status, "FAIL");
      // the window is the announce's own `at` (minus the postMessage->request hop's tolerance),
      // not the instant the step started waiting
      const announcedAt = result.record.details.webSeesMiss.announced.at;
      assert.equal(web.reloadWindow, Math.max(0, announcedAt - ANNOUNCE_OPEN_TOLERANCE_MS));
      // and the miss carries the frame's own realm, measured
      const miss = result.record.details.webSeesMiss;
      assert.equal(miss.held.fileId, mock.state.docId);
      assert.equal(miss.announceTypes.revision, "string");
      assert.match(step.reason, /the guard the measured values fail: /);
      assert.doesNotMatch(step.reason, /needs a DECIMAL revision/, "the unmeasured round-5 wording is gone");
      assert.match(step.reason, /received in a frame/);
      assert.doesNotMatch(step.reason, /received in the TOP page/);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });

  it("names the measured guard in the miss reason when a value actually fails one (D5-01)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM = "1";
      const { result } = await runChain({
        row: "G7-A01",
        fixture: "fx-docx-report-vi",
        mock,
        scratch,
        knobs: {
          web: {
            webReloadFails: true,
            // the frame's own realm: the announce arrived with a JSON NUMBER revision (the one
            // guard the round-5 wording guessed at, here measured) and the frame holds THIS
            // document at revision 1 — so the fileId guard passes and 443 is the one that fires
            frameRealm: ({ documentId, announcements }) => [
              { url: `http://localhost:36009/acme/ws/documents/${documentId}`, messages: [], readError: "" },
              {
                url: "http://localhost:36009/office-frame/docs/index.html",
                readError: "",
                messages: [
                  { kind: "request", type: "open", file: { fileId: documentId, versionId: "v-seeded", revision: "1", etag: null }, at: 1 },
                  { ...announcements[0], revision: 2, revisionType: "number", at: 2 },
                ],
              },
            ],
          },
        },
        stepTimeoutMs: 300,
      });
      assert.equal(result.status, "FAIL");
      const reason = result.record.steps["web-sees"].reason;
      assert.match(reason, /dropped by .*remote-version\.ts:443/);
      assert.match(reason, /the frame holds fileId \S+ at revision "1"/);
      assert.equal(result.record.details.webSeesMiss.verdict.guard.includes("remote-version.ts:443"), true);
      assert.equal(result.record.details.webSeesMiss.announceTypes.revision, "number");
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });
});

describe("G7-04 cross-host D4-02: the app's S6 reload is confirmed with the keep choice", () => {
  it("drives the bar's reload for the saved version and records the confirm it made", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer();
    try {
      const { result, app } = await runChain({ row: "G5-A03", fixture: "fx-xlsx-revenue-xyz", mock, scratch });
      assert.equal(result.status, "PASS", result.reason);
      assert.equal(result.record.steps["app-reload"].status, "PASS");
      // the bar is clicked for the version the web just saved (BE-704-303), and the confirm the
      // step made is on the record (D4-02)
      assert.ok(
        app.calls.includes(`clickReload:${result.record.versionCounts.afterWebSave2}`),
        `the reload must target the saved version: ${app.calls.join(", ")}`,
      );
      assert.equal(result.record.details.appReload.confirmed, true);
      assert.equal(result.record.details.appReload.choseDiscard, true);
      // the dirty checksum just BEFORE the click is on the record (BE-704-403), so the discard is
      // a measured before/after transition
      assert.equal(result.record.details.appReload.dirtyShaBeforeClick, result.record.details.dirtyEditSha);
      assert.ok(result.record.details.appReload.dirtyShaBeforeClick.length > 0);
    } finally {
      scratch.cleanup();
    }
  });

  it("FAILs with the measured confirm reason when the fork's confirm never becomes usable (D4-02/BE-704-403)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer();
    try {
      const { result } = await runChain({
        row: "G5-A03",
        fixture: "fx-xlsx-revenue-xyz",
        mock,
        scratch,
        knobs: { app: { reloadConfirmStaysDisabled: true } },
        stepTimeoutMs: 300,
      });
      assert.equal(result.status, "FAIL");
      const step = result.record.steps["app-reload"];
      assert.equal(step.status, "FAIL");
      // the reload is only accepted with the discard confirmation (BE-704-403), so this fails at
      // the click's own outcome instead of waiting out the settle bound and reporting a delay
      assert.match(step.reason, /was not confirmed with the discard choice/);
      assert.match(step.reason, /confirmed=false, choseDiscard=false/);
      assert.match(step.reason, /reload confirm "Reload" stayed disabled/);
      assert.ok(!/working copy <redacted>/.test(step.reason), `the measured bytes must survive the redactor: ${step.reason}`);
      assert.equal(result.record.details.appReload, undefined, "an unconfirmed reload records no appReload outcome");
    } finally {
      scratch.cleanup();
    }
  });

  it("FAILs although the working copy settles when the click was never confirmed (BE-704-403)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer();
    try {
      // the bytes reach the web Save's checksum anyway: accepting the final state on that alone
      // would PASS a row whose discard flow the fork never confirmed
      const { result } = await runChain({
        row: "G5-A03",
        fixture: "fx-xlsx-revenue-xyz",
        mock,
        scratch,
        knobs: { app: { reloadUnconfirmedButSettles: true } },
        stepTimeoutMs: 300,
      });
      assert.equal(result.status, "FAIL");
      const step = result.record.steps["app-reload"];
      assert.equal(step.status, "FAIL");
      assert.match(step.reason, /was not confirmed with the discard choice/);
      assert.match(step.reason, /confirmed=false, choseDiscard=true/);
      assert.match(step.reason, /the reload confirm never became usable/);
      // the settle poll was never reached: the chain stopped at the click's own outcome
      assert.equal(result.record.versionCounts.afterReconnect, undefined);
    } finally {
      scratch.cleanup();
    }
  });
});

describe("G7-04 cross-host BE-704-401: the reload window is anchored at the announce, not at the click", () => {
  it("accepts the clean frame's own auto-open even though it landed before the click returned", () => {
    const announceAt = 50_000;
    // the click took 900 ms and the announce-caused GET landed inside it
    const clickReturnedAt = announceAt + 900;
    const opens = [
      { at: announceAt - 5_000, pathname: "/api/v1/office-frame/documents/x", answered: true, versionId: "v-seeded" },
      { at: announceAt + 30, pathname: "/api/v1/office-frame/documents/x", answered: true, versionId: "v3", version: 3, revision: "3", checksum: "c3" },
    ];
    // the window round 5 used (the instant the driver started waiting) filters exactly this GET out
    assert.equal(evaluateReloadWindow(opens, { versionId: "v3", sinceMs: clickReturnedAt, now: clickReturnedAt }).reloaded, false);
    // the announce's own timestamp keeps it: the reload HAPPENED, the driver only noticed later
    const verdict = evaluateReloadWindow(opens, { versionId: "v3", sinceMs: announceAt - ANNOUNCE_OPEN_TOLERANCE_MS, now: clickReturnedAt });
    assert.equal(verdict.reloaded, true);
    assert.equal(verdict.hit.versionId, "v3");
    assert.equal(verdict.opensSeen, 1);
    assert.equal(verdict.opensBefore, 1, "the seeded GET before the announce stays excluded");
    // and an open before the announce is never taken for the reload, even when its version matches
    const stale = evaluateReloadWindow(
      [{ at: announceAt - 60, pathname: "/api/v1/office-frame/documents/x", answered: true, versionId: "v3" }],
      { versionId: "v3", sinceMs: announceAt - ANNOUNCE_OPEN_TOLERANCE_MS, now: clickReturnedAt },
    );
    assert.equal(stale.reloaded, false);
    assert.equal(stale.opensBefore, 1);
    assert.match(stale.reason, /landed before the announce/);
  });

  it("PASSes web-sees when the frame recorded its open inside the reload click (BE-704-401)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM = "1";
      const { result, web } = await runChain({ row: "G7-A01", fixture: "fx-docx-report-vi", mock, scratch });
      assert.equal(result.status, "PASS", result.reason);
      const step = result.record.steps["web-sees"];
      assert.equal(step.status, "PASS");
      const reconnectVersionId = result.record.versionIds[`v${result.record.versionCounts.afterReconnect}`];
      // the open the frame made for the announced version was recorded by the click itself…
      assert.equal(web.opens.length, 1);
      assert.equal(web.opens[0].versionId, reconnectVersionId);
      assert.ok(
        web.opens[0].at - web.announceAt <= ANNOUNCE_OPEN_TOLERANCE_MS,
        "the auto-open lands on the announce's own hop, so a click-anchored window would have filtered it out",
      );
      // …and the step still required the fresh open of the announced version id to claim the reload
      assert.equal(result.record.details.webSees.reload.versionId, reconnectVersionId);
      assert.equal(result.record.details.webSees.confirmed, true);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });

  it("FAILs when the only matching GET landed before the announce: that is a stale open, not the reload (BE-704-401)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM = "1";
      const { result, web } = await runChain({
        row: "G7-A01",
        fixture: "fx-docx-report-vi",
        mock,
        scratch,
        knobs: { web: { autoOpenBeforeAnnounce: true } },
        stepTimeoutMs: 300,
      });
      assert.equal(result.status, "FAIL");
      const step = result.record.steps["web-sees"];
      assert.equal(step.status, "FAIL");
      assert.match(step.reason, /did not reload the announced version/);
      assert.match(step.reason, /landed before the announce/);
      assert.equal(result.record.details.webSeesMiss.opens.beforeTheAnnounce, 1);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });
});

/**
 * The page-style DOM harness (BE-704-406): the driver's serialized page functions run against a
 * fake document the way Playwright runs them (`new Function("return (" + String(fn) + ")")()`),
 * with only the selectors and element behaviours the PINNED markup needs — `data-choice` order,
 * `aria-disabled`, a radio that only becomes checked when clicked.
 */
const parseSelAttr = (text) => {
  const eq = text.indexOf("=");
  if (eq < 0) return { name: text.trim(), value: null };
  const raw = text.slice(eq + 1).trim();
  return { name: text.slice(0, eq).trim(), value: /^["'].*["']$/.test(raw) ? raw.slice(1, -1) : raw };
};
const parseCompound = (text) => {
  const m = /^([a-zA-Z0-9-]*)((?:\.[\w-]+|\[[^\]]+\])*)$/.exec(text.trim());
  if (!m) throw new Error(`the fake DOM does not support the selector "${text}"`);
  const classes = [];
  const attrs = [];
  for (const part of m[2].match(/\.([\w-]+)|\[([^\]]+)\]/g) ?? []) {
    if (part.startsWith(".")) classes.push(part.slice(1));
    else attrs.push(parseSelAttr(part.slice(1, -1)));
  }
  return { tag: m[1] ? m[1].toLowerCase() : null, classes, attrs };
};
const matchCompound = (el, selector) => {
  const { tag, classes, attrs } = parseCompound(selector);
  if (tag && el.tag !== tag) return false;
  if (classes.some((name) => !(el.attributes.class ?? "").split(/\s+/).includes(name))) return false;
  return attrs.every(({ name, value }) => (value === null ? el.hasAttribute(name) : el.getAttribute(name) === value));
};
const matchSelector = (el, selector) =>
  selector.split(",").some((part) => {
    const compounds = part.trim().split(/\s+/).filter(Boolean);
    if (!matchCompound(el, compounds[compounds.length - 1])) return false;
    let node = el.parent;
    for (let index = compounds.length - 2; index >= 0; index -= 1) {
      let found = false;
      while (node) {
        if (matchCompound(node, compounds[index])) {
          found = true;
          node = node.parent;
          break;
        }
        node = node.parent;
      }
      if (!found) return false;
    }
    return true;
  });
const fakeDescendants = (el) => el.children.flatMap((child) => [child, ...fakeDescendants(child)]);
function makeFakeEl(tag, attrs = {}, children = [], text = "") {
  const el = {
    tag: String(tag).toLowerCase(),
    attributes: { ...attrs },
    children: [],
    parent: null,
    textContent: text,
    clicks: 0,
    listeners: {},
    onClick: null,
    get className() {
      return el.attributes.class ?? "";
    },
    set className(value) {
      el.attributes.class = value;
    },
    getAttribute: (name) => (name in el.attributes ? el.attributes[name] : null),
    setAttribute: (name, value) => {
      el.attributes[name] = String(value);
    },
    removeAttribute: (name) => {
      delete el.attributes[name];
    },
    hasAttribute: (name) => name in el.attributes,
    addEventListener: (name, fn) => {
      (el.listeners[name] ??= []).push(fn);
    },
    append: (...nodes) => {
      for (const node of nodes) {
        node.parent = el;
        el.children.push(node);
      }
    },
    click: () => {
      el.clicks += 1;
      el.onClick?.(el);
      for (const fn of el.listeners.click ?? []) fn();
    },
    closest: (selector) => {
      let node = el;
      while (node) {
        if (matchSelector(node, selector)) return node;
        node = node.parent;
      }
      return null;
    },
    querySelector: (selector) => fakeDescendants(el).find((node) => matchSelector(node, selector)) ?? null,
    querySelectorAll: (selector) => fakeDescendants(el).filter((node) => matchSelector(node, selector)),
  };
  el.append(...children);
  return el;
}
function makeFakeDocument(children = []) {
  return makeFakeEl("body", {}, children);
}
/** Run `fn` with `document` bound to the fake, the way the page function sees it. */
const withDom = async (document, run) => {
  const saved = globalThis.document;
  globalThis.document = document;
  try {
    return await run();
  } finally {
    if (saved === undefined) delete globalThis.document;
    else globalThis.document = saved;
  }
};
const asPageSeesIt = (fn) => new Function("return (" + String(fn) + ")")();

describe("G7-04 cross-host BE-704-402: only the discard choice reloads the frame, and only a fresh open confirms it", () => {
  /** The pinned reload step (`web/modules/shared/conflict-dialog.ts:424-446`): download FIRST. */
  const webReloadDom = ({ choices = ["download", "discard", "back"] } = {}) => {
    const buttons = new Map();
    const card = makeFakeEl("div", { role: "alertdialog" });
    for (const id of choices) {
      const button = makeFakeEl("button", { "data-choice": id, type: "button" }, [], id === "discard" ? "Discard changes and reload" : id);
      buttons.set(id, button);
      card.append(button);
    }
    const mask = makeFakeEl("div", { "data-office-web": "conflict" }, [card]);
    const barAction = makeFakeEl("button", { class: "uw-remote-link", "data-action": "reload", type: "button" }, [], "Reload latest…");
    const bar = makeFakeEl("section", { class: "uw-remote-bar uw-remote-bar--warn" }, [barAction]);
    const root = makeFakeDocument([bar]);
    // the bar's action asks the main process for the reload, which shows the dialog in place
    barAction.onClick = () => root.append(mask);
    for (const [id, button] of buttons) {
      button.onClick = () => {
        if (id === "discard") root.children = root.children.filter((child) => child !== mask);
      };
    }
    return {
      document: { body: root, querySelector: (s) => root.querySelector(s), querySelectorAll: (s) => root.querySelectorAll(s) },
      root,
      barAction,
      mask,
      buttons,
    };
  };

  it("clicks the discard choice and never download, with both present in the pinned order (BE-704-402/406)", async () => {
    const dom = webReloadDom();
    const flow = await withDom(dom.document, () => asPageSeesIt(driveFrameReloadFlow)({ boundMs: 400, pollMs: 10 }));
    assert.equal(flow.clicked, true);
    assert.equal(flow.choseDiscard, true);
    assert.deepEqual(flow.choices, ["download", "discard", "back"], "the step offered them in the pin's own order");
    assert.equal(dom.buttons.get("discard").clicks, 1, "the discard choice is the one that reloads");
    assert.equal(dom.buttons.get("download").clicks, 0, "download starts a delivery and never reloads");
    assert.equal(dom.barAction.clicks, 1);
    assert.equal(flow.confirmText, "Discard changes and reload");
  });

  it("never takes a download-only dialog for a reload, and names the choices it saw (BE-704-402)", async () => {
    const dom = webReloadDom({ choices: ["download", "back"] });
    const flow = await withDom(dom.document, () => asPageSeesIt(driveFrameReloadFlow)({ boundMs: 300, pollMs: 10 }));
    assert.equal(flow.clicked, true);
    assert.equal(flow.choseDiscard, false);
    assert.equal(dom.buttons.get("download").clicks, 0, "no download branch is ever an accepted reload");
    assert.deepEqual(flow.choices, ["download", "back"]);
    assert.match(flow.reason, /offers no "discard" choice/);
  });

  it("answers `no bar` when a clean frame has already reloaded itself, so the caller just waits (D4-01)", async () => {
    const dom = webReloadDom();
    dom.root.children = dom.root.children.filter((child) => child !== dom.root.querySelector("section.uw-remote-bar"));
    const flow = await withDom(dom.document, () => asPageSeesIt(driveFrameReloadFlow)({ boundMs: 200, pollMs: 10 }));
    assert.equal(flow.clicked, false);
    assert.equal(flow.bar, false);
    assert.match(flow.reason, /a clean document reloads itself on the announce/);
  });

  it("claims the confirmation from the fresh open of the announced version, never from the click (BE-704-402)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM = "1";
      const { result } = await runChain({ row: "G7-A01", fixture: "fx-docx-report-vi", mock, scratch });
      assert.equal(result.status, "PASS", result.reason);
      const sees = result.record.details.webSees;
      assert.equal(sees.reloadClick.choseDiscard, true);
      assert.equal(sees.reloadClick.confirmed, undefined, "the click itself never claims the confirmation");
      assert.equal(sees.confirmed, true);
      assert.equal(sees.reload.versionId, sees.announced.versionId);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });

  it("FAILs with the click's own outcome when the reload step never offers the discard choice (BE-704-402)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM = "1";
      const { result } = await runChain({
        row: "G7-A01",
        fixture: "fx-docx-report-vi",
        mock,
        scratch,
        knobs: { web: { reloadNoDiscardChoice: true } },
        stepTimeoutMs: 300,
      });
      assert.equal(result.status, "FAIL");
      const step = result.record.steps["web-sees"];
      assert.equal(step.status, "FAIL");
      assert.match(step.reason, /did not reload the announced version/);
      assert.match(step.reason, /never made the discard choice/);
      assert.equal(result.record.details.webSeesMiss.reloadClick.choseDiscard, false);
      assert.deepEqual(result.record.details.webSeesMiss.reloadClick.choices, ["download", "back"]);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });
});

describe("G7-04 cross-host BE-704-404: the offline receipt belongs to THIS document", () => {
  it("names one intent record the fork's own key hash gives this document (BE-704-404)", () => {
    const name = appIntentRecordName(DOC_ID);
    assert.equal(name, `${createHash("sha256").update(DOC_ID, "utf8").digest("hex")}.rec`);
    assert.match(name, /^[0-9a-f]{64}\.rec$/);
    assert.notEqual(appIntentRecordName(DOC_ID), appIntentRecordName(OTHER_DOC_ID));
    assert.equal(appIntentRecordName(""), "");
  });

  it("FAILs after its bound when only ANOTHER document writes a new .rec (BE-704-404)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM = "1";
      // a second open document of the same user writes its own record while THIS document's Save
      // is never held: the user-level count moves, this document's does not
      const { result } = await runChain({
        row: "G7-A01",
        fixture: "fx-docx-report-vi",
        mock,
        scratch,
        knobs: { app: { otherDocIntentAfterReads: 2, offlineNeverHolds: true } },
        stepTimeoutMs: 300,
      });
      assert.equal(result.status, "FAIL");
      assert.equal(result.exitCode, 1);
      const step = result.record.steps["app-offline-save"];
      assert.equal(step.status, "FAIL");
      assert.match(step.reason, /no NEW save intent and no offline state for document/);
      assert.match(step.reason, /intents=1\b/);
      assert.match(step.reason, /documentIntents=0\b/, "the other document's record is not this document's");
      assert.match(step.reason, /newIntents=0\b/);
      assert.match(step.reason, /binding state "ready"/);
      assert.ok(step.elapsedMs >= 300, `the step must wait its whole bound before failing (waited ${step.elapsedMs} ms)`);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });
});

describe("G7-04 cross-host BE-704-405: frame reads share the step's budget", () => {
  const hungFrame = (name) => ({ url: () => `http://localhost:36009/office-frame/${name}/index.html`, evaluate: () => new Promise(() => {}) });

  it("reads the frames concurrently: N hung renderers cost ONE per-read bound, not N of them (BE-704-405)", async () => {
    const hung = [hungFrame("a"), hungFrame("b"), hungFrame("c")];
    const began = Date.now();
    const reports = await readFrameReports({ frames: hung, deadlineMs: Date.now() + 150, perReadTimeoutMs: 10_000 });
    const elapsed = Date.now() - began;
    assert.equal(reports.length, 3);
    for (const report of reports) assert.match(report.readError, /timed out after 1\d\d ms/);
    assert.ok(elapsed < 400, `one concurrent wave must not cost 3 x 10 s (elapsed ${elapsed} ms)`);
  });

  it("never starts a read once the budget is gone, and says so per frame (BE-704-405)", async () => {
    let started = 0;
    const frames = [1, 2].map((index) => ({
      url: () => `http://localhost:36009/office-frame/${index}/index.html`,
      evaluate: () => {
        started += 1;
        return Promise.resolve([]);
      },
    }));
    const reports = await readFrameReports({ frames, deadlineMs: Date.now() - 1, perReadTimeoutMs: 10_000 });
    assert.equal(started, 0, "no read is started when no budget remains");
    assert.equal(reports.length, 2, "every frame is still accounted for");
    for (const report of reports) {
      assert.equal(report.messages, null);
      assert.equal(report.readError, FRAME_READ_NO_BUDGET);
    }
  });

  it("keeps a non-list frame read (the surface probe), so a miss still says what the frame showed (BE-704-405/406)", async () => {
    const frame = {
      url: () => "http://localhost:36009/office-frame/docs/index.html",
      evaluate: async () => ({ bar: "A newer version is on UniWork (version 3)", actions: [{ action: "reload" }], dialog: true, choices: ["download", "discard"] }),
    };
    const [report] = await readFrameReports({ frames: [frame], read: readFrameRemoteSurface, deadlineMs: Date.now() + 1_000 });
    assert.equal(report.readError, "");
    assert.equal(report.messages, null, "a surface answer is not an envelope list");
    assert.deepEqual(report.value.choices, ["download", "discard"]);
    assert.match(report.value.bar, /A newer version is on UniWork/);
  });

  it("bounds web-sees by its own step budget when several renderers hang, and names every expired read (BE-704-405)", async () => {
    const scratch = makeScratchRunDir();
    const mock = createMockDServer({ aiMode: "real-xyz" });
    mock.state.kind = "docs";
    try {
      process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM = "1";
      const began = Date.now();
      const { result } = await runChain({
        row: "G7-A01",
        fixture: "fx-docx-report-vi",
        mock,
        scratch,
        knobs: { web: { hungFrames: 3, hungFrameBudgetMs: 300 } },
        stepTimeoutMs: 300,
      });
      const elapsed = Date.now() - began;
      assert.equal(result.status, "FAIL");
      const step = result.record.steps["web-sees"];
      assert.equal(step.status, "FAIL");
      assert.match(step.reason, /announced no doc\.remoteVersion/);
      assert.match(step.reason, /3 frame read\(s\) failed/);
      // 3 hung frames per read wave must never cost 3 x 10 s, and the step's own bound is the cap
      assert.ok(elapsed < 3 * 300 + 600, `the row must stay near its step bound (took ${elapsed} ms for 4 steps)`);
    } finally {
      delete process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM;
      scratch.cleanup();
    }
  });
});

describe("G7-04 cross-host BE-704-406: the page-side reload flows run against the pinned markup", () => {
  /** The pinned app dialog (`UniworkConflictDialog.tsx` at e99471fe2): radio choice, then the confirm. */
  const appReloadDom = ({ confirmDisabled = false } = {}) => {
    const go = makeFakeEl("button", { class: "uw-conflict-btn", "data-conflict-action": "reload-go", "aria-disabled": "true" }, [], "Reload");
    const radio = makeFakeEl("input", { type: "radio", name: "keep", value: "discard" });
    const step1 = makeFakeEl("button", { class: "uw-conflict-btn", "data-conflict-action": "reload" }, [], "Reload latest");
    const back = makeFakeEl("button", { class: "uw-conflict-btn", "data-conflict-action": "back" }, [], "Back");
    const dialog = makeFakeEl("div", { role: "alertdialog" }, [step1, radio, go, back]);
    const barAction = makeFakeEl("button", { class: "uw-remote-action", "data-action": "reload" }, [], "Reload latest…");
    const bar = makeFakeEl("div", { class: "uw-remote-bar" }, [barAction]);
    const root = makeFakeDocument([bar]);
    radio.checked = false;
    // `canSubmit = selectedKeep === 'discard' || …` (uniwork-conflict-model.ts:326): the choice is
    // what enables the confirm, and the confirm is what the flow must click
    radio.onClick = () => {
      radio.checked = true;
      if (!confirmDisabled) go.removeAttribute("aria-disabled");
    };
    barAction.onClick = () => root.append(dialog);
    return {
      document: { body: root, querySelector: (s) => root.querySelector(s), querySelectorAll: (s) => root.querySelectorAll(s) },
      root,
      bar: barAction,
      dialog,
      step1,
      radio,
      go,
    };
  };

  it("drives the app flow in the pin's order: bar action, Reload latest, the discard radio, then the confirm (BE-704-406)", async () => {
    const dom = appReloadDom();
    const flow = await withDom(dom.document, () => asPageSeesIt(driveAppConflictReloadFlow)(400));
    assert.deepEqual(flow, {
      bar: true,
      step1: true,
      choseDiscard: true,
      disabled: "",
      clicked: true,
      confirmed: true,
      confirmText: "Reload",
    });
    assert.equal(dom.bar.clicks, 1);
    assert.equal(dom.step1.clicks, 1);
    assert.equal(dom.radio.checked, true, "the keep choice is the discard radio the pin renders");
    assert.equal(dom.go.clicks, 1, "the confirm is only clicked once it is usable");
  });

  it("stops at the pin's disabled confirm and reports WHY, without clicking it (BE-704-406)", async () => {
    const dom = appReloadDom({ confirmDisabled: true });
    const flow = await withDom(dom.document, () => asPageSeesIt(driveAppConflictReloadFlow)(400));
    assert.equal(flow.clicked, true);
    assert.equal(flow.choseDiscard, true);
    assert.equal(flow.confirmed, false);
    assert.equal(flow.confirmText, undefined);
    assert.equal(dom.go.clicks, 0, "an aria-disabled confirm is never clicked");
    assert.match(flow.reason, /reload confirm "Reload" stayed disabled after the keep choice/);
  });

  it("answers `no bar` when the app page carries no S6 reload action", async () => {
    const dom = appReloadDom();
    dom.root.children = dom.root.children.filter((child) => child !== dom.root.querySelector("div.uw-remote-bar"));
    const flow = await withDom(dom.document, () => asPageSeesIt(driveAppConflictReloadFlow)(300));
    assert.equal(flow.clicked, false);
    assert.equal(flow.confirmed, false);
    assert.match(flow.reason, /reload action was never found/);
  });
});

describe("G7-04 cross-host D2-05: the previous row's session is signed out with the product's confirmation", () => {
  it("answers the fork's sign-out gate with `{ confirmed: true }`, not an array, before the harness's own logout (BE-704-301)", async () => {
    const calls = [];
    // The pinned fork's own gate: `accountLogout` reads `options.confirmed`
    // (apps/shell/src/main/uniwork-auth/index.ts:652-658) and the account
    // boundary then waits for the renderer prompt whenever it is false
    // (account-boundary.ts:198-210). A bare call and an ARRAY call (what
    // `aiOffice("accountLogout", [{ confirmed: true }])` put on the wire, because
    // the bridge spreads its rest args) both never settle: this fake does the
    // same, so the test hangs — and the race below turns that hang into a FAIL
    // — exactly how the 4th cloud row hung (D2-05/D3-03).
    const gate = async (name, options) => {
      calls.push({ name, args: options });
      if (name === "accountStatus") return { state: "signed-in" };
      if (name === "accountLogout" && options?.confirmed === true) return { state: "signed-out" };
      if (name === "accountLogout") return new Promise(() => {});
      return undefined;
    };
    const HUNG = Symbol("hung");
    const answered = await Promise.race([
      signOutPreviousSession(gate),
      new Promise((resolve) => setTimeout(() => resolve(HUNG), 250)),
    ]);
    assert.notEqual(answered, HUNG, "the logout must answer the fork's gate: a bare or array call leaves it waiting (BE-704-301)");
    assert.deepEqual(answered, { signedOut: true, state: "signed-in" });
    assert.deepEqual(calls, [
      { name: "accountStatus", args: undefined },
      { name: "accountLogout", args: { confirmed: true } },
    ]);
  });

  it("does nothing to an app that is already signed out, and survives a status read that fails", async () => {
    const calls = [];
    const out = await signOutPreviousSession(async (name, args) => {
      calls.push({ name, args });
      return { state: "signed-out" };
    });
    assert.equal(out.signedOut, false);
    assert.equal(calls.length, 1, "no logout is sent when the app has no session to end");

    const failed = await signOutPreviousSession(async () => {
      throw new Error("no aiOffice bridge");
    });
    assert.deepEqual(failed, { signedOut: false, state: null });
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

describe("G7-04 cross-host dirty-edit plans and the awaited page action (BE-704-05/07)", () => {
  /** The editor ctrl surface the CDP controller hands to `makeAppDirty`. */
  const fakeCtrl = (page, seen) => ({
    editorPage: async (kind, opts) => {
      seen.push({ kind, opts });
      return page;
    },
    evalBounded: (pg, fn, arg) => fn(arg),
  });

  it("drives the imported G8-19 plans and page action, not copies (BE-704-05)", () => {
    // the identity, not a deep copy: a fork UI change is applied in one place
    assert.equal(DIRTY_EDIT_PLANS.sheets.actions, EDIT_DRIVERS.xlsx.shift);
    assert.equal(DIRTY_EDIT_PLANS.docs.actions, EDIT_DRIVERS.docx.shift);
    assert.equal(DIRTY_EDIT_PLANS.sheets.name, "insert-row");
    assert.equal(DIRTY_EDIT_PLANS.docs.name, "split-block");
  });

  it("waits out an editor whose control boots late (BE-704-07: the 250 ms retries are awaited, never dropped)", async () => {
    const bootMs = 400;
    const began = Date.now();
    let probes = 0;
    const clicks = [];
    const el = (label) => ({
      getAttribute: (name) => (name === "aria-label" ? label : null),
      textContent: label,
      classList: { contains: () => false },
      disabled: false,
      click: () => {
        clicks.push(label);
      },
    });
    globalThis.window = {
      __genofficeControl: async () => {
        probes += 1;
        return Date.now() - began < bootMs ? { status: "not_ready" } : { status: "ok", result: { cmd: "goto" } };
      },
    };
    // the sheets plan: the Home ribbon tab, the goto control, the Insert row button
    globalThis.document = {
      querySelectorAll: (selector) => {
        if (selector === ".ribbon-tab") return [el("Home")];
        if (selector === "button[aria-label]") return [el("Chèn hàng")];
        return [];
      },
    };
    try {
      const seen = [];
      const res = await makeAppDirty({ ctrl: fakeCtrl({}, seen), kind: "sheets", path: "/run/fx-xlsx-revenue-xyz.xlsx", documentId: DOC_ID });
      assert.deepEqual(res, { edited: true, source: "app-ui", plan: "insert-row" });
      assert.ok(probes > 1, `the control must be retried while it is not_ready (probed ${probes} time(s))`);
      assert.deepEqual(clicks, ["Home", "Chèn hàng"], "the plan's own product commands run after the control is ready");
      assert.ok(
        Date.now() - began >= bootMs,
        "the retry budget must be real elapsed time: a dropped await spins the 40 retries in one microtask turn and reports not_ready",
      );
      assert.deepEqual(seen, [{ kind: "sheets", opts: { path: "/run/fx-xlsx-revenue-xyz.xlsx", documentId: DOC_ID } }]);
    } finally {
      delete globalThis.window;
      delete globalThis.document;
    }
  });

  it("a plan the editor refuses is never a UI edit: the reason names the editor and the plan", async () => {
    globalThis.window = { __genofficeControl: async () => ({ status: "error", error: { code: "block_not_found" } }) };
    globalThis.document = { querySelectorAll: () => [] };
    try {
      const res = await makeAppDirty({ ctrl: fakeCtrl({}, []), kind: "docs", path: null, documentId: DOC_ID });
      assert.equal(res.edited, false);
      assert.equal(res.source, "none");
      assert.match(res.reason, /docs editor refused the split-block plan/);
      assert.doesNotMatch(res.reason, /app-ui/);
    } finally {
      delete globalThis.window;
      delete globalThis.document;
    }
  });

  it("no editor page for the working copy is a missing page, not a UI edit", async () => {
    const ctrl = {
      editorPage: async () => {
        throw new Error("no sheets editor page shows /run/fx-xlsx-revenue-xyz.xlsx");
      },
      evalBounded: () => {
        throw new Error("no page action may run");
      },
    };
    const res = await makeAppDirty({ ctrl, kind: "sheets", path: "/run/fx-xlsx-revenue-xyz.xlsx", documentId: DOC_ID });
    assert.equal(res.edited, false);
    assert.equal(res.source, "none");
    assert.match(res.reason, /no sheets editor page for the working copy/);
  });
});

describe("G7-04 harness README (cross-host section)", () => {
  const README = readFileSync(join(REPO_ROOT, "scripts/office/g5g6g7/harness/README.md"), "utf8");
  const SECTION = README.slice(README.indexOf("## G7-04 cross-host loop"), README.indexOf("## G7-04 revoke"));

  it("states which steps a run drove through the editor UI, and what a stand-in edit is (BE-704-08)", () => {
    assert.notEqual(SECTION, "", "the G7-04 cross-host section is missing");
    assert.match(SECTION, /`uiEdits`/, "the section names the row-level uiEdits field");
    assert.match(SECTION, /`real`/, "the section says what real means");
    assert.match(SECTION, /`standin`/, "the section says what standin means");
    for (const step of ["dirty", "offlineSave", "aiSave"]) {
      assert.match(SECTION, new RegExp(step), `uiEdits must cover the ${step} step`);
    }
  });

  it("says the dirty editor is G5-A03.3's and the G8-19 plans are imported, not copied (D1-04, BE-704-05)", () => {
    assert.match(SECTION, /G5-A03\.3 only/, "the dirty editor belongs to G5-A03.3 only");
    assert.match(SECTION, /G7-A01[^.]*runs no dirty-edit step|runs no dirty-edit step[^.]*G7-A01/, "G7-A01 runs no dirty step");
    assert.match(SECTION, /g8-19\/anchors\.mjs/, "the section names the imported G8-19 module");
    assert.match(SECTION, /EDIT_DRIVERS/, "the section names the imported plans");
    assert.doesNotMatch(SECTION, /nothing is copied/, "the reuse claim must be accurate");
    assert.match(SECTION, /SKIPPED/, "the section states that a BLOCKED step skips only its consumers");
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
