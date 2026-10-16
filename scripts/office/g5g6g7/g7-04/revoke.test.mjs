/* global Buffer, URL, Response, FormData, Blob, process, setTimeout */
// Failing-first tests for the G7-04 revoke driver (UNI-1386, G7-A02.1):
// `scripts/office/g5g6g7/g7-04/revoke.mjs` on the same stack the G7-10 tracer
// uses (harness ports.env + an in-memory D server fake, the tracer.test.mjs
// shape). Covers the three revoke cases the Advisor fixed (Addendum A1):
//
//   * `deactivate` (primary): member deactivation, the next AI turn is refused
//     per route as the Go code answers it — 403 `member_deactivated` on the
//     desktop session route and 401 `unauthorized` (error_class session) on the
//     web frame route, because the frame actor resolver swallows that
//     CodedError (handler/ai_mount.go:101-106) — and no version appears;
//   * `downgrade`: the document is `restricted` and the app's own share drops
//     from edit to view, so the AI turn still answers 200 (it needs view only,
//     view-only AI is allowed: G6-05u) and the Save is refused — the upload 403
//     `forbidden` (the edit gate), then the commit 404 `not_found` because
//     resolveUpload runs before the edit gate (document_commit.go:277 vs :296);
//   * `remove`: workspace-member removal, the next AI turn answers 404
//     `not_found` on both routes (a non-member never learns the id exists).
//
// The fake is state-driven (BE-704-06): the versions route refuses a revoked
// member's own read (403 deactivate / 404 remove), the commit resolves
// upload_id before the access gate, the frame AI route answers the 401 after a
// deactivation, and the lookup answers the { status, ok, body } shape the
// driver's call() returns. Every run seeds its own owner/member/workspace, so
// no run inherits an earlier run's revoke (D1-01), and no bearer token is
// written to the run dir (BE-704-04).
//
// Plus the failure directions the row cares about: a 200 after the revoke is a
// FAIL, a version after the revoke is a FAIL, a committed commit intent after
// the revoke is a FAIL, and a fake deployment answering 503 `ai_disabled` on
// turn 1 is BLOCKED while the revoke assertion still runs. The routes are
// pinned against the Go router (server-contract.helper.mjs), so a route rename
// fails here, not on a cloud VM.
//
// Cloud D2 added the turn-1 precondition (D2-02/D2-03): a row may PASS only
// when AI turn 1 answered 200 on BOTH routes. A turn 1 both routes refused 403
// `office_capability_off` — and only when BOTH did (BE-704-451) — is BLOCKED
// with the capability named (the deployment has the flag off, so no turn ever
// worked and the revoke cannot be shown), whatever turn 2 answers; any other
// non-200 turn 1, including one route refusing the capability while the other
// 500s or times out, is a FAIL naming both routes; and a capability that flips
// off between the two turns is a FAIL named as that flip, not as a revoke
// result.
//
// BE-704-202 closed the last hole: under `AI_PROVIDER=fake` a turn 1 that
// answered 200 still carries an unverifiable CONTENT (classifyAiResponse BLOCKs
// it), and the row used to PASS while its own record said that step BLOCKED. The
// turn-1 step status now decides too: every revoke assertion may hold and the row
// still ends BLOCKED (exit 77) naming "turn-1 AI content not verifiable under the
// fake provider (real-AI round)" — the record keeps every revoke assertion as
// PASS, and a broken revoke assertion still wins over that BLOCKED.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { G8_API_CALLS, G8_CALLS } from "../harness/api-contract.mjs";
import { redactSignInError } from "../harness/app-steps.mjs";
import { routeCatalogue, sdiFields } from "../harness/server-contract.helper.mjs";
import {
  AI_CONTENT_BLOCKER,
  AI_DISABLED_BLOCKER,
  CASE_EXPECTATIONS,
  REVOKE_CASES,
  REVOKE_FIXTURES,
  REASON_VALUE_MAX_CHARS,
  capabilityOffBlocker,
  decideRevokeOutcome,
  parseArgs,
  reasonValueOf,
  runRevokeCase,
  turn1DisabledOf,
} from "./revoke.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
/** The world cache an earlier driver version wrote; it must never come back. */
const LEGACY_WORLD_CACHE = "g7-04-revoke-world.json";

/**
 * The result of this file must not depend on the shell it runs in (BE-704-203,
 * repo CLAUDE.md: "Tests pin every env they depend on"). `classifyAiResponse`
 * reads `AI_PROVIDER` and the real-upstream guard, `parseArgs` reads
 * `HARNESS_RUN_DIR`, and the driver's evidence line reads the OFFICE_EVIDENCE_*
 * keys, `OFFICE_FORK_SHA` and — through `ledgerIdentity` → `readPin` —
 * `OFFICE_PIN_DIR` — so each test gets them pinned and restored.
 * `AI_PROVIDER` is pinned off `fake` and the real-upstream guard off, so a row
 * can only PASS here when its own fake carries a real-labelled answer AND the run
 * opts in through the driver's own guard (`fetchImpl.allowRealAiUpstream`, the
 * seam the HTTP-server tests use through `HARNESS_ALLOW_REAL_AI_UPSTREAM`).
 */
