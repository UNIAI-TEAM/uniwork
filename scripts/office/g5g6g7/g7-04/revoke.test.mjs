/* global Buffer, URL, Response, FormData, Blob, process, setTimeout */
// Failing-first tests for the G7-04 revoke driver (UNI-1386, G7-A02.1):
// `scripts/office/g5g6g7/g7-04/revoke.mjs` on the same stack the G7-10 tracer
// uses (harness ports.env + an in-memory D server fake, the tracer.test.mjs
// shape). Covers the three revoke cases the Advisor fixed (Addendum A1):
//
//   * `deactivate` (primary): member deactivation, the next AI turn answers
//     403 `member_deactivated` and no version appears;
//   * `downgrade`: the document is `restricted` and the app's own share drops
//     from edit to view, so the AI turn still answers 200 (it needs view only)
//     and the Save/commit answers 403 `forbidden`;
//   * `remove`: workspace-member removal, the next AI turn answers 404
//     `not_found` (a non-member never learns the id exists).
//
// Plus the failure directions the row cares about: a 200 after the revoke is a
// FAIL, a version after the revoke is a FAIL, and a fake deployment answering
// 503 `ai_disabled` on turn 1 is BLOCKED while the revoke assertion still runs.
// The routes are pinned against the Go router (server-contract.helper.mjs), so a
// route rename fails here, not on a cloud VM.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { G8_API_CALLS, G8_CALLS } from "../harness/api-contract.mjs";
import { routeCatalogue, sdiFields } from "../harness/server-contract.helper.mjs";
import {
  AI_DISABLED_BLOCKER,
  CASE_EXPECTATIONS,
  REVOKE_CASES,
  REVOKE_FIXTURES,
  decideRevokeOutcome,
  parseArgs,
  runRevokeCase,
} from "./revoke.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const SHA_DOCX = "5e93b1dd7aefa0f8d816ccb7d5648b8bba4aa23eb5e95dbeddb3f045657c828c";

// ---- the run dir the driver reads (start status + ports.env) ----------------

function makeScratchRunDir({ startState = "up", startReason = "" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "g7-04-revoke-test-"));
  writeFileSync(join(dir, "start-status.json"), `${JSON.stringify({ state: startState, reason: startReason })}\n`);
  writeFileSync(join(dir, "ports.env"), "API_ORIGIN=http://127.0.0.1:1\nWEB_ORIGIN=http://127.0.0.1:2\n");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---- the in-memory D server fake -------------------------------------------

const MEMBER_ID = "01JMEMBER0000000000000001";
const OWNER_ID = "01JOWNER00000000000000001";
const DOC_ID = "01JDOC00000000000000000001";
const WS_ID = "01JWS000000000000000000001";
const ORG_ID = "01JORG00000000000000000001";
const ORG_SLUG = "o-g704";
const V1_ID = "01JVER00000000000000000001";

function sha256Of(bytes) {
  return require("node:crypto").createHash("sha256").update(bytes).digest("hex");
}

/**
 * A fake of the D server routes the revoke driver calls. `revoked` is the state
 * the fake revoke route sets; the AI and save routes answer it the way the Go
 * code does (documentScope needs view only; the save path needs edit).
 * `ignoreRevokeOnAiTurn` / `allowSaveAfterRevoke` are the two mutations the
 * failure tests drive.
 */