const PINNED_AI_PROVIDER = "openai";
const PINNED_ENV_KEYS = [
  "AI_PROVIDER",
  "HARNESS_ALLOW_REAL_AI_UPSTREAM",
  "HARNESS_RUN_DIR",
  "OFFICE_EVIDENCE_ID",
  "OFFICE_EVIDENCE_REQ",
  "OFFICE_FORK_SHA",
  "OFFICE_PIN_DIR",
];
let savedEnv = {};
beforeEach(() => {
  savedEnv = {};
  for (const key of PINNED_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    if (key === "AI_PROVIDER") process.env[key] = PINNED_AI_PROVIDER;
    else delete process.env[key];
  }
});
afterEach(() => {
  for (const key of PINNED_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

// ---- the run dir the driver reads (start status + ports.env) ----------------

function makeScratchRunDir({ startState = "up", startReason = "" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "g7-04-revoke-test-"));
  writeFileSync(join(dir, "start-status.json"), `${JSON.stringify({ state: startState, reason: startReason })}\n`);
  writeFileSync(join(dir, "ports.env"), "API_ORIGIN=http://127.0.0.1:1\nWEB_ORIGIN=http://127.0.0.1:2\n");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---- the in-memory D server fake -------------------------------------------

const DOC_ID = "01JDOC00000000000000000001";
const WS_ID = "01JWS000000000000000000001";
const ORG_ID = "01JORG00000000000000000001";
const ORG_SLUG = "o-g704";
const V1_ID = "01JVER00000000000000000001";

function sha256Of(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A state-driven fake of the D server routes the revoke driver calls. The
 * revoke routes mark the user they name (`state.deactivated` / `state.removed`)
 * or drop the share to view (`state.viewOnly`), and every later route answers
 * the real route contract for that state: the versions read and the upload are
 * refused the way the gates refuse (403 `member_deactivated` / 404 `not_found`
 * / 403 `forbidden`), the commit resolves upload_id before the access gate
 * (document_commit.go:272-296), the frame AI route answers the 401 the frame
 * actor resolver writes after a deactivation (ai_mount.go:101-106), and the
 * commit-intent lookup answers the { status, ok, body } shape the driver's own
 * call() returns. `ignoreRevokeOnAiTurn` / `allowSaveAfterRevoke` /
 * `commitIntentAfterRevoke` are the three mutations the failure tests drive.
 * `aiMode: "real"` answers the 200 with a real-labelled upstream payload and
 * turns the driver's own real-upstream guard on (`fetchImpl.allowRealAiUpstream`)
 * — without both, the turn-1 content is BLOCKED and the row can only be BLOCKED
 * (BE-704-202).
 *
 * The refusal order is the Go gate order (BE-704-353): the member refusal
 * (`RequireMember`, service/ai_uniwork.go:241-244) is applied BEFORE the
 * capability check (:503-515), so a deactivated member is never answered
 * `office_capability_off` and a turn-2 capability flip is only reachable on a
 * member the server still admits — the `downgrade` member.
 * `sessionFailure` / `frameFailure` make that one route answer a
 * transport/status failure while the other route still answers (BE-704-352):
 * `"500"` (a refused status), `"timeout"` (a request that never came back),
 * `"transport"` (the platform's own fetch rejection) or `"driver"` (an
 * exception the driver must never read as a route failure, BE-704-454).
 * `uploadFailure` / `commitFailure` drive the same shapes on the member's Save
 * (BE-704-450).
 */
function createMockRevokeServer({ aiMode = "fake", sessionFailure = null, frameFailure = null, uploadFailure = null, commitFailure = null, ignoreRevokeOnAiTurn = false, allowSaveAfterRevoke = false, commitIntentAfterRevoke = false } = {}) {
  const state = {
    users: new Map(),
    deactivated: new Set(),
    removed: new Set(),
    viewOnly: new Set(),
    frameTokens: new Map(),
    versions: [],
    uploads: new Map(),
    intents: new Map(),
    registrations: [],
    calls: [],
    aiCalls: 0,
    fileName: "",
    seq: 0,
    revokeApplied: false,
  };

  const json = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  const unauthorized = () => json(401, { error: { code: "unauthorized", message: "unauthorized", error_class: "session" } });
  const bearerOf = (init) => String(init.headers?.authorization ?? init.headers?.Authorization ?? "").replace(/^Bearer\s+/i, "");
  const callerOf = (init) => state.users.get(bearerOf(init)) ?? "";
  const frameCallerOf = (init) => state.frameTokens.get(bearerOf(init)) ?? "";
  const headerOf = (init, name) => init.headers?.[name] ?? init.headers?.[name.toLowerCase()] ?? "";
  /** What the real gates answer this user: the deactivated member 403, the removed one 404. */
  const refusalOf = (userId) => {
    if (state.deactivated.has(userId)) return json(403, { error: { code: "member_deactivated", message: "member deactivated" } });
    if (state.removed.has(userId)) return json(404, { error: { code: "not_found", message: "not found" } });
    return null;
  };
  /**
   * The 403 `office_capability_off` the real route answers when the deployment
   * has the capability off (service/ai_uniwork.go:498-514): fields.capability
   * names the format of the document's module (docx | xlsx), read from the
   * uploaded file's extension.
   */
  const capabilityOff = () => {
    const format = (state.fileName.split(".").pop() ?? "").toLowerCase();
    return json(403, { error: { code: "office_capability_off", message: "UniWork AI dang tat cho to chuc nay", fields: { capability: `ai_uniwork_${format}` } } });
  };
  /**
   * The failure shapes the tests drive on one route (BE-704-352/450/454): a
   * refused status (`"500"`), a request that never came back (`"timeout"`), the
   * platform's own fetch rejection (`"transport"`, a `TypeError` carrying its
   * `cause`), and a harness defect that is NOT a route failure (`"driver"`).
   */
  const failureOf = (kind, message) => {
    if (kind === "timeout") throw Object.assign(new Error(message), { name: "TimeoutError" });
    if (kind === "transport") throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:1") });
    if (kind === "driver") throw new Error(message);
    return json(Number(kind), { error: { code: "internal", message: "boom" } });
  };

  const fetchImpl = async (urlStr, init = {}) => {
    const url = new URL(urlStr);
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname;
    state.calls.push({ method, path });

    if (method === "POST" && path === "/api/v1/auth/register") {
      const body = JSON.parse(init.body);
      state.seq += 1;
      const id = `01JUSER${String(state.seq).padStart(20, "0")}`;
      const token = `tok-${id}`;
      state.users.set(token, id);
      state.registrations.push({ id, email: body.email });
      return json(201, { access_token: token, user: { id, email: body.email } });
    }
    if (method === "POST" && path === "/api/v1/me/email/verify") return json(200, { verified: true });
    if (method === "POST" && path === "/api/v1/orgs") return json(201, { organization: { id: ORG_ID, slug: ORG_SLUG } });
    if (method === "POST" && path === `/api/v1/orgs/${ORG_ID}/workspaces`) return json(201, { workspace: { id: WS_ID, slug: "w-g704" } });
    if (method === "POST" && path === "/api/v1/me/onboarding/complete") return json(200, { user: { id: callerOf(init) } });
    if (method === "POST" && path === `/api/v1/workspaces/${WS_ID}/invitations`) return json(201, { invitations: [] });
    if (method === "GET" && path === "/api/v1/me/invitations") return json(200, { invitations: [{ token: "inv-1", workspace: { id: WS_ID } }] });
    if (method === "POST" && path === "/api/v1/invitations/inv-1/accept") return json(200, { membership: { workspace_id: WS_ID } });
    if (method === "POST" && path === `/api/v1/workspaces/${WS_ID}/documents/files`) {
      const file = init.body.get("file");
      state.fileName = String(file.name ?? "");
      const bytes = Buffer.from(await file.arrayBuffer());
      state.versions = [{ id: V1_ID, version: 1, revision: "1", checksum_sha256: sha256Of(bytes), size_bytes: bytes.length, bytes }];
      return json(201, { document: { id: DOC_ID, workspace_id: WS_ID, organization_id: ORG_ID, revision: "1", current_version: 1, file: { version_id: V1_ID } } });
    }
    if (method === "POST" && path === `/api/v1/documents/${DOC_ID}/shares`) {
      const body = JSON.parse(init.body);
      if (body.level === "view") {
        // the downgrade case: the app's own share drops to view, so the edit
        // gate (upload, commit) is what the server refuses
        state.viewOnly.add(body.principal_id);
        state.revokeApplied = true;
      }
      return json(201, { share: { id: "01JSHARE000000000000000001", level: body.level } });
    }
    if (method === "PATCH" && path === `/api/v1/documents/${DOC_ID}`) {
      state.visibility = JSON.parse(init.body).visibility;
      return json(200, { document: { id: DOC_ID, visibility: state.visibility } });
    }
    if (method === "POST" && path === `/api/v1/documents/${DOC_ID}/office/frame-token`) {
      const caller = callerOf(init);
      if (!caller) return unauthorized();
      state.seq += 1;
      const token = `tok-frame-${state.seq}`;
      state.frameTokens.set(token, caller);
      return json(201, { token, can_edit: true, module: "docs" });
    }
    if (
      method === "POST" &&
      (path === `/api/v1/documents/${DOC_ID}/ai/uniwork/chat/completions` || path === `/api/v1/office-frame/documents/${DOC_ID}/ai/uniwork/chat/completions`)
    ) {
      const isFrame = path.startsWith("/api/v1/office-frame/");
      const caller = isFrame ? frameCallerOf(init) : callerOf(init);
      if (!caller) return unauthorized();
      state.aiCalls += 1;
      // BE-704-352: a route that never answered — a 5xx or a transport failure —
      // while the other route still answers, so the driver must measure BOTH
      // routes instead of ending in a generic exception FAIL.
      if (sessionFailure && !isFrame) return failureOf(sessionFailure, "the session AI route failed");
      if (frameFailure && isFrame) return failureOf(frameFailure, "the frame AI route failed");
      // The Go gate order (BE-704-353): RequireMember
      // (service/ai_uniwork.go:241-244) runs BEFORE checkUniworkCapability
      // (:503-515), so a deactivated member is never answered
      // office_capability_off, and a turn-2 capability flip can only be
      // exercised on a member the server still admits — the downgrade member.
      if (!ignoreRevokeOnAiTurn) {
        // A deactivated member is 403 member_deactivated on the session route;
        // the frame resolver only forwards ErrNotFound/ErrForbidden to
        // mapServiceError and rewrites the member_deactivated CodedError as a
        // generic 401 (server/internal/handler/ai_mount.go:101-106).
        if (state.deactivated.has(caller)) {
          if (isFrame) return unauthorized();
          return json(403, { error: { code: "member_deactivated", message: "member deactivated" } });
        }
        if (state.removed.has(caller)) return json(404, { error: { code: "not_found", message: "not found" } });
      }
      if (aiMode === "disabled" && !state.revokeApplied) return json(503, { error: { code: "ai_disabled", message: "AI chua duoc cau hinh tren server" } });
      // Cloud D2-02/D2-03: turn 1 (calls 1-2) with the capability off, and a
      // capability that flips off after turn 1 (calls 3+).
      if (aiMode === "capability-off" && !state.revokeApplied) return capabilityOff();
      if (aiMode === "capability-off-turn2" && state.aiCalls > 2) return capabilityOff();
      if (aiMode === "turn1-forbidden" && state.aiCalls <= 2) return json(403, { error: { code: "forbidden", message: "forbidden" } });
      // A real-labelled answer is what a PASS needs: classifyAiResponse BLOCKs
      // any 200 whose provider/model/content is labelled fake (BE-704-202).
      const real = aiMode === "real";
      return json(200, {
        id: "chatcmpl-test",
        model: real ? "gpt-4o-mini" : "fake-stub",
        provider: real ? "openai-compatible" : "fake",
        choices: [{ index: 0, message: { role: "assistant", content: real ? "Xin chào, đây là bản nháp đầu tiên." : "[fake provider] stub" }, finish_reason: "stop" }],
      });
    }
    if (method === "GET" && path === `/api/v1/documents/${DOC_ID}/versions`) {
      const caller = callerOf(init);
      if (!caller) return unauthorized();
      const refused = refusalOf(caller);
      if (refused) return refused;
      return json(200, { versions: state.versions.map((v) => ({ id: v.id, version: v.version, checksum_sha256: v.checksum_sha256, size_bytes: v.size_bytes })) });
    }
    if (method === "POST" && path === `/api/v1/documents/${DOC_ID}/uploads`) {
      const caller = callerOf(init);
      if (!caller) return unauthorized();
      // BE-704-450: the Save routes fail the way any other route can — a refused
      // status or a transport failure — so the driver's own mapper is exercised.
      if (uploadFailure) return failureOf(uploadFailure, "the Save upload failed");
      if (!allowSaveAfterRevoke) {
        const refused = refusalOf(caller);
        if (refused) return refused;
        if (state.viewOnly.has(caller)) return json(403, { error: { code: "forbidden", message: "forbidden" } });
      }
      const file = init.body.get("file");
      const bytes = Buffer.from(await file.arrayBuffer());
      const uploadId = `01JUPL0000000000000000000${state.uploads.size + 1}`;
      state.uploads.set(uploadId, { checksum_sha256: sha256Of(bytes), size_bytes: bytes.length, bytes });
      return json(201, { upload_id: uploadId, checksum_sha256: sha256Of(bytes), size_bytes: bytes.length });
    }
    if (method === "POST" && path === `/api/v1/documents/${DOC_ID}/versions/commit`) {
      const caller = callerOf(init);
      if (!caller) return unauthorized();
      // BE-704-450: the commit fails the same way the upload can.
      if (commitFailure) return failureOf(commitFailure, "the Save commit failed");
      if (!allowSaveAfterRevoke) {
        const refused = refusalOf(caller);
        if (refused) return refused;
      }
      // commitFileVersion order (document_commit.go:272-296): preflightDocument
      // (view, above) -> resolveUpload (:277) -> decideDocumentAccess(edit, :296)
      const upload = state.uploads.get(JSON.parse(init.body).upload_id);
      if (!upload) return json(404, { error: { code: "not_found", message: "not found" } });
      if (!allowSaveAfterRevoke && state.viewOnly.has(caller)) return json(403, { error: { code: "forbidden", message: "forbidden" } });
      const key = headerOf(init, "Idempotency-Key");
      const next = { id: `01JVER0000000000000000000${state.versions.length + 1}`, version: state.versions.length + 1, revision: String(state.versions.length + 1), checksum_sha256: upload.checksum_sha256, size_bytes: upload.size_bytes, bytes: upload.bytes };
      state.versions.push(next);
      if (key) state.intents.set(key, { state: "committed", version: next });
      return json(200, { document: { id: DOC_ID, revision: next.revision, current_version: next.version }, version: { id: next.id, version: next.version, checksum_sha256: next.checksum_sha256, size_bytes: next.size_bytes } });
    }
    if (method === "GET" && path === `/api/v1/documents/${DOC_ID}/versions/commit`) {
      const caller = callerOf(init);
      if (!caller) return unauthorized();
      const refused = refusalOf(caller);
      if (refused) return refused;
      if (commitIntentAfterRevoke) return json(200, { outcome: "committed", version_id: V1_ID, version: 1, revision: 1 });
      const entry = state.intents.get(headerOf(init, "Idempotency-Key"));
      if (entry) return json(200, { outcome: "committed", version_id: entry.version.id, version: entry.version.version, revision: Number(entry.version.revision) });
      return json(410, { error: { code: "commit_intent_unknown", message: "unknown", fields: { outcome: "unknown" } } });
    }
    const deactivate = path.match(new RegExp(`^/api/v1/orgs/${ORG_SLUG}/members/([^/]+)/deactivate$`));
    if (method === "POST" && deactivate) {
      state.deactivated.add(deactivate[1]);
      state.revokeApplied = true;
      return json(200, { member: { user_id: deactivate[1], deactivated_at: "2026-10-16T00:00:00Z" } });
    }
    const remove = path.match(new RegExp(`^/api/v1/workspaces/${WS_ID}/members/([^/]+)$`));
    if (method === "DELETE" && remove) {
      state.removed.add(remove[1]);
      state.revokeApplied = true;
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && path === `/api/v1/orgs/${ORG_ID}/privacy/deletion`) return json(202, { status: "scheduled" });
    if (method === "POST" && path === "/api/v1/me/delete") return json(200, { deleted: true });
    return json(404, { error: { code: "not_found", path } });
  };

  // The driver's own real-upstream seam (the same one a real runner opens with
  // HARNESS_ALLOW_REAL_AI_UPSTREAM=1): without it the turn-1 content stays BLOCKED.
  if (aiMode === "real") fetchImpl.allowRealAiUpstream = true;

  return { state, fetchImpl };
}

/** The bearer token the fake handed the user, from its own token table. */
function tokenOf(mock, userId) {
  return [...mock.state.users.entries()].find(([, id]) => id === userId)?.[0] ?? "";
}

/** One direct call into the fake, for the route-contract assertions. */
function fetchFake(mock, path, { method = "GET", token = "", body } = {}) {
  return mock.fetchImpl(`http://127.0.0.1:1${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** An http server in front of the fake, so the CLI test can spawn the real driver. */
function startMockHttp(mock) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : rawBody,
    });
    let initBody;
    const ct = String(req.headers["content-type"] ?? "");
    if (ct.includes("multipart/form-data")) initBody = await request.formData();
    else if (rawBody.length > 0) initBody = rawBody.toString("utf8");
    const response = await mock.fetchImpl(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: initBody });
    res.statusCode = response.status;
    for (const [k, v] of response.headers.entries()) res.setHeader(k, v);
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  return new Promise((ready) => {
    server.listen(0, "127.0.0.1", () => ready({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

function runCase(overrides = {}) {
  return runRevokeCase({
    apiOrigin: "http://127.0.0.1:1",
    fixtureId: "fx-docx-report-vi",
    caseName: "deactivate",
    repoRoot: REPO_ROOT,
    ...overrides,
  });
}

// ---- route contract --------------------------------------------------------

describe("G7-04 revoke API calls are registered routes", () => {
  const routes = routeCatalogue();

  it("the route catalogue is read", () => {
    assert.ok(routes.length > 200, `parsed ${routes.length} routes`);
  });

  for (const name of ["deactivateOrgMember", "removeWorkspaceMember", "createDocumentShare", "patchDocument"]) {
    it(`${name} is a route the Go router registers`, () => {
      const call = G8_CALLS[name];
      assert.ok(call, `G8_CALLS has no ${name}`);
      assert.ok(
        routes.some((r) => r.method === call.method && r.path === call.path),
        `the router registers no ${call.method} /api/v1${call.path}`,
      );
    });
  }

  it("deactivateOrgMember takes the org slug, removeWorkspaceMember takes both ids", () => {
    assert.equal(G8_CALLS.deactivateOrgMember.params.org, "slug");
    assert.deepEqual(G8_CALLS.removeWorkspaceMember.params, { workspaceID: "id", userID: "id" });
  });

  it("patchDocument may send visibility (the restricted document the downgrade case needs)", () => {
    assert.ok(G8_CALLS.patchDocument.body.includes("visibility"));
    assert.equal(sdiFields("PatchDocumentSDI").visibility.required, false);
  });

  it("the AI turn and save routes the driver uses are in the shared table", () => {
    for (const name of ["aiUniworkDocumentChatCompletions", "aiUniworkFrameChatCompletions", "listDocumentVersions", "lookupCommitIntent", "uploadDocumentFile", "commitDocumentVersion", "mintOfficeFrameToken", "createFileDocument"]) {
      assert.ok(name in G8_API_CALLS, `${name} is not in G8_API_CALLS`);
    }
  });
});

// ---- CLI args --------------------------------------------------------------

describe("G7-04 revoke CLI args", () => {
  it("parseArgs resolves --fixture all and --case all, and refuses an unknown case", () => {
    const all = parseArgs(["--fixture", "all", "--case", "all"]);
    assert.deepEqual(all.fixtures, [...REVOKE_FIXTURES]);
    assert.deepEqual(all.cases, [...REVOKE_CASES]);
    assert.equal(parseArgs(["--case", "deactivate"]).cases[0], "deactivate");
    assert.equal(parseArgs(["--case", "downgrade"]).cases[0], "downgrade");
    assert.equal(parseArgs(["--case", "remove"]).cases[0], "remove");
    assert.throws(() => parseArgs(["--case", "nope"]), /unknown --case/);
    assert.throws(() => parseArgs(["--fixture", "nope"]), /unknown --fixture/);
    assert.equal(parseArgs(["--dry-run"]).dryRun, true);
  });
});

// ---- the three cases, against the fake -------------------------------------

describe("G7-04 revoke cases (G7-A02.1)", () => {
  for (const caseName of REVOKE_CASES) {
    it(`${caseName} -> PASS (exit 0) with versions +0 and no committed intent`, async () => {
      const mock = createMockRevokeServer({ aiMode: "real" });
      const scratch = makeScratchRunDir();
      try {
        const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName });
        assert.equal(res.status, "PASS", res.reason);
        assert.equal(res.exitCode, 0);
        assert.equal(res.versionCounts.versionsBefore, 1);
        assert.equal(res.versionCounts.versionsAfterRevoke, 1);
        assert.equal(res.details.commitIntent.hasCommitted, false);
        assert.equal(res.details.aiTurn2.session.status, CASE_EXPECTATIONS[caseName].aiTurn2.session.status);
        assert.equal(res.details.aiTurn2.frame.status, CASE_EXPECTATIONS[caseName].aiTurn2.frame.status);
        assert.equal(res.details.save.upload.status, CASE_EXPECTATIONS[caseName].saveUpload.status);
        assert.equal(res.details.save.commit.status, CASE_EXPECTATIONS[caseName].saveCommit.status);
        // the row's reason is the compact measured tuple too, so the record's own
        // 240-char redaction leaves it intact
        assert.match(res.reason, /^revoke_held; t1 s200\/f200 t2 s/);
        assert.equal(redactSignInError(res.reason), res.reason);
      } finally {
        scratch.cleanup();
      }
    });
  }

  for (const caseName of REVOKE_CASES) {
    it(`${caseName}: a turn 1 that answered 200 from the fake provider BLOCKs the row (exit 77) with the content blocker named, while every revoke assertion stays PASS (BE-704-202)`, async () => {
      // aiMode "fake" (the default): the 200 carries a provider/model/content the
      // classifier labels fake, so the turn-1 CONTENT is BLOCKED although the
      // status is 200 — the shape cloud D2 ran under AI_PROVIDER=fake.
      const mock = createMockRevokeServer();
      const scratch = makeScratchRunDir();
      try {
        const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName });
        assert.equal(res.status, "BLOCKED", res.reason);
        assert.equal(res.exitCode, 77);
        assert.equal(res.blocker, AI_CONTENT_BLOCKER);
        assert.match(res.blocker, /turn-1 AI content not verifiable under the fake provider \(real-AI round\)/);
        // the row's own record is why: turn 1 answered 200 on both routes, and the
        // content step the row is measured against is BLOCKED (pre-fix this row PASSed)
        assert.equal(res.steps.aiTurn1.status, "BLOCKED");
        assert.equal(res.details.aiTurn1.session.status, 200);
        assert.equal(res.details.aiTurn1.frame.status, 200);
        // and the evidence still shows the revoke was proven: every revoke step is PASS
        for (const step of ["revoke", "aiTurn2", "saveRefused", "versionsBefore", "versionsAfter", "commitIntent"]) {
          assert.equal(res.steps[step].status, "PASS", `${step}: ${JSON.stringify(res.steps[step])}`);
        }
        assert.equal(res.versionCounts.versionsBefore, 1);
        assert.equal(res.versionCounts.versionsAfterRevoke, 1);
        // BE-704-350: the reason is the ONE helper's compact MEASURED tuple, so
        // the record's redaction (240 chars) keeps every measured answer
        assert.match(res.reason, /^content_not_verifiable; t1 s200\/f200 /);
        assert.match(res.reason, / v 1->1 save up /);
        assert.equal(redactSignInError(res.reason), res.reason);
        assert.ok(!/turn-1 AI content not verifiable/.test(res.reason), "the long blocker text lives in `blocker`/details, never in the reason");
      } finally {
        scratch.cleanup();
      }
    });
  }

  it("deactivate asserts each route as the code answers it: 403 member_deactivated on the session route, 401 unauthorized (error_class session) on the frame route with the file:line reason (D1-02)", async () => {
    const mock = createMockRevokeServer({ aiMode: "real" });
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
      assert.equal(res.status, "PASS", res.reason);
      assert.equal(res.details.aiTurn2.session.status, 403);
      assert.equal(res.details.aiTurn2.session.code, "member_deactivated");
      assert.equal(res.details.aiTurn2.frame.status, 401);
      assert.equal(res.details.aiTurn2.frame.code, "unauthorized");
      assert.equal(res.details.aiTurn2.frame.errorClass, "session");
      assert.equal(res.details.save.commit.status, 403);
      assert.equal(res.details.save.commit.code, "member_deactivated");
      // the artifact carries the file:line reason the frame route is a 401
      const note = (res.details.routeNotes ?? []).find((n) => n.route === "aiTurn2.frame");
      assert.ok(note, `no aiTurn2.frame route note in ${JSON.stringify(res.details.routeNotes)}`);
      assert.match(note.why, /ai_mount\.go:10[0-9]/);
      assert.match(note.why, /error_class\.go:64/);
    } finally {
      scratch.cleanup();
    }
  });

  it("remove answers 204 on the DELETE itself and 404 not_found on both AI routes next", async () => {
    const mock = createMockRevokeServer({ aiMode: "real" });
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "remove" });
      assert.equal(res.status, "PASS", res.reason);
      assert.equal(res.steps.revoke.httpStatus, 204);
      assert.equal(res.details.aiTurn2.session.status, 404);
      assert.equal(res.details.aiTurn2.session.code, "not_found");
      assert.equal(res.details.aiTurn2.frame.status, 404);
      assert.equal(res.details.save.upload.status, 404);
      assert.equal(res.details.save.commit.status, 404);
    } finally {
      scratch.cleanup();
    }
  });

  it("downgrade asserts what the code does: the AI turn still answers 200 (view-only AI is allowed, G6-05u) and the Save proof is the upload 403 forbidden with the commit 404 the route answers (BE-704-03)", async () => {
    const mock = createMockRevokeServer({ aiMode: "real" });
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "downgrade", fixtureId: "fx-xlsx-revenue-xyz" });
      assert.equal(res.status, "PASS", res.reason);
      assert.equal(res.details.aiTurn2.session.status, 200);
      assert.equal(res.details.aiTurn2.frame.status, 200);
      assert.equal(res.details.save.upload.status, 403);
      assert.equal(res.details.save.upload.code, "forbidden");
      assert.equal(res.details.save.commit.status, 404);
      assert.equal(res.details.save.commit.code, "not_found");
      assert.equal(res.versionCounts.versionsAfterRevoke, 1);
      assert.equal(res.details.prepared.restricted, true);
      assert.equal(res.details.prepared.shareLevel, "view");
      const note = (res.details.routeNotes ?? []).find((n) => n.route === "saveCommit");
      assert.ok(note, `no saveCommit route note in ${JSON.stringify(res.details.routeNotes)}`);
      assert.match(note.why, /document_commit\.go:2(7[0-9]|9[0-9])/);
    } finally {
      scratch.cleanup();
    }
  });

  it("each (case, fixture) run seeds its own world, so a second case on the same run dir is not blocked by the first run's revoke (D1-01)", async () => {
    const mock = createMockRevokeServer({ aiMode: "real" });
    const scratch = makeScratchRunDir();
    try {
      const first = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
      assert.equal(first.status, "PASS", first.reason);
      const second = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "remove" });
      assert.equal(second.status, "PASS", second.reason);
      assert.equal(mock.state.registrations.length, 4, "two runs x owner+member");
      assert.notEqual(first.steps.seed.memberId, second.steps.seed.memberId);
    } finally {
      scratch.cleanup();
    }
  });

  it("counts versions with the owner's token, whose read the revoke never refuses (BE-704-02)", async () => {
    const mock = createMockRevokeServer({ aiMode: "real" });
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
      assert.equal(res.status, "PASS", res.reason);
      assert.equal(res.steps.versionsBefore.by, "owner");
      assert.equal(res.steps.versionsAfter.by, "owner");
      assert.equal(res.steps.commitIntent.by, "owner");
      // the artifact says what that lookup read is: the caller's own intent
      const note = (res.details.routeNotes ?? []).find((n) => n.route === "commitIntent");
      assert.ok(note, `no commitIntent route note in ${JSON.stringify(res.details.routeNotes)}`);
      assert.match(note.why, /document_commit_intent\.go:380-384, :429/);
      // and the fake really refuses the member's own read, so the member token
      // could not have produced this count
      const memberToken = tokenOf(mock, res.steps.seed.memberId);
      const memberRead = await fetchFake(mock, `/api/v1/documents/${DOC_ID}/versions`, { token: memberToken });
      assert.equal(memberRead.status, 403);
      assert.equal((await memberRead.json()).error.code, "member_deactivated");
    } finally {
      scratch.cleanup();
    }
  });

  it("never writes a world cache, deletes a stale one an earlier driver left, and never reuses its tokens (BE-704-04)", async () => {
    const mock = createMockRevokeServer({ aiMode: "real" });
    const scratch = makeScratchRunDir();
    const stale = join(scratch.dir, LEGACY_WORLD_CACHE);
    writeFileSync(stale, `${JSON.stringify({ apiOrigin: "http://127.0.0.1:1", owner: { token: "tok-stale-owner" }, member: { token: "tok-stale-member" }, workspaceId: WS_ID })}\n`);
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
      assert.equal(res.status, "PASS", res.reason);
      assert.equal(existsSync(stale), false, "the stale world cache is removed, never read back");
      assert.equal(mock.state.registrations.length, 2, "the world was seeded fresh, not read from the cache");
      assert.equal(mock.state.users.has("tok-stale-owner"), false);
      // no file in the run dir carries a bearer token
      const files = readdirSync(scratch.dir).filter((name) => statSync(join(scratch.dir, name)).isFile());
      for (const name of files) {
        assert.ok(!/tok-/.test(readFileSync(join(scratch.dir, name), "utf8")), `${name} carries a token`);
      }
    } finally {
      scratch.cleanup();
    }
  });

  it("a committed commit intent after the revoke is a FAIL (exit 1), never a PASS (BE-704-01)", async () => {
    const mock = createMockRevokeServer({ commitIntentAfterRevoke: true });
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
      assert.equal(res.status, "FAIL");
      assert.equal(res.exitCode, 1);
      assert.match(res.reason, /^commit_intent_committed; /);
      assert.equal(res.details.verdict, "commit_intent_committed");
      // the helper really saw the committed body the driver's call() returns
      assert.equal(res.details.commitIntent.outcome, "committed");
      assert.equal(res.details.commitIntent.hasCommitted, true);
      assert.equal(res.steps.commitIntent.status, "FAIL");
    } finally {
      scratch.cleanup();
    }
  });

  it("a 200 after the revoke is a FAIL (exit 1), never a PASS", async () => {
    const mock = createMockRevokeServer({ ignoreRevokeOnAiTurn: true });
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
      assert.equal(res.status, "FAIL");
      assert.equal(res.exitCode, 1);
      // the measured tuple of both turns, with the 200 the revoke should have refused
      assert.match(res.reason, /^turn2_not_refused; t1 s200\/f200 t2 s200\/f200 /);
      assert.equal(res.details.verdict, "turn2_not_refused");
      assert.equal(redactSignInError(res.reason), res.reason);
      // BE-704-202: this row's turn-1 content is BLOCKED too (the fake provider),
      // and the broken revoke assertion still wins over that BLOCKED
      assert.equal(res.steps.aiTurn1.status, "BLOCKED");
    } finally {
      scratch.cleanup();
    }
  });

  it("a version after the revoke is a FAIL (exit 1)", async () => {
    const mock = createMockRevokeServer({ allowSaveAfterRevoke: true });
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "remove" });
      assert.equal(res.status, "FAIL");
      assert.equal(res.exitCode, 1);
      assert.match(res.reason, /^version_delta; .* v 1->2 /);
      assert.equal(res.details.verdict, "version_delta");
      assert.equal(res.versionCounts.versionsAfterRevoke, 2);
    } finally {
      scratch.cleanup();
    }
  });

  it("a fake deployment answering 503 ai_disabled on turn 1 is BLOCKED (exit 77) while the revoke assertion still runs", async () => {
    const mock = createMockRevokeServer({ aiMode: "disabled" });
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
      assert.equal(res.status, "BLOCKED");
      assert.equal(res.exitCode, 77);
      assert.equal(res.blocker, AI_DISABLED_BLOCKER);
      assert.equal(res.steps.revoke.status, "PASS");
      assert.equal(res.steps.aiTurn2.status, "PASS");
      assert.equal(res.steps.saveRefused.status, "PASS");
      assert.equal(res.versionCounts.versionsAfterRevoke, 1);
    } finally {
      scratch.cleanup();
    }
  });

  for (const caseName of REVOKE_CASES) {
    it(`${caseName}: turn 1 refused 403 office_capability_off is BLOCKED (exit 77) with the capability named, whatever turn 2 answers (D2-02)`, async () => {
      const mock = createMockRevokeServer({ aiMode: "capability-off" });
      const scratch = makeScratchRunDir();
      try {
        const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName });
        assert.equal(res.status, "BLOCKED", res.reason);
        assert.equal(res.exitCode, 77);
        assert.equal(res.blocker, capabilityOffBlocker("ai_uniwork_docx"));
        assert.match(res.blocker, /ai_uniwork_docx/);
        assert.match(res.blocker, /turn 1 refused/);
        assert.equal(res.steps.aiTurn1.status, "BLOCKED");
        assert.equal(res.details.aiTurn1.session.status, 403);
        assert.equal(res.details.aiTurn1.session.code, "office_capability_off");
        assert.equal(res.details.aiTurn1.frame.status, 403);
        assert.equal(res.details.aiTurn1.frame.code, "office_capability_off");
        // the revoke itself still ran: a blocked row never claims the revoke failed
        assert.equal(res.versionCounts.versionsAfterRevoke, 1);
        assert.equal(res.steps.revoke.status, "PASS");
        // BE-704-350/351: the BLOCKED reason is the ONE helper's compact measured
        // tuple — both turn-1 routes, both turn-2 routes, the versions and BOTH
        // Save answers — so the record's own 240-char redaction keeps it intact
        // (the old prose reason lost its measured tail right here).
        assert.match(res.reason, /^capability_off ai_uniwork_docx; t1 s403 office_capability_off\/f403 office_capability_off t2 s/);
        assert.match(res.reason, / v 1->1 save up .+\/cm /);
        assert.ok(res.reason.length <= 240, `${res.reason.length} chars: ${res.reason}`);
        assert.equal(redactSignInError(res.reason), res.reason);
        // the long text (the blocker and the expectation) is in the record's own
        // fields, never in the capped reason
        assert.equal(res.details.verdict, "capability_off ai_uniwork_docx");
        assert.ok(res.details.expected.aiTurn2.session, "the expectation is recorded in details");
      } finally {
        scratch.cleanup();
      }
    });
  }

  it("the capability named is the document's own format: an xlsx row names ai_uniwork_xlsx (D2-02)", async () => {
    const mock = createMockRevokeServer({ aiMode: "capability-off" });
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate", fixtureId: "fx-xlsx-revenue-xyz" });
      assert.equal(res.status, "BLOCKED", res.reason);
      assert.equal(res.blocker, capabilityOffBlocker("ai_uniwork_xlsx"));
      assert.match(res.blocker, /ai_uniwork_xlsx/);
      // the format-named capability is in the reason too, and the reason survives
      // the record's redaction (BE-704-350)
      assert.match(res.reason, /^capability_off ai_uniwork_xlsx; /);
      assert.equal(redactSignInError(res.reason), res.reason);
    } finally {
      scratch.cleanup();
    }
  });

  it("turn 1 answering a non-200 that is neither capability-off nor ai_disabled is a FAIL naming both routes (D2-02)", async () => {
    const mock = createMockRevokeServer({ aiMode: "turn1-forbidden" });
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
      assert.equal(res.status, "FAIL");
      assert.equal(res.exitCode, 1);
      // BE-704-350: the reason is the compact measured tuple of BOTH routes; the
      // expectation it failed against is long text and lives in details
      assert.match(res.reason, /^turn1_not_200; t1 s403 forbidden\/f403 forbidden t2 /);
      assert.equal(res.details.verdict, "turn1_not_200");
      assert.equal(res.details.expected.aiTurn1.session, "200");
      assert.equal(res.details.expected.aiTurn1.frame, "200");
      assert.equal(redactSignInError(res.reason), res.reason);
      assert.equal(res.details.aiTurn1.session.status, 403);
      assert.equal(res.details.aiTurn1.frame.status, 403);
    } finally {
      scratch.cleanup();
    }
  });

  for (const failure of ["500", "timeout"]) {
    it(`BE-704-352: a session AI route answering ${failure} while the frame route still answers FAILs (exit 1) with BOTH routes measured, never a generic exception`, async () => {
      const mock = createMockRevokeServer({ aiMode: "real", sessionFailure: failure });
      const scratch = makeScratchRunDir();
      try {
        const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
        assert.equal(res.status, "FAIL", res.reason);
        assert.equal(res.exitCode, 1);
        // the failure is measured, not thrown: the old path landed in catch()
        assert.equal(res.steps.exception, undefined, `a transport failure must be measured: ${JSON.stringify(res.steps.exception)}`);
        const wantSession = failure === "timeout" ? "0 timeout" : "500 http_500";
        assert.match(res.reason, /^turn1_not_200; /);
        assert.ok(res.reason.includes(`t1 s${wantSession}/f200`), res.reason);
        assert.equal(res.details.aiTurn1.session.status, failure === "timeout" ? 0 : 500);
        assert.equal(res.details.aiTurn1.session.code, failure === "timeout" ? "timeout" : "http_500");
        assert.equal(res.details.aiTurn1.frame.status, 200);
        // the driver always tries BOTH routes: the frame route is in the request log
        assert.ok(
          mock.state.calls.some((c) => c.path === `/api/v1/office-frame/documents/${DOC_ID}/ai/uniwork/chat/completions`),
          "the frame route was never called after the session failure",
        );
        assert.equal(redactSignInError(res.reason), res.reason);
      } finally {
        scratch.cleanup();
      }
    });
  }

  it("BE-704-451: the capability-off BLOCKED needs BOTH turn-1 routes — one refusal with a 500 or a timeout on the other route is turn1_not_200 FAIL (exit 1) naming both cells", async () => {
    const combos = [
      [{ aiMode: "capability-off", frameFailure: "500" }, "t1 s403 office_capability_off/f500 http_500"],
      [{ aiMode: "capability-off", sessionFailure: "500" }, "t1 s500 http_500/f403 office_capability_off"],
      [{ aiMode: "capability-off", frameFailure: "timeout" }, "t1 s403 office_capability_off/f0 timeout"],
      [{ aiMode: "capability-off", sessionFailure: "timeout" }, "t1 s0 timeout/f403 office_capability_off"],
    ];
    for (const [options, cell] of combos) {
      const mock = createMockRevokeServer(options);
      const scratch = makeScratchRunDir();
      try {
        const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
        assert.equal(res.status, "FAIL", `${cell}: ${res.reason}`);
        assert.equal(res.exitCode, 1);
        assert.equal(res.blocker, "", "a mixed route failure is a FAIL, never a capability BLOCKED");
        // the row's own step says FAIL too: the artifact never reads BLOCKED where the row FAILed
        assert.equal(res.steps.aiTurn1.status, "FAIL");
        assert.equal(res.steps.aiTurn1.reason, "turn1_not_200");
        // BOTH measured route cells are in the reason, the refusing one and the failing one
        assert.match(res.reason, /^turn1_not_200; t1 s/);
        assert.ok(res.reason.includes(cell), `${cell} missing from ${res.reason}`);
        // a measured route failure never lands in the driver_error path
        assert.equal(res.steps.exception, undefined);
        assert.equal(redactSignInError(res.reason), res.reason);
      } finally {
        scratch.cleanup();
      }
    }
  });

  it("BE-704-551: the ai_disabled BLOCKED needs BOTH turn-1 routes — one 503 ai_disabled with a 500 or a timeout on the other route is turn1_not_200 FAIL (exit 1) naming both cells", async () => {
    const combos = [
      [{ aiMode: "disabled", frameFailure: "500" }, "t1 s503 ai_disabled/f500 http_500"],
      [{ aiMode: "disabled", sessionFailure: "500" }, "t1 s500 http_500/f503 ai_disabled"],
      [{ aiMode: "disabled", frameFailure: "timeout" }, "t1 s503 ai_disabled/f0 timeout"],
      [{ aiMode: "disabled", sessionFailure: "timeout" }, "t1 s0 timeout/f503 ai_disabled"],
    ];
    for (const [options, cell] of combos) {
      const mock = createMockRevokeServer(options);
      const scratch = makeScratchRunDir();
      try {
        const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
        assert.equal(res.status, "FAIL", `${cell}: ${res.reason}`);
        assert.equal(res.exitCode, 1);
        assert.equal(res.blocker, "", "a mixed route failure is a FAIL, never an ai_disabled BLOCKED");
        assert.equal(res.details.verdict, "turn1_not_200");
        assert.equal(res.steps.aiTurn1.status, "FAIL");
        assert.equal(res.steps.aiTurn1.reason, "turn1_not_200");
        assert.match(res.reason, /^turn1_not_200; t1 s/);
        assert.ok(res.reason.includes(cell), `${cell} missing from ${res.reason}`);
        assert.equal(res.steps.exception, undefined);
        assert.equal(redactSignInError(res.reason), res.reason);
      } finally {
        scratch.cleanup();
      }
    }
    const bothDisabled = createMockRevokeServer({ aiMode: "disabled" });
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: bothDisabled.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
      assert.equal(res.status, "BLOCKED");
      assert.equal(res.exitCode, 77);
      assert.equal(res.blocker, AI_DISABLED_BLOCKER);
      assert.equal(res.steps.aiTurn1.status, "BLOCKED");
      assert.equal(res.steps.aiTurn1.reason, "ai_disabled");
    } finally {
      scratch.cleanup();
    }
  });

  it("BE-704-450: a Save upload/commit failure carries the SAME mapped code as the AI routes (http_<status>, timeout, transport), never a second vocabulary", async () => {
    const combos = [
      // a deactivate refuses the member's Save at the gate, so the OTHER route's
      // answer is the case's own refusal (403 member_deactivated), and only the
      // route under test carries the mapped failure code
      [{ uploadFailure: "500" }, { upload: "500 http_500", commit: "403 member_deactivated" }],
      [{ uploadFailure: "timeout" }, { upload: "0 timeout", commit: "403 member_deactivated" }],
      [{ commitFailure: "500" }, { upload: "403 member_deactivated", commit: "500 http_500" }],
      [{ commitFailure: "transport" }, { upload: "403 member_deactivated", commit: "0 transport" }],
    ];
    for (const [options, want] of combos) {
      const mock = createMockRevokeServer(options);
      const scratch = makeScratchRunDir();
      try {
        const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
        assert.equal(res.status, "FAIL", `${JSON.stringify(want)}: ${res.reason}`);
        assert.equal(res.details.verdict, "save_not_refused");
        // the Save answer carries the route's own mapped code, not a synthesized one
        assert.equal(res.details.save.upload.status, Number(want.upload.split(" ")[0]));
        assert.equal(res.details.save.upload.code, want.upload.split(" ")[1] ?? "");
        assert.equal(res.details.save.commit.status, Number(want.commit.split(" ")[0]));
        assert.equal(res.details.save.commit.code, want.commit.split(" ")[1] ?? "");
        // and the same cells reach the compact reason
        assert.ok(res.reason.includes(`save up ${want.upload}/cm ${want.commit}`), `${want.upload}/${want.commit} missing from ${res.reason}`);
        // the old, invented `transport_error` code is nowhere
        assert.ok(!/transport_error/.test(res.reason), `a code that is not on the wire leaked into the reason: ${res.reason}`);
        assert.ok(!/transport_error/.test(JSON.stringify(res.details.save)), "the old synthesized code is still recorded");
        assert.equal(redactSignInError(res.reason), res.reason);
      } finally {
        scratch.cleanup();
      }
    }
  });

  it("BE-704-454: a statusless fetch rejection is a measured `transport` route failure, while any other exception is the driver_error FAIL, never a route failure", async () => {
    const scratch = makeScratchRunDir();
    try {
      // the platform's own fetch rejection (a TypeError carrying its cause):
      // measured as `transport`, and the frame route is still tried
      const transportMock = createMockRevokeServer({ aiMode: "real", sessionFailure: "transport" });
      const transport = await runCase({ fetchImpl: transportMock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
      assert.equal(transport.status, "FAIL", transport.reason);
      assert.equal(transport.exitCode, 1);
      assert.equal(transport.steps.exception, undefined, "a transport failure is measured, never a driver exception");
      assert.equal(transport.details.verdict, "turn1_not_200");
      assert.equal(transport.details.aiTurn1.session.status, 0);
      assert.equal(transport.details.aiTurn1.session.code, "transport");
      assert.match(transport.reason, /^turn1_not_200; t1 s0 transport\/f200 /);
      assert.ok(
        transportMock.state.calls.some((c) => c.path === `/api/v1/office-frame/documents/${DOC_ID}/ai/uniwork/chat/completions`),
        "the frame route was never tried after the session transport failure",
      );
      // a harness defect: the same wrapper must NOT label it a route transport failure
      const driverMock = createMockRevokeServer({ aiMode: "real", sessionFailure: "driver" });
      const driver = await runCase({ fetchImpl: driverMock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
      assert.equal(driver.status, "FAIL");
      assert.equal(driver.exitCode, 1);
      assert.equal(driver.details.verdict, "driver_error");
      assert.equal(driver.steps.exception.status, "FAIL");
      assert.match(driver.steps.exception.reason, /the session AI route failed/);
      assert.ok(!/transport/.test(driver.reason), `a driver defect was reported as a route failure: ${driver.reason}`);
    } finally {
      scratch.cleanup();
    }
  });

  it("turn 1 200 on both routes but turn 2 refused office_capability_off is a FAIL named as a capability flip, driven through the downgrade the real gate order can produce (D2-03, BE-704-353)", async () => {
    // BE-704-353: RequireMember (service/ai_uniwork.go:241-244) refuses a
    // deactivated member BEFORE checkUniworkCapability (:503-515), so a
    // deactivated member can never see a capability flip. The row that can is
    // the downgrade member, whose AI right survives the drop to view-only
    // (G6-05u); the fake applies the same order (see createMockRevokeServer).
    const mock = createMockRevokeServer({ aiMode: "capability-off-turn2" });
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "downgrade", fixtureId: "fx-xlsx-revenue-xyz" });
      assert.equal(res.status, "FAIL");
      assert.equal(res.exitCode, 1);
      assert.equal(res.details.aiTurn1.session.status, 200);
      assert.equal(res.details.aiTurn1.frame.status, 200);
      assert.equal(res.details.aiTurn2.session.status, 403);
      assert.equal(res.details.aiTurn2.session.code, "office_capability_off");
      assert.equal(res.details.aiTurn2.frame.status, 403);
      assert.equal(res.details.aiTurn2.frame.code, "office_capability_off");
      assert.match(res.reason, /^capability_flip ai_uniwork_xlsx; t1 s200\/f200 t2 s403 office_capability_off\/f403 office_capability_off /);
      assert.equal(res.details.verdict, "capability_flip ai_uniwork_xlsx");
      assert.match(res.details.why, /D2-03/);
      assert.equal(redactSignInError(res.reason), res.reason);
    } finally {
      scratch.cleanup();
    }
  });

  it("a deactivated member never reaches the capability check: the deactivate row keeps its Go-matching 403 member_deactivated / frame 401 unauthorized answers, whatever the deployment's flags (BE-704-353)", async () => {
    // The deactivate row that used to carry the turn-2 capability flip: with the
    // fake applying the Go gate order, the membership refusal wins, and the row
    // PASSes the AI-turn assertion as the Go code answers it. Driving a
    // capability flip through `deactivate` would prove a state the server cannot
    // produce — which is exactly what BE-704-353 found.
    const mock = createMockRevokeServer({ aiMode: "capability-off-turn2" });
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
      // the membership refusal wins on turn 2 and the row's own AI-turn assertion
      // holds as the Go code answers it; with this fake's plain 200 the row is
      // only BLOCKED on the unverifiable turn-1 content (BE-704-202), never on
      // the capability flip the old test claimed
      assert.equal(res.blocker, AI_CONTENT_BLOCKER);
      assert.equal(res.steps.aiTurn2.status, "PASS");
      assert.equal(res.details.aiTurn2.session.status, 403);
      assert.equal(res.details.aiTurn2.session.code, "member_deactivated");
      assert.equal(res.details.aiTurn2.frame.status, 401);
      assert.equal(res.details.aiTurn2.frame.code, "unauthorized");
      assert.equal(res.details.aiTurn2.frame.errorClass, "session");
      assert.ok(!/office_capability_off/.test(res.reason), res.reason);
    } finally {
      scratch.cleanup();
    }
  });

  it("a start.sh that failed is a FAIL (exit 1), and a blocked one is BLOCKED (77) — with the start.sh text in details, never in the capped reason", async () => {
    const failed = makeScratchRunDir({ startState: "failed", startReason: "server build failed" });
    const blocked = makeScratchRunDir({ startState: "blocked", startReason: "missing xvfb" });
    try {
      const mock = createMockRevokeServer();
      const f = await runCase({ fetchImpl: mock.fetchImpl, runDir: failed.dir, caseName: "deactivate" });
      assert.equal(f.exitCode, 1);
      assert.match(f.reason, /^start_failed; no measurement$/);
      assert.match(f.details.gate, /server build failed/);
      assert.match(f.steps.start.reason, /server build failed/);
      const b = await runCase({ fetchImpl: mock.fetchImpl, runDir: blocked.dir, caseName: "deactivate" });
      assert.equal(b.exitCode, 77);
      // the blocker keeps the whole prose for the record, the CLI's BLOCKED line
      // and the evidence ledger
      assert.match(b.blocker, /missing xvfb/);
      assert.match(b.reason, /^start_blocked; no measurement$/);
      assert.match(b.details.gate, /missing xvfb/);
    } finally {
      failed.cleanup();
      blocked.cleanup();
    }
  });
});

// ---- the fake's route contracts (BE-704-06) --------------------------------

describe("the fake answers the real route contracts it is driven against", () => {
  it("after a deactivate: the member's versions read is 403, the session AI route is 403 member_deactivated and the frame AI route is 401 unauthorized", async () => {
    const mock = createMockRevokeServer();
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "deactivate" });
      const memberToken = tokenOf(mock, res.steps.seed.memberId);
      const frameToken = [...mock.state.frameTokens.keys()][0];
      const versions = await fetchFake(mock, `/api/v1/documents/${DOC_ID}/versions`, { token: memberToken });
      assert.equal(versions.status, 403);
      const session = await fetchFake(mock, `/api/v1/documents/${DOC_ID}/ai/uniwork/chat/completions`, { method: "POST", token: memberToken, body: { messages: [] } });
      assert.equal(session.status, 403);
      assert.equal((await session.json()).error.code, "member_deactivated");
      const frame = await fetchFake(mock, `/api/v1/office-frame/documents/${DOC_ID}/ai/uniwork/chat/completions`, { method: "POST", token: frameToken, body: { messages: [] } });
      assert.equal(frame.status, 401);
      assert.deepEqual((await frame.json()).error, { code: "unauthorized", message: "unauthorized", error_class: "session" });
    } finally {
      scratch.cleanup();
    }
  });

  it("after a remove: the member's versions read and both AI routes are 404 not_found", async () => {
    const mock = createMockRevokeServer();
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "remove" });
      const memberToken = tokenOf(mock, res.steps.seed.memberId);
      const versions = await fetchFake(mock, `/api/v1/documents/${DOC_ID}/versions`, { token: memberToken });
      assert.equal(versions.status, 404);
      const frameToken = [...mock.state.frameTokens.keys()][0];
      const frame = await fetchFake(mock, `/api/v1/office-frame/documents/${DOC_ID}/ai/uniwork/chat/completions`, { method: "POST", token: frameToken, body: { messages: [] } });
      assert.equal(frame.status, 404);
      assert.equal((await frame.json()).error.code, "not_found");
    } finally {
      scratch.cleanup();
    }
  });

  it("the commit resolves upload_id before the access gate: an unresolvable id is 404 even for a view-only member", async () => {
    const mock = createMockRevokeServer();
    const scratch = makeScratchRunDir();
    try {
      const res = await runCase({ fetchImpl: mock.fetchImpl, runDir: scratch.dir, caseName: "downgrade", fixtureId: "fx-xlsx-revenue-xyz" });
      const memberToken = tokenOf(mock, res.steps.seed.memberId);
      assert.ok(memberToken, "the fake handed the member a token");
      const commit = await fetchFake(mock, `/api/v1/documents/${DOC_ID}/versions/commit`, { method: "POST", token: memberToken, body: { upload_id: "none", base_revision: "1" } });
      assert.equal(commit.status, 404);
      assert.equal((await commit.json()).error.code, "not_found");
    } finally {
      scratch.cleanup();
    }
  });
});

// ---- the pure decision -----------------------------------------------------

describe("decideRevokeOutcome", () => {
  const base = () => ({
    caseName: "deactivate",
    expectations: CASE_EXPECTATIONS.deactivate,
    versionsBefore: 1,
    versionsAfterRevoke: 1,
    aiTurn1: { session: { status: 200 }, frame: { status: 200 } },
    aiTurn2: { session: { status: 403, code: "member_deactivated" }, frame: { status: 401, code: "unauthorized", errorClass: "session" } },
    revoke: { status: 200 },
    save: { upload: { status: 403, code: "member_deactivated" }, commit: { status: 403, code: "member_deactivated" } },
    commitIntent: { httpStatus: 410, outcome: "unknown", hasCommitted: false },
  });

  it("PASSes the clean record", () => {
    assert.equal(decideRevokeOutcome(base()).status, "PASS");
  });

  it("FAILs a version delta, a committed intent, a wrong per-route AI answer and a wrong save code", () => {
    assert.equal(decideRevokeOutcome({ ...base(), versionsAfterRevoke: 2 }).status, "FAIL");
    assert.equal(decideRevokeOutcome({ ...base(), commitIntent: { hasCommitted: true } }).status, "FAIL");
    // the frame route answering the session route's 403 is not what the code does
    assert.equal(decideRevokeOutcome({ ...base(), aiTurn2: { session: { status: 403, code: "member_deactivated" }, frame: { status: 403, code: "member_deactivated" } } }).status, "FAIL");
    assert.equal(decideRevokeOutcome({ ...base(), aiTurn2: { session: { status: 200 }, frame: { status: 401, code: "unauthorized", errorClass: "session" } } }).status, "FAIL");
    // the right status with the wrong code (or the wrong error_class) is a FAIL too
    assert.equal(decideRevokeOutcome({ ...base(), aiTurn2: { session: { status: 403, code: "forbidden" }, frame: { status: 401, code: "unauthorized", errorClass: "session" } } }).status, "FAIL");
    assert.equal(decideRevokeOutcome({ ...base(), aiTurn2: { session: { status: 403, code: "member_deactivated" }, frame: { status: 401, code: "unauthorized", errorClass: "permission" } } }).status, "FAIL");
    assert.equal(decideRevokeOutcome({ ...base(), save: { upload: { status: 403, code: "forbidden" }, commit: { status: 403, code: "member_deactivated" } } }).status, "FAIL");
  });

  it("downgrade: the Save proof is the upload's 403 forbidden, and the commit's own 404 is a PASS (BE-704-03)", () => {
    const downgrade = {
      ...base(),
      caseName: "downgrade",
      expectations: CASE_EXPECTATIONS.downgrade,
      aiTurn2: { session: { status: 200 }, frame: { status: 200 } },
      save: { upload: { status: 403, code: "forbidden" }, commit: { status: 404, code: "not_found" } },
    };
    assert.equal(decideRevokeOutcome(downgrade).status, "PASS");
    // asserting the edit-level 403 on the commit is the old, wrong expectation
    assert.equal(decideRevokeOutcome({ ...downgrade, save: { upload: { status: 403, code: "forbidden" }, commit: { status: 403, code: "forbidden" } } }).status, "FAIL");
    // and the upload must be the edit refusal, not any 4xx
    assert.equal(decideRevokeOutcome({ ...downgrade, save: { upload: { status: 404, code: "not_found" }, commit: { status: 404, code: "not_found" } } }).status, "FAIL");
  });

  it("turn 1 refused 403 office_capability_off is BLOCKED (exit 77) with the capability named, for all three cases (D2-02)", () => {
    // Each case brings the revoke record it really answers (cloud D2): the row is
    // BLOCKED only because the revoke assertions themselves held.
    const perCase = {
      deactivate: { aiTurn2: { session: { status: 403, code: "member_deactivated" }, frame: { status: 401, code: "unauthorized", errorClass: "session" } }, save: { upload: { status: 403, code: "member_deactivated" }, commit: { status: 403, code: "member_deactivated" } } },
      downgrade: { aiTurn2: { session: { status: 403, code: "office_capability_off" }, frame: { status: 403, code: "office_capability_off" } }, save: { upload: { status: 403, code: "forbidden" }, commit: { status: 404, code: "not_found" } } },
      remove: { aiTurn2: { session: { status: 404, code: "not_found" }, frame: { status: 404, code: "not_found" } }, save: { upload: { status: 404, code: "not_found" }, commit: { status: 404, code: "not_found" } } },
    };
    for (const caseName of REVOKE_CASES) {
      const out = decideRevokeOutcome({
        ...base(),
        caseName,
        expectations: CASE_EXPECTATIONS[caseName],
        revoke: { status: CASE_EXPECTATIONS[caseName].revoke },
        ...perCase[caseName],
        aiTurn1: {
          session: { status: 403, code: "office_capability_off", capability: "ai_uniwork_xlsx" },
          frame: { status: 403, code: "office_capability_off", capability: "ai_uniwork_xlsx" },
        },
      });
      assert.equal(out.status, "BLOCKED", caseName);
      assert.equal(out.exitCode, 77);
      assert.equal(out.blocker, capabilityOffBlocker("ai_uniwork_xlsx"));
      assert.match(out.blocker, /ai_uniwork_xlsx/);
      assert.match(out.blocker, /turn 1 refused/);
    }
  });

  it("BE-704-351: the capability-off BLOCKED reason is built from the measured tuple — every measured answer, the versions and BOTH Save answers — and is not changed by the 240-char redaction", () => {
    // Every measured answer that can differ without the row first failing another
    // assertion is deliberately unlike the case's expectation: a reason built from
    // x.aiTurn2 / x.save would print the expectation as if it were an observation.
    const out = decideRevokeOutcome({
      ...base(),
      versionsBefore: 3,
      versionsAfterRevoke: 3,
      aiTurn1: {
        session: { status: 403, code: "office_capability_off", capability: "ai_uniwork_xlsx" },
        frame: { status: 403, code: "office_capability_off", capability: "ai_uniwork_xlsx" },
      },
      aiTurn2: { session: { status: 418, code: "teapot" }, frame: { status: 429, code: "rate_limited" } },
    });
    assert.equal(out.status, "BLOCKED");
    assert.equal(out.exitCode, 77);
    assert.equal(out.blocker, capabilityOffBlocker("ai_uniwork_xlsx"));
    for (const measured of [
      "t1 s403 office_capability_off/f403 office_capability_off",
      "t2 s418 teapot/f429 rate_limited",
      "v 3->3",
      "save up 403 member_deactivated/cm 403 member_deactivated",
    ]) {
      assert.ok(out.reason.includes(measured), `${measured} missing from ${out.reason}`);
    }
    assert.ok(!/t2 s403 member_deactivated/.test(out.reason), `the reason printed the expectation: ${out.reason}`);
    // the reason is what the record redacts, so it must be unchanged by it
    assert.equal(redactSignInError(out.reason), out.reason);
    assert.ok(out.reason.length <= 240, `${out.reason.length} chars: ${out.reason}`);
    // the long text (blocker + expectation) is in the record's own fields
    assert.equal(out.details.verdict, "capability_off ai_uniwork_xlsx");
    assert.equal(out.details.expected.aiTurn2.session, "403 member_deactivated");
    // and the widest reason this row can compose — the capability refused on BOTH
    // routes of BOTH turns, an error_class-carrying turn 2 and the largest version
    // count — still fits the record's 240-char redaction intact
    const widest = decideRevokeOutcome({
      ...base(),
      versionsBefore: 123456,
      versionsAfterRevoke: 123456,
      aiTurn1: {
        session: { status: 403, code: "office_capability_off", capability: "ai_uniwork_xlsx" },
        frame: { status: 403, code: "office_capability_off", capability: "ai_uniwork_xlsx" },
      },
      aiTurn2: { session: { status: 403, code: "office_capability_off" }, frame: { status: 403, code: "office_capability_off", errorClass: "permission" } },
    });
    assert.equal(widest.status, "BLOCKED");
    assert.ok(widest.reason.length <= 240, `${widest.reason.length} chars: ${widest.reason}`);
    assert.equal(redactSignInError(widest.reason), widest.reason);
  });

  it("every BLOCKED/FAIL reason is one helper's compact measured tuple, inside the 240-char record redaction (BE-704-350)", () => {
    const failing = {
      version_delta: { versionsAfterRevoke: 2 },
      commit_intent_committed: { commitIntent: { hasCommitted: true } },
      save_not_refused: { save: { upload: { status: 403, code: "forbidden" }, commit: { status: 404, code: "not_found" } } },
      revoke_status: { revoke: { status: 409 } },
      turn1_not_200: { aiTurn1: { session: { status: 500, code: "http_500" }, frame: { status: 0, code: "timeout" } } },
      capability_flip: { aiTurn2: { session: { status: 403, code: "office_capability_off", capability: "ai_uniwork_xlsx" }, frame: { status: 403, code: "office_capability_off", capability: "ai_uniwork_xlsx" } } },
      turn2_not_refused: { aiTurn2: { session: { status: 200 }, frame: { status: 200 } } },
      capability_off: { aiTurn1: { session: { status: 403, code: "office_capability_off", capability: "ai_uniwork_xlsx" }, frame: { status: 403, code: "office_capability_off", capability: "ai_uniwork_xlsx" } } },
      ai_disabled: { aiTurn1: { session: { status: 503, code: "ai_disabled" }, frame: { status: 503, code: "ai_disabled" } } },
      content_not_verifiable: { aiTurn1Step: { status: "BLOCKED" } },
    };
    for (const [verdict, over] of Object.entries(failing)) {
      const out = decideRevokeOutcome({ ...base(), ...over });
      assert.notEqual(out.status, "PASS", verdict);
      assert.match(out.reason, new RegExp(`^${verdict}`), verdict);
      // the tuple carries both turns, the versions and both Save answers
      assert.match(out.reason, /t1 s.+ t2 s.+ v \d+->\d+ save up .+\/cm /, verdict);
      assert.ok(out.reason.length <= 240, `${verdict}: ${out.reason.length} chars: ${out.reason}`);
      assert.equal(redactSignInError(out.reason), out.reason, verdict);
    }
  });

  it("BE-704-451: the capability-off BLOCKED applies only when BOTH turn-1 routes answer that refusal — any other non-200 route is turn1_not_200 FAIL with both cells", () => {
    const refusal = { status: 403, code: "office_capability_off", capability: "ai_uniwork_docx" };
    const mixed = [
      { session: refusal, frame: { status: 500, code: "http_500" } },
      { session: { status: 500, code: "http_500" }, frame: refusal },
      { session: refusal, frame: { status: 0, code: "timeout" } },
      { session: { status: 0, code: "timeout" }, frame: refusal },
    ];
    for (const aiTurn1 of mixed) {
      const out = decideRevokeOutcome({ ...base(), aiTurn1 });
      assert.equal(out.status, "FAIL", JSON.stringify(aiTurn1));
      assert.equal(out.exitCode, 1);
      assert.equal(out.details.verdict, "turn1_not_200");
      assert.match(out.reason, /^turn1_not_200; t1 s/);
      // one route refused the whole turn, the other failed on its own: both are in the reason
      const cell = (answer) => `${answer.status ?? "none"}${answer.code ? ` ${answer.code}` : ""}`;
      assert.ok(out.reason.includes(`s${cell(aiTurn1.session)}/f${cell(aiTurn1.frame)}`), out.reason);
      assert.equal(redactSignInError(out.reason), out.reason);
    }
    // the BLOCKED branch itself is unchanged: both routes must answer the refusal
    assert.equal(decideRevokeOutcome({ ...base(), aiTurn1: { session: refusal, frame: refusal } }).status, "BLOCKED");
  });

  it("BE-704-551: the ai_disabled BLOCKED applies only when BOTH turn-1 routes answer 503 ai_disabled — any other non-200 route is turn1_not_200 FAIL with both cells", () => {
    const disabled = { status: 503, code: "ai_disabled" };
    const mixed = [
      { session: disabled, frame: { status: 500, code: "http_500" } },
      { session: { status: 500, code: "http_500" }, frame: disabled },
      { session: disabled, frame: { status: 0, code: "timeout" } },
      { session: { status: 0, code: "timeout" }, frame: disabled },
    ];
    for (const aiTurn1 of mixed) {
      assert.equal(turn1DisabledOf(aiTurn1), false);
      const out = decideRevokeOutcome({ ...base(), aiTurn1 });
      assert.equal(out.status, "FAIL", JSON.stringify(aiTurn1));
      assert.equal(out.exitCode, 1);
      assert.equal(out.details.verdict, "turn1_not_200");
      assert.match(out.reason, /^turn1_not_200; t1 s/);
      const cell = (answer) => `${answer.status ?? "none"}${answer.code ? ` ${answer.code}` : ""}`;
      assert.ok(out.reason.includes(`s${cell(aiTurn1.session)}/f${cell(aiTurn1.frame)}`), out.reason);
      assert.equal(redactSignInError(out.reason), out.reason);
    }
    assert.equal(turn1DisabledOf({ session: disabled, frame: disabled }), true);
    const both = decideRevokeOutcome({ ...base(), aiTurn1: { session: disabled, frame: disabled } });
    assert.equal(both.status, "BLOCKED");
    assert.equal(both.exitCode, 77);
    assert.equal(both.blocker, AI_DISABLED_BLOCKER);
  });

  it("BE-704-452: every dynamic value a reason interpolates is bounded and redacted first, with an explicit marker for an oversized one", () => {
    // 61 chars, deliberately not a token-shaped run (no 32+ [A-Za-z0-9_-] run), so the
    // value reaches the cap instead of being redacted away
    const longCode = `${"A".repeat(30)}.${"B".repeat(30)}`;
    const longCapability = `ai_uniwork_${"c".repeat(30)}.${"d".repeat(30)}`;
    const tokenShaped = `tok${"0".repeat(48)}`;
    assert.equal(reasonValueOf(longCode), `oversized(${longCode.length})`);
    // a credential-shaped run is redacted, never marked oversized
    assert.equal(reasonValueOf(tokenShaped), "<redacted>");
    // a value the cap carries is kept verbatim, at the cap and one over it
    assert.equal(reasonValueOf("office_capability_off"), "office_capability_off");
    assert.equal(reasonValueOf("x".repeat(REASON_VALUE_MAX_CHARS)), "x".repeat(REASON_VALUE_MAX_CHARS));
    assert.equal(reasonValueOf("x".repeat(REASON_VALUE_MAX_CHARS + 1)), `oversized(${REASON_VALUE_MAX_CHARS + 1})`);

    const failures = {
      version_delta: { versionsAfterRevoke: 2 },
      commit_intent_committed: { commitIntent: { hasCommitted: true } },
      save_not_refused: { save: { upload: { status: 403, code: longCode }, commit: { status: 404, code: tokenShaped } } },
      revoke_status: { revoke: { status: 409 } },
      turn1_not_200: { aiTurn1: { session: { status: 500, code: longCode }, frame: { status: 0, code: tokenShaped } } },
      capability_flip: { aiTurn2: { session: { status: 403, code: "office_capability_off", capability: longCapability }, frame: { status: 403, code: "office_capability_off", capability: longCapability } } },
      capability_off: { aiTurn1: { session: { status: 403, code: "office_capability_off", capability: longCapability }, frame: { status: 403, code: "office_capability_off", capability: longCapability } } },
      ai_disabled: { aiTurn1: { session: { status: 503, code: "ai_disabled" }, frame: { status: 503, code: "ai_disabled" } } },
      content_not_verifiable: { aiTurn1Step: { status: "BLOCKED" } },
    };
    const longSave = { upload: { status: 403, code: longCode }, commit: { status: 404, code: tokenShaped } };
    for (const [verdict, over] of Object.entries(failures)) {
      const out = decideRevokeOutcome({ ...base(), save: longSave, ...over });
      assert.notEqual(out.status, "PASS", verdict);
      assert.ok(out.reason.length <= 240, `${verdict}: ${out.reason.length} chars: ${out.reason}`);
      // the helper's output is a fixed point of the record's own redaction
      assert.equal(redactSignInError(out.reason), out.reason, `${verdict}: ${out.reason}`);
      // the oversized value is MARKED, and the tuple keeps every field
      assert.ok(out.reason.includes(`oversized(${longCode.length})`), `${verdict} dropped the marker: ${out.reason}`);
      assert.ok(out.reason.includes("<redacted>"), `${verdict} kept a token-shaped value: ${out.reason}`);
      assert.match(out.reason, /t1 s.+ t2 s.+ v \d+->\d+ save up .+\/cm /, verdict);
      // and the record's redaction never had to truncate it
      assert.ok(!/\.\.\.$/.test(out.reason), `${verdict} was truncated: ${out.reason}`);
    }
  });

  it("turn 1 capability-off stays BLOCKED whatever turn 2 says, while a hard revoke violation still wins (D2-02)", () => {
    const capabilityOff = {
      ...base(),
      aiTurn1: {
        session: { status: 403, code: "office_capability_off", capability: "ai_uniwork_docx" },
        frame: { status: 403, code: "office_capability_off", capability: "ai_uniwork_docx" },
      },
    };
    assert.equal(decideRevokeOutcome(capabilityOff).status, "BLOCKED");
    // downgrade-xlsx in cloud D2: turn 2 answered the capability refusal, not the expected 200
    const downgradeOff = {
      ...capabilityOff,
      caseName: "downgrade",
      expectations: CASE_EXPECTATIONS.downgrade,
      revoke: { status: 200 },
      aiTurn2: { session: { status: 403, code: "office_capability_off" }, frame: { status: 403, code: "office_capability_off" } },
      save: { upload: { status: 403, code: "forbidden" }, commit: { status: 404, code: "not_found" } },
    };
    assert.equal(decideRevokeOutcome(downgradeOff).status, "BLOCKED");
    // a version that appeared across the revoke is a real defect, not a blocked environment
    assert.equal(decideRevokeOutcome({ ...capabilityOff, versionsAfterRevoke: 2 }).status, "FAIL");
    assert.equal(decideRevokeOutcome({ ...capabilityOff, commitIntent: { hasCommitted: true } }).status, "FAIL");
  });

  it("turn 1 answering anything but 200 (not a capability refusal) is a FAIL naming both routes (D2-02)", () => {
    const out = decideRevokeOutcome({ ...base(), aiTurn1: { session: { status: 403, code: "forbidden" }, frame: { status: 403, code: "forbidden" } } });
    assert.equal(out.status, "FAIL");
    assert.equal(out.exitCode, 1);
    // the compact measured tuple names both routes (BE-704-350); the expectation
    // it missed is long text and lives in details
    assert.match(out.reason, /^turn1_not_200; t1 s403 forbidden\/f403 forbidden t2 /);
    assert.equal(out.details.expected.aiTurn1.session, "200");
    assert.equal(out.details.expected.aiTurn1.frame, "200");
    assert.equal(redactSignInError(out.reason), out.reason);
    // a frame route that never answered 200 is not a PASS either
    assert.equal(decideRevokeOutcome({ ...base(), aiTurn1: { session: { status: 200 }, frame: { status: 404, code: "not_found" } } }).status, "FAIL");
  });

  it("turn 1 200 on both routes but turn 2 refused office_capability_off is a FAIL named as a capability flip (D2-03)", () => {
    const out = decideRevokeOutcome({
      ...base(),
      aiTurn2: {
        session: { status: 403, code: "office_capability_off", capability: "ai_uniwork_docx" },
        frame: { status: 403, code: "office_capability_off", capability: "ai_uniwork_docx" },
      },
    });
    assert.equal(out.status, "FAIL");
    assert.equal(out.exitCode, 1);
    assert.match(out.reason, /^capability_flip ai_uniwork_docx; t1 s200\/f200 t2 s403 office_capability_off\/f403 office_capability_off /);
    // the flip is compact-code + measurement here; the long D2-03 text is details
    assert.equal(out.details.verdict, "capability_flip ai_uniwork_docx");
    assert.match(out.details.why, /D2-03/);
    assert.ok(!/not a revoke result/.test(out.reason), `prose in the capped reason: ${out.reason}`);
    // the record's redaction (240 chars) must keep the flip named and measured
    assert.equal(redactSignInError(out.reason), out.reason);
  });

  it("BLOCKs on a 503 ai_disabled turn 1 only after every revoke assertion passed", () => {
    const disabled = { ...base(), aiTurn1: { session: { status: 503, code: "ai_disabled" }, frame: { status: 503, code: "ai_disabled" } } };
    assert.equal(decideRevokeOutcome(disabled).status, "BLOCKED");
    assert.equal(decideRevokeOutcome(disabled).exitCode, 77);
    // a broken revoke assertion still wins over the BLOCKED
    assert.equal(decideRevokeOutcome({ ...disabled, versionsAfterRevoke: 2 }).status, "FAIL");
  });

  it("BLOCKs (exit 77) a row whose turn-1 CONTENT step is BLOCKED under the fake provider, naming it, with every revoke assertion held (BE-704-202)", () => {
    const blockedContent = { ...base(), aiTurn1Step: { status: "BLOCKED" } };
    const out = decideRevokeOutcome(blockedContent);
    assert.equal(out.status, "BLOCKED");
    assert.equal(out.exitCode, 77);
    assert.equal(out.owner, "g7-qa");
    assert.equal(out.blocker, AI_CONTENT_BLOCKER);
    // the ONE helper's compact measured tuple — status and code per route, never
    // the expectations (BE-704-204/350); the frame route's error_class is evidence
    // for `details`, not for the capped reason
    assert.match(out.reason, /^content_not_verifiable; t1 s200\/f200 t2 s403 member_deactivated\/f401 unauthorized v 1->1 save up 403 member_deactivated\/cm 403 member_deactivated$/);
    assert.equal(out.details.verdict, "content_not_verifiable");
    // the frame route's error_class is still recorded — on the expectation side
    assert.equal(out.details.expected.aiTurn2.frame, "401 unauthorized error_class=session");
    // and the record's own redaction (240 chars) must keep every word of it
    assert.equal(redactSignInError(out.reason), out.reason);
    // any FAIL still wins over that BLOCKED
    assert.equal(decideRevokeOutcome({ ...blockedContent, versionsAfterRevoke: 2 }).status, "FAIL");
    assert.equal(decideRevokeOutcome({ ...blockedContent, commitIntent: { hasCommitted: true } }).status, "FAIL");
    assert.equal(decideRevokeOutcome({ ...blockedContent, revoke: { status: 500 } }).status, "FAIL");
    assert.equal(decideRevokeOutcome({ ...blockedContent, aiTurn2: { session: { status: 200 }, frame: { status: 200 } } }).status, "FAIL");
    // a turn-1 step that is not BLOCKED keeps the clean record PASS
    assert.equal(decideRevokeOutcome({ ...base(), aiTurn1Step: { status: "PASS" } }).status, "PASS");
    // and the ai_disabled refusal keeps its own blocker, never the content one
    const disabledTurn = { ...blockedContent, aiTurn1: { session: { status: 503, code: "ai_disabled" }, frame: { status: 503, code: "ai_disabled" } } };
    assert.equal(decideRevokeOutcome(disabledTurn).blocker, AI_DISABLED_BLOCKER);
  });

  it("a BLOCKED reason prints the MEASURED answers, not the expectations (BE-704-204)", () => {
    // The disabled branch returns before the turn-2 comparison, so the measured
    // turn 2 here is deliberately nothing like the case's expectation: a reason built
    // from x.aiTurn2 would read "403 member_deactivated / 401 unauthorized ... session"
    // — an expectation printed as if it had been observed.
    const out = decideRevokeOutcome({
      ...base(),
      aiTurn1: { session: { status: 503, code: "ai_disabled" }, frame: { status: 503, code: "ai_disabled" } },
      aiTurn1Step: { status: "BLOCKED" },
      aiTurn2: { session: { status: 200 }, frame: { status: 200 } },
    });
    assert.equal(out.status, "BLOCKED");
    assert.equal(out.blocker, AI_DISABLED_BLOCKER);
    assert.match(out.reason, /^ai_disabled; t1 s503 ai_disabled\/f503 ai_disabled t2 s200\/f200 /);
    assert.ok(!/t2 s403/.test(out.reason), `the reason printed the expectation: ${out.reason}`);
    // and the record's own redaction (240 chars) must keep every word of it
    assert.equal(redactSignInError(out.reason), out.reason);
  });
});

// ---- the CLI surface -------------------------------------------------------

describe("G7-04 revoke CLI", () => {
  it("a capability-off turn 1 exits 77 and prints the capability it read (D2-02)", async () => {
    const mock = createMockRevokeServer({ aiMode: "capability-off" });
    const { server, origin } = await startMockHttp(mock);
    const scratch = makeScratchRunDir();
    writeFileSync(join(scratch.dir, "ports.env"), `API_ORIGIN=${origin}\nWEB_ORIGIN=${origin}\n`);
    const revokeScript = join(REPO_ROOT, "scripts/office/g5g6g7/g7-04/revoke.mjs");
    try {
      const run = await new Promise((done, fail) => {
        const child = spawn(process.execPath, [revokeScript, "--case", "deactivate", "--fixture", "fx-docx-report-vi", "--run-dir", scratch.dir], { cwd: REPO_ROOT, env: process.env });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
        child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
        child.on("error", fail);
        child.on("close", (status) => done({ status, stdout, stderr }));
      });
      assert.equal(run.status, 77, run.stderr);
      assert.match(run.stderr, /BLOCKED: UniWork AI capability ai_uniwork_docx is off on this deployment: turn 1 refused, the revoke cannot be shown/);
      // BE-704-350: the CLI prints the same compact measured reason the record
      // keeps, so the operator reads the measurements, not a truncated prose
      assert.match(run.stdout, /"reason": "capability_off ai_uniwork_docx; t1 s403 office_capability_off\/f403 office_capability_off t2 s/);
      // the artifact log carries the same blocker and both turns
      const artifact = readFileSync(join(scratch.dir, "logs", "g7-04-revoke-deactivate-fx-docx-report-vi.log"), "utf8");
      assert.match(artifact, /AI turn 1 session 403 office_capability_off\/frame 403 office_capability_off/);
      assert.match(artifact, /expected aiTurn1 200 on both routes/);
      assert.ok(!/tok-/.test(artifact), "the artifact carries a token");
    } finally {
      await new Promise((done) => server.close(done));
      scratch.cleanup();
    }
  });

  it("a turn 1 that answered 200 with content the fake provider cannot be verified from exits 77 and prints the content blocker (BE-704-202)", async () => {
    // Nothing opens the real-upstream guard here (the pin deletes
    // HARNESS_ALLOW_REAL_AI_UPSTREAM), so this is the cloud runner's own shape:
    // a 200 turn 1 whose content is labelled fake, and therefore unverifiable.
    const mock = createMockRevokeServer();
    const { server, origin } = await startMockHttp(mock);
    const scratch = makeScratchRunDir();
    writeFileSync(join(scratch.dir, "ports.env"), `API_ORIGIN=${origin}\nWEB_ORIGIN=${origin}\n`);
    const revokeScript = join(REPO_ROOT, "scripts/office/g5g6g7/g7-04/revoke.mjs");
    try {
      const run = await new Promise((done, fail) => {
        const child = spawn(process.execPath, [revokeScript, "--case", "deactivate", "--fixture", "fx-docx-report-vi", "--run-dir", scratch.dir], { cwd: REPO_ROOT, env: process.env });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
        child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
        child.on("error", fail);
        child.on("close", (status) => done({ status, stdout, stderr }));
      });
      assert.equal(run.status, 77, run.stderr);
      assert.match(run.stderr, /BLOCKED: turn-1 AI content not verifiable under the fake provider \(real-AI round\)/);
      // the artifact shows the revoke assertions held, and names the verdict
      const artifact = readFileSync(join(scratch.dir, "logs", "g7-04-revoke-deactivate-fx-docx-report-vi.log"), "utf8");
      assert.match(artifact, /AI turn 1 session 200\/frame 200/);
      assert.match(artifact, /AI turn 2 session 403 member_deactivated\/frame 401 unauthorized error_class=session; Save upload 403 member_deactivated\/commit 403 member_deactivated/);
      assert.match(artifact, /verdict BLOCKED/);
      assert.ok(!/tok-/.test(artifact), "the artifact carries a token");
    } finally {
      await new Promise((done) => server.close(done));
      scratch.cleanup();
    }
  });
});

// ---- evidence.mjs run + verify ---------------------------------------------

describe("G7-04 evidence.mjs run + verify", () => {
  it("writes one valid evidence line per (case, fixture) for G7-A02 and verify passes", async () => {
    const mock = createMockRevokeServer({ aiMode: "real" });
    const { server, origin } = await startMockHttp(mock);
    const scratch = makeScratchRunDir();
    writeFileSync(join(scratch.dir, "ports.env"), `API_ORIGIN=${origin}\nWEB_ORIGIN=${origin}\n`);
    const outDir = join(scratch.dir, "evidence-out");
    const evidenceScript = join(REPO_ROOT, "scripts/office/g5g6g7/evidence.mjs");
    const revokeScript = join(REPO_ROOT, "scripts/office/g5g6g7/g7-04/revoke.mjs");

    const runCmd = (args, env = process.env) =>
      new Promise((done, fail) => {
        const child = spawn(process.execPath, args, { cwd: REPO_ROOT, env });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
        child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
        child.on("error", fail);
        child.on("close", (status) => done({ status, stdout, stderr }));
      });

    try {
      const cases = [
        { caseName: "deactivate", fixture: "fx-docx-report-vi" },
        { caseName: "remove", fixture: "fx-docx-report-vi" },
        { caseName: "downgrade", fixture: "fx-xlsx-revenue-xyz" },
      ];
      for (const c of cases) {
        const run = await runCmd([
          evidenceScript, "run", "--req", "G7-A02", "--fixture", c.fixture, "--checker", "tester-cloud", "--out", outDir,
          "--", process.execPath, revokeScript, "--case", c.caseName, "--fixture", c.fixture, "--run-dir", scratch.dir,
        ], { ...process.env, OFFICE_FORK_SHA: "0d03b18", HARNESS_ALLOW_REAL_AI_UPSTREAM: "1" });
        assert.equal(run.status, 0, `${c.caseName} exit status (${run.stderr})`);
      }

      const verify = await runCmd([evidenceScript, "verify", "--out", outDir]);
      assert.equal(verify.status, 0, `evidence.mjs verify failed: ${verify.stderr}`);
      assert.match(verify.stdout, /evidence verify: OK \(3 records\)/);

      const lines = readFileSync(join(outDir, "evidence.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      assert.equal(lines.length, 3);
      assert.deepEqual(
        lines.map((l) => ({ req: l.requirementId, fixture: l.fixtureId, result: l.result, exitCode: l.exitCode })),
        [
          { req: "G7-A02", fixture: "fx-docx-report-vi", result: "PASS", exitCode: 0 },
          { req: "G7-A02", fixture: "fx-docx-report-vi", result: "PASS", exitCode: 0 },
          { req: "G7-A02", fixture: "fx-xlsx-revenue-xyz", result: "PASS", exitCode: 0 },
        ],
      );
      for (const line of lines) {
        // the runner records an absolute artifact path when --out is absolute
        const artifact = readFileSync(isAbsolute(line.artifact) ? line.artifact : join(REPO_ROOT, line.artifact), "utf8");
        assert.match(artifact, /versions before/);
        assert.match(artifact, /AI turn 2/);
        assert.ok(!/tok-/.test(artifact), "the artifact carries a token");
      }
    } finally {
      await new Promise((done) => server.close(done));
      scratch.cleanup();
    }
  });

  it("a failing run is recorded FAIL by the runner (exit 1), never PASS", async () => {
    const mock = createMockRevokeServer({ ignoreRevokeOnAiTurn: true });
    const { server, origin } = await startMockHttp(mock);
    const scratch = makeScratchRunDir();
    writeFileSync(join(scratch.dir, "ports.env"), `API_ORIGIN=${origin}\nWEB_ORIGIN=${origin}\n`);
    const outDir = join(scratch.dir, "evidence-out");
    const evidenceScript = join(REPO_ROOT, "scripts/office/g5g6g7/evidence.mjs");
    const revokeScript = join(REPO_ROOT, "scripts/office/g5g6g7/g7-04/revoke.mjs");
    try {
      const run = await new Promise((done, fail) => {
        const child = spawn(process.execPath, [
          evidenceScript, "run", "--req", "G7-A02", "--fixture", "fx-docx-report-vi", "--checker", "tester-cloud", "--out", outDir,
          "--", process.execPath, revokeScript, "--case", "deactivate", "--fixture", "fx-docx-report-vi", "--run-dir", scratch.dir,
        ], { cwd: REPO_ROOT, env: { ...process.env, OFFICE_FORK_SHA: "0d03b18" } });
        let stderr = "";
        child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
        child.on("error", fail);
        child.on("close", (status) => done({ status, stderr }));
      });
      assert.equal(run.status, 1, run.stderr);
      const line = JSON.parse(readFileSync(join(outDir, "evidence.jsonl"), "utf8").trim().split("\n").at(-1));
      assert.equal(line.result, "FAIL");
      assert.equal(line.exitCode, 1);
    } finally {
      await new Promise((done) => server.close(done));
      scratch.cleanup();
    }
  });
});