function createMockRevokeServer({ aiMode = "fake", ignoreRevokeOnAiTurn = false, allowSaveAfterRevoke = false } = {}) {
  const state = { revoked: null, versions: [], intents: new Map(), uploads: new Map(), calls: [] };

  const fetchImpl = async (urlStr, init = {}) => {
    const url = new URL(urlStr);
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname;
    state.calls.push({ method, path });
    const json = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

    const refuse = (kind) => {
      if (state.revoked === "deactivate") return json(403, { error: { code: "member_deactivated", message: "member deactivated" } });
      if (state.revoked === "remove") return json(404, { error: { code: "not_found", message: "not found" } });
      if (state.revoked === "downgrade" && kind === "save") return json(403, { error: { code: "forbidden", message: "forbidden" } });
      return null;
    };

    if (method === "POST" && path === "/api/v1/auth/register") {
      const body = JSON.parse(init.body);
      const id = body.email.includes("owner") ? OWNER_ID : MEMBER_ID;
      return json(201, { access_token: `tok-${id}`, user: { id, email: body.email } });
    }
    if (method === "POST" && path === "/api/v1/me/email/verify") return json(200, { verified: true });
    if (method === "POST" && path === "/api/v1/orgs") return json(201, { organization: { id: ORG_ID, slug: ORG_SLUG } });
    if (method === "POST" && path === `/api/v1/orgs/${ORG_ID}/workspaces`) return json(201, { workspace: { id: WS_ID, slug: "w-g704" } });
    if (method === "POST" && path === "/api/v1/me/onboarding/complete") return json(200, { user: { id: OWNER_ID } });
    if (method === "POST" && path === `/api/v1/workspaces/${WS_ID}/invitations`) return json(201, { invitations: [] });
    if (method === "GET" && path === "/api/v1/me/invitations") return json(200, { invitations: [{ token: "inv-1", workspace: { id: WS_ID } }] });
    if (method === "POST" && path === "/api/v1/invitations/inv-1/accept") return json(200, { membership: { workspace_id: WS_ID } });
    if (method === "POST" && path === `/api/v1/workspaces/${WS_ID}/documents/files`) {
      const file = init.body.get("file");
      const bytes = Buffer.from(await file.arrayBuffer());
      state.versions = [{ id: V1_ID, version: 1, revision: "1", checksum_sha256: sha256Of(bytes), size_bytes: bytes.length, bytes }];
      return json(201, { document: { id: DOC_ID, workspace_id: WS_ID, organization_id: ORG_ID, revision: "1", current_version: 1, file: { version_id: V1_ID } } });
    }
    if (method === "POST" && path === `/api/v1/documents/${DOC_ID}/shares`) {
      state.shareLevel = JSON.parse(init.body).level;
      return json(201, { share: { id: "01JSHARE000000000000000001", level: state.shareLevel } });
    }
    if (method === "PATCH" && path === `/api/v1/documents/${DOC_ID}`) {
      state.visibility = JSON.parse(init.body).visibility;
      return json(200, { document: { id: DOC_ID, visibility: state.visibility } });
    }
    if (method === "POST" && path === `/api/v1/documents/${DOC_ID}/office/frame-token`) {
      return json(201, { token: "tok-frame", can_edit: true, module: "docs" });
    }
    if (
      method === "POST" &&
      (path === `/api/v1/documents/${DOC_ID}/ai/uniwork/chat/completions` || path === `/api/v1/office-frame/documents/${DOC_ID}/ai/uniwork/chat/completions`)
    ) {
      if (aiMode === "disabled") return json(503, { error: { code: "ai_disabled", message: "AI chua duoc cau hinh tren server" } });
      if (state.revoked && !ignoreRevokeOnAiTurn) {
        const refused = refuse("ai");
        if (refused) return refused;
      }
      return json(200, { id: "chatcmpl-test", model: "fake-stub", provider: "fake", choices: [{ index: 0, message: { role: "assistant", content: "[fake provider] stub" }, finish_reason: "stop" }] });
    }
    if (method === "GET" && path === `/api/v1/documents/${DOC_ID}/versions`) {
      return json(200, { versions: state.versions.map((v) => ({ id: v.id, version: v.version, checksum_sha256: v.checksum_sha256, size_bytes: v.size_bytes })) });
    }
    if (method === "POST" && path === `/api/v1/documents/${DOC_ID}/uploads`) {
      if (state.revoked) {
        const refused = refuse("save");
        if (refused) return refused;
      }
      const file = init.body.get("file");
      const bytes = Buffer.from(await file.arrayBuffer());
      const uploadId = `01JUPL0000000000000000000${state.uploads.size + 1}`;
      state.uploads.set(uploadId, { checksum_sha256: sha256Of(bytes), size_bytes: bytes.length, bytes });
      return json(201, { upload_id: uploadId, checksum_sha256: sha256Of(bytes), size_bytes: bytes.length });
    }
    if (method === "POST" && path === `/api/v1/documents/${DOC_ID}/versions/commit`) {
      const key = init.headers?.["Idempotency-Key"] ?? init.headers?.["idempotency-key"] ?? "";
      if (state.revoked && !allowSaveAfterRevoke) {
        const refused = refuse("save");
        if (refused) return refused;
      }
      const upload = state.uploads.get(JSON.parse(init.body).upload_id);
      const next = { id: `01JVER0000000000000000000${state.versions.length + 1}`, version: state.versions.length + 1, revision: String(state.versions.length + 1), checksum_sha256: upload.checksum_sha256, size_bytes: upload.size_bytes, bytes: upload.bytes };
      state.versions.push(next);
      if (key) state.intents.set(key, { state: "committed", version: next });
      return json(200, { document: { id: DOC_ID, revision: next.revision, current_version: next.version }, version: { id: next.id, version: next.version, checksum_sha256: next.checksum_sha256, size_bytes: next.size_bytes } });
    }
    if (method === "GET" && path === `/api/v1/documents/${DOC_ID}/versions/commit`) {
      const key = init.headers?.["Idempotency-Key"] ?? init.headers?.["idempotency-key"] ?? "";
      const entry = state.intents.get(key);
      if (entry) return json(200, { outcome: "committed", version_id: entry.version.id, version: entry.version.version, revision: Number(entry.version.revision) });
      return json(410, { error: { code: "commit_intent_unknown", message: "unknown", fields: { outcome: "unknown" } } });
    }
    if (method === "POST" && path === `/api/v1/orgs/${ORG_SLUG}/members/${MEMBER_ID}/deactivate`) {
      state.revoked = "deactivate";
      return json(200, { member: { user_id: MEMBER_ID, deactivated_at: "2026-10-16T00:00:00Z" } });
    }
    if (method === "DELETE" && path === `/api/v1/workspaces/${WS_ID}/members/${MEMBER_ID}`) {
      state.revoked = "remove";
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && path === `/api/v1/orgs/${ORG_ID}/privacy/deletion`) return json(202, { status: "scheduled" });
    if (method === "POST" && path === "/api/v1/me/delete") return json(200, { deleted: true });
    return json(404, { error: { code: "not_found", path } });
  };

  return { state, fetchImpl };
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
      const mock = createMockRevokeServer();
      const scratch = makeScratchRunDir();
      try {
        const res = await runRevokeCase({ apiOrigin: "http://127.0.0.1:1", fetchImpl: mock.fetchImpl, runDir: scratch.dir, fixtureId: "fx-docx-report-vi", caseName, repoRoot: REPO_ROOT });
        assert.equal(res.status, "PASS", res.reason);
        assert.equal(res.exitCode, 0);
        assert.equal(res.versionCounts.versionsBefore, 1);
        assert.equal(res.versionCounts.versionsAfterRevoke, 1);
        assert.equal(res.details.commitIntent.hasCommitted, false);
        assert.equal(res.details.aiTurn2.session.status, CASE_EXPECTATIONS[caseName].aiTurn2);
        assert.equal(res.details.aiTurn2.frame.status, CASE_EXPECTATIONS[caseName].aiTurn2);
        assert.equal(res.details.save.commit.status, CASE_EXPECTATIONS[caseName].saveCommit);
      } finally {
        scratch.cleanup();
      }
    });
  }

  it("deactivate records the 403 member_deactivated the Go gates answer", async () => {
    const mock = createMockRevokeServer();
    const scratch = makeScratchRunDir();
    try {
      const res = await runRevokeCase({ apiOrigin: "http://127.0.0.1:1", fetchImpl: mock.fetchImpl, runDir: scratch.dir, fixtureId: "fx-docx-report-vi", caseName: "deactivate", repoRoot: REPO_ROOT });
      assert.equal(res.details.aiTurn2.session.status, 403);
      assert.equal(res.details.aiTurn2.session.code, "member_deactivated");
      assert.equal(res.details.save.commit.status, 403);
      assert.equal(res.details.save.commit.code, "member_deactivated");
    } finally {
      scratch.cleanup();
    }
  });

  it("remove records the 404 not_found a non-member gets by design", async () => {
    const mock = createMockRevokeServer();
    const scratch = makeScratchRunDir();
    try {
      const res = await runRevokeCase({ apiOrigin: "http://127.0.0.1:1", fetchImpl: mock.fetchImpl, runDir: scratch.dir, fixtureId: "fx-docx-report-vi", caseName: "remove", repoRoot: REPO_ROOT });
      assert.equal(res.details.aiTurn2.session.status, 404);
      assert.equal(res.details.aiTurn2.session.code, "not_found");
    } finally {
      scratch.cleanup();
    }
  });

  it("downgrade asserts what the code does: the AI turn still answers 200 (view is enough) and the Save is refused 403 forbidden", async () => {
    const mock = createMockRevokeServer();
    const scratch = makeScratchRunDir();
    try {
      const res = await runRevokeCase({ apiOrigin: "http://127.0.0.1:1", fetchImpl: mock.fetchImpl, runDir: scratch.dir, fixtureId: "fx-xlsx-revenue-xyz", caseName: "downgrade", repoRoot: REPO_ROOT });
      assert.equal(res.status, "PASS", res.reason);
      assert.equal(res.details.aiTurn2.session.status, 200);
      assert.equal(res.details.aiTurn2.frame.status, 200);
      assert.equal(res.details.save.commit.status, 403);
      assert.equal(res.details.save.commit.code, "forbidden");
      assert.equal(res.versionCounts.versionsAfterRevoke, 1);
      assert.equal(res.details.prepared.restricted, true);
      assert.equal(res.details.prepared.shareLevel, "view");
    } finally {
      scratch.cleanup();
    }
  });

  it("a 200 after the revoke is a FAIL (exit 1), never a PASS", async () => {
    const mock = createMockRevokeServer({ ignoreRevokeOnAiTurn: true });
    const scratch = makeScratchRunDir();
    try {
      const res = await runRevokeCase({ apiOrigin: "http://127.0.0.1:1", fetchImpl: mock.fetchImpl, runDir: scratch.dir, fixtureId: "fx-docx-report-vi", caseName: "deactivate", repoRoot: REPO_ROOT });
      assert.equal(res.status, "FAIL");
      assert.equal(res.exitCode, 1);
      assert.match(res.reason, /AI turn 2|200/);
    } finally {
      scratch.cleanup();
    }
  });

  it("a version after the revoke is a FAIL (exit 1)", async () => {
    const mock = createMockRevokeServer({ ignoreRevokeOnAiTurn: true, allowSaveAfterRevoke: true });
    const scratch = makeScratchRunDir();
    try {
      const res = await runRevokeCase({ apiOrigin: "http://127.0.0.1:1", fetchImpl: mock.fetchImpl, runDir: scratch.dir, fixtureId: "fx-docx-report-vi", caseName: "remove", repoRoot: REPO_ROOT });
      assert.equal(res.status, "FAIL");
      assert.equal(res.exitCode, 1);
      assert.match(res.reason, /version/i);
      assert.equal(res.versionCounts.versionsAfterRevoke, 2);
    } finally {
      scratch.cleanup();
    }
  });

  it("a fake deployment answering 503 ai_disabled on turn 1 is BLOCKED (exit 77) while the revoke assertion still runs", async () => {
    const mock = createMockRevokeServer({ aiMode: "disabled" });
    const scratch = makeScratchRunDir();
    try {
      const res = await runRevokeCase({ apiOrigin: "http://127.0.0.1:1", fetchImpl: mock.fetchImpl, runDir: scratch.dir, fixtureId: "fx-docx-report-vi", caseName: "deactivate", repoRoot: REPO_ROOT });
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

  it("a start.sh that failed is a FAIL (exit 1), and a blocked one is BLOCKED (77)", async () => {
    const failed = makeScratchRunDir({ startState: "failed", startReason: "server build failed" });
    const blocked = makeScratchRunDir({ startState: "blocked", startReason: "missing xvfb" });
    try {
      const mock = createMockRevokeServer();
      const f = await runRevokeCase({ apiOrigin: "http://127.0.0.1:1", fetchImpl: mock.fetchImpl, runDir: failed.dir, fixtureId: "fx-docx-report-vi", caseName: "deactivate", repoRoot: REPO_ROOT });
      assert.equal(f.exitCode, 1);
      assert.match(f.reason, /server build failed/);
      const b = await runRevokeCase({ apiOrigin: "http://127.0.0.1:1", fetchImpl: mock.fetchImpl, runDir: blocked.dir, fixtureId: "fx-docx-report-vi", caseName: "deactivate", repoRoot: REPO_ROOT });
      assert.equal(b.exitCode, 77);
      assert.match(b.reason, /missing xvfb/);
    } finally {
      failed.cleanup();
      blocked.cleanup();
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
    aiTurn2: { session: { status: 403, code: "member_deactivated" }, frame: { status: 403, code: "member_deactivated" } },
    revoke: { status: 200 },
    save: { upload: { status: 403 }, commit: { status: 403 } },
    commitIntent: { httpStatus: 410, outcome: "unknown", hasCommitted: false },
  });

  it("PASSes the clean record", () => {
    assert.equal(decideRevokeOutcome(base()).status, "PASS");
  });

  it("FAILs a version delta, a committed intent, a wrong AI status and a wrong save status", () => {
    assert.equal(decideRevokeOutcome({ ...base(), versionsAfterRevoke: 2 }).status, "FAIL");
    assert.equal(decideRevokeOutcome({ ...base(), commitIntent: { hasCommitted: true } }).status, "FAIL");
    assert.equal(decideRevokeOutcome({ ...base(), aiTurn2: { session: { status: 200 }, frame: { status: 403 } } }).status, "FAIL");
    assert.equal(decideRevokeOutcome({ ...base(), save: { upload: { status: 201 }, commit: { status: 200 } } }).status, "FAIL");
  });

  it("BLOCKs on a 503 ai_disabled turn 1 only after every revoke assertion passed", () => {
    const disabled = { ...base(), aiTurn1: { session: { status: 503, code: "ai_disabled" }, frame: { status: 503, code: "ai_disabled" } } };
    assert.equal(decideRevokeOutcome(disabled).status, "BLOCKED");
    assert.equal(decideRevokeOutcome(disabled).exitCode, 77);
    // a broken revoke assertion still wins over the BLOCKED
    assert.equal(decideRevokeOutcome({ ...disabled, versionsAfterRevoke: 2 }).status, "FAIL");
  });
});

// ---- evidence.mjs run + verify ---------------------------------------------

describe("G7-04 evidence.mjs run + verify", () => {
  it("writes one valid evidence line per (case, fixture) for G7-A02 and verify passes", async () => {
    const mock = createMockRevokeServer();
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
        ], { ...process.env, OFFICE_FORK_SHA: "0d03b18" });
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
        const artifact = readFileSync(join(REPO_ROOT, line.artifact), "utf8");
        assert.match(artifact, /versions before/);
        assert.match(artifact, /AI turn 2/);
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