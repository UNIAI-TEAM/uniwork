#!/usr/bin/env node
/* global fetch, AbortSignal, FormData, Blob, process, console, Buffer, URL, URLSearchParams, setTimeout */
// G7-04 revoke driver (UNI-1386, card G7-04, row G7-A02.1): a revocation between
// two UniWork AI turns on the same document, on both hosts of the harness stack
// (the desktop session route and the web frame token), must refuse the next AI
// turn, refuse the revoked user's Save, leave the version count unchanged and
// leave no committed commit intent.
//
// The three revoke cases (Advisor Addendum A1, `--case deactivate|downgrade|remove|all`):
//
//   * `deactivate` (primary): POST /api/v1/orgs/{org}/members/{userID}/deactivate
//     (router/organizations.go:89 -> handler organization_members.go deactivateOrgMember
//     -> OrganizationMemberService.Deactivate). The deactivated member is refused at
//     the organization gate with 403 `member_deactivated`
//     (service/organization.go RequireMemberQ, service/errors.go:55), and
//     documentScope reads that gate first (service/ai_uniwork.go:382-421) — so the
//     next AI turn on EITHER route is 403 `member_deactivated`, and the Save path
//     (decideDocumentAccess, service/document_permissions.go:290-301) is refused too.
//
//   * `downgrade`: the document is set `restricted` and the app's own share goes
//     edit -> view (PATCH /documents/{id} visibility=restricted + POST
//     /documents/{id}/shares level=view, the qa-fault FQ-50 path, matrix.md FQ-50).
//     The AI turn only needs View (frameAIActor rechecks view,
//     handler/office_frame_ai.go:26-36; the session route's documentScope asks for
//     DocumentLevelView, service/ai_uniwork.go:391), so the next AI turn still
//     answers 200. What the downgrade refuses is the SAVE: the upload/commit path
//     asks for DocumentLevelEdit (service/document_files.go:134,
//     service/document_commit.go commitFileVersion) and answers 403 `forbidden`
//     (decideDocumentAccess). The driver asserts exactly that and records it, and
//     never invents a 403 on the AI turn.
//
//   * `remove`: DELETE /api/v1/workspaces/{ws}/members/{user} (router/workspaces.go:65
//     -> handler/workspace.go deleteMember -> WorkspaceService.RemoveMember). A
//     non-member holds no level, so nothing readable is 404 `not_found` by design
//     (service/document_permissions.go decideDocumentAccess, the product rule a
//     non-member never learns an id exists) — as in qa-fault FQ-12.
//
// Hard rules (spec "Build"):
//   * A 200 on the next AI turn after the revoke, or any new version, is a FAIL,
//     never a PASS.
//   * Under `AI_PROVIDER=fake` the turn-1 CONTENT claim is BLOCKED
//     (exit 77, `no real upstream on this runner; contract-p0 §8`), but the revoke
//     assertion still runs and its verdict wins over the BLOCKED.
//   * Every HTTP status and version count lands in the artifact log.
//
// G7-A02.2 (a late AI result not applied to a newer base) belongs to G7-03a
// (FQ-28/29/32) and is deliberately NOT implemented here; the README section
// records the cross-reference.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ApiError, G8_API_CALLS, apiPath } from "../harness/api-contract.mjs";
import { redactSignInError } from "../harness/app-steps.mjs";
import { loadVerifiedFixture } from "../harness/fixture-files.mjs";
import { BLOCKED_EXIT, harnessPaths, readStartStatus, startGate } from "../harness/lib.mjs";
import { classifyAiResponse, interpretCommitIntentLookup } from "../g7-10/tracer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, "../../../..");

/** The two fixtures the row names (acceptance-rows.json G7-A02). */
export const REVOKE_FIXTURES = Object.freeze(["fx-docx-report-vi", "fx-xlsx-revenue-xyz"]);
/** The three revoke cases, in the order the Advisor fixed them (Addendum A1). */
export const REVOKE_CASES = Object.freeze(["deactivate", "downgrade", "remove"]);

/**
 * The status each case makes the two hosts answer, and what the Save answers.
 * `aiTurn2` is what the server really does, read from the Go code (see the file
 * header): a closed tenant is 403 on every route; a downgrade to view leaves the
 * AI turn (view) working and refuses the Save (edit).
 */
export const CASE_EXPECTATIONS = Object.freeze({
  deactivate: { revoke: 200, aiTurn2: 403, aiTurn2Code: "member_deactivated", saveUpload: 403, saveCommit: 403, saveCommitCode: "member_deactivated" },
  downgrade: { revoke: 200, aiTurn2: 200, aiTurn2Code: "", saveUpload: 403, saveCommit: 403, saveCommitCode: "forbidden" },
  // RemoveMember answers 204 on success (handler/workspace.go deleteMember); the 404
  // is what the removed member's own next calls answer, by design.
  remove: { revoke: 204, aiTurn2: 404, aiTurn2Code: "not_found", saveUpload: 404, saveCommit: 404, saveCommitCode: "not_found" },
});

/** BLOCKED reason under a fake deployment (contract-p0 §8). */
export const AI_DISABLED_BLOCKER = "no real upstream on this runner; contract-p0 §8";
export const AI_DISABLED_OWNER = "g7-qa";
export const REVOKE_OWNER = "g7-qa";

const AI_TURN_2_PROMPT = "Tiếp tục sau khi quyền bị thu hồi.";
const AI_TURN_1_PROMPT = "Mở đầu bản nháp cho tài liệu này.";

/** `--fixture <id|all> --case <name|all> --run-dir <dir> --dry-run`. */
export function parseArgs(argv, env = process.env) {
  const out = { fixtures: [...REVOKE_FIXTURES], cases: [...REVOKE_CASES], runDir: env.HARNESS_RUN_DIR || resolve(DEFAULT_REPO_ROOT, ".harness-run"), dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === "--fixture") {
      const raw = next();
      if (raw === "all") out.fixtures = [...REVOKE_FIXTURES];
      else if (REVOKE_FIXTURES.includes(raw)) out.fixtures = [raw];
      else throw new Error(`unknown --fixture "${raw}" (expected ${REVOKE_FIXTURES.join("|")}|all)`);
    } else if (arg === "--case") {
      const raw = next();
      if (raw === "all") out.cases = [...REVOKE_CASES];
      else if (REVOKE_CASES.includes(raw)) out.cases = [raw];
      else throw new Error(`unknown --case "${raw}" (expected ${REVOKE_CASES.join("|")}|all)`);
    } else if (arg === "--run-dir") {
      out.runDir = resolve(next());
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "-h" || arg === "--help") {
      out.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return out;
}

/** The error code a refused answer carries (`error.code`), or "". */
export function errorCodeOf(res) {
  const code = res?.body?.error?.code ?? res?.data?.error?.code ?? "";
  return typeof code === "string" ? code : "";
}

function safe(text) {
  return redactSignInError(String(text ?? ""));
}

/**
 * The pure verdict of one case. Hard rules first: a new version, a committed
 * intent or a wrong status is a FAIL. Only when every revoke assertion passed may
 * a 503 `ai_disabled` on turn 1 (fake deployment) downgrade the result to BLOCKED.
 */
export function decideRevokeOutcome({
  caseName,
  expectations,
  versionsBefore,
  versionsAfterRevoke,
  aiTurn1,
  aiTurn2,
  revoke,
  save,
  commitIntent,
  aiDisabled = null,
}) {
  const x = expectations;
  // Under a fake deployment the turn-1 CONTENT claim cannot be proven; the turn
  // answers 503 `ai_disabled` (contract-p0 §8). Derived from the turn itself so a
  // caller cannot forget to pass the flag.
  const turn1Disabled =
    aiDisabled ?? (aiTurn1?.session?.status === 503 && aiTurn1?.session?.code === "ai_disabled");
  if (versionsAfterRevoke !== versionsBefore) {
    return { status: "FAIL", exitCode: 1, owner: REVOKE_OWNER, reason: `G7-A02 violation: version count changed across the revoke (${versionsBefore} -> ${versionsAfterRevoke})` };
  }
  if (commitIntent?.hasCommitted) {
    return { status: "FAIL", exitCode: 1, owner: REVOKE_OWNER, reason: `G7-A02 violation: a commit intent is committed after the revoke (${commitIntent.outcome})` };
  }
  if (aiTurn2?.session?.status !== x.aiTurn2 || aiTurn2?.frame?.status !== x.aiTurn2) {
    return {
      status: "FAIL",
      exitCode: 1,
      owner: REVOKE_OWNER,
      reason: `G7-A02 violation: AI turn 2 after the ${caseName} revoke answered session=${aiTurn2?.session?.status ?? "none"} frame=${aiTurn2?.frame?.status ?? "none"}, want ${x.aiTurn2} on both routes`,
    };
  }
  if (x.aiTurn2Code && (aiTurn2.session.code !== x.aiTurn2Code || aiTurn2.frame.code !== x.aiTurn2Code)) {
    return {
      status: "FAIL",
      exitCode: 1,
      owner: REVOKE_OWNER,
      reason: `G7-A02 violation: AI turn 2 answered the wrong code (session=${aiTurn2.session.code || "none"} frame=${aiTurn2.frame.code || "none"}), want ${x.aiTurn2Code}`,
    };
  }
  if (save?.upload?.status !== x.saveUpload || save?.commit?.status !== x.saveCommit) {
    return {
      status: "FAIL",
      exitCode: 1,
      owner: REVOKE_OWNER,
      reason: `G7-A02 violation: the revoked user's Save was not refused (upload=${save?.upload?.status ?? "none"} commit=${save?.commit?.status ?? "none"}), want ${x.saveUpload}/${x.saveCommit}`,
    };
  }
  if (revoke?.status !== x.revoke) {
    return { status: "FAIL", exitCode: 1, owner: REVOKE_OWNER, reason: `the ${caseName} revoke answered ${revoke?.status ?? "nothing"}, want ${x.revoke}` };
  }
  if (turn1Disabled) {
    return { status: "BLOCKED", exitCode: BLOCKED_EXIT, owner: AI_DISABLED_OWNER, blocker: AI_DISABLED_BLOCKER, reason: `${AI_DISABLED_BLOCKER}; the revoke assertion ran (versions ${versionsBefore} -> ${versionsAfterRevoke}, AI turn 2 ${x.aiTurn2}, Save refused ${x.saveCommit})` };
  }
  return { status: "PASS", exitCode: 0, reason: `${caseName}: revoke refused the next AI turn (${x.aiTurn2}${x.aiTurn2Code ? ` ${x.aiTurn2Code}` : ""}), the Save (${x.saveCommit}${x.saveCommitCode ? ` ${x.saveCommitCode}` : ""}) and left versions at ${versionsAfterRevoke}` };
}

// ---- transport -------------------------------------------------------------

/** One call through the shared table; a 4xx/5xx is an answer, a transport failure throws an ApiError. */
async function call({ apiOrigin, fetchImpl = fetch, name, params = {}, token, headers = {}, body, form, allowStatuses = [] }) {
  const spec = G8_API_CALLS[name];
  if (!spec) throw new Error(`unknown API call ${name}`);
  const path = apiPath(name, params, G8_API_CALLS);
  const requestHeaders = { ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined) requestHeaders["content-type"] = "application/json";
  const res = await fetchImpl(`${apiOrigin}${path}`, {
    method: spec.method,
    headers: requestHeaders,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok && !allowStatuses.includes(res.status)) {
    throw new ApiError({ method: spec.method, path, status: res.status, bodyText: text });
  }
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { rawText: text };
  }
  return { status: res.status, ok: res.ok, body: parsed };
}

// ---- the world: an owner, an editor member, one document --------------------

/**
 * Seeds the owner (the admin who revokes) and the editor member (the second user
 * whose access is revoked), an organization and a workspace, and uploads the
 * fixture as a file document owned by the owner but edited by the member.
 * Nothing here prints or returns a password: the member's is held for cleanup
 * only, in memory.
 */
async function seedRevokeWorld({ apiOrigin, fetchImpl, fixtureId, repoRoot, runDir, now = Date.now() }) {
  const cachePath = join(runDir, "g7-04-revoke-world.json");
  const stamp = `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const password = `g704-${Math.random().toString(36).slice(2, 12)}`;

  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8"));
      if (cached.apiOrigin === apiOrigin && cached.owner?.token && cached.member?.token && cached.workspaceId) {
        const fixture = loadVerifiedFixture(fixtureId, repoRoot);
        const form = new FormData();
        form.append("file", new Blob([fixture.bytes]), basename(fixture.entry.path));
        form.append("title", basename(fixture.entry.path));
        const doc = await call({ apiOrigin, fetchImpl, name: "createFileDocument", params: { workspaceID: cached.workspaceId }, token: cached.owner.token, form });
        return { ...cached, documentId: doc.body.document.id, revision: String(doc.body.document.revision ?? "1"), password, fixture };
      }
    } catch {
      // a stale cache (another server, expired tokens) seeds a fresh world below
    }
  }

  const register = async (tag) => {
    const email = `g7-04-${tag}-${stamp}@example.com`;
    const res = await call({ apiOrigin, fetchImpl, name: "register", body: { email, password, display_name: `G7-04 ${tag}` } });
    const token = res.body.access_token;
    const userId = res.body.user?.id ?? "";
    await call({ apiOrigin, fetchImpl, name: "verifyEmail", token, body: { code: "123456" } });
    return { email, token, userId };
  };

  const owner = await register("owner");
  const member = await register("member");
  const org = (await call({ apiOrigin, fetchImpl, name: "createOrganization", token: owner.token, body: { name: "G7-04 org", slug: `o-g704-${stamp}` } })).body.organization;
  const ws = (await call({ apiOrigin, fetchImpl, name: "createWorkspace", params: { org: org.id }, token: owner.token, body: { name: "G7-04 ws", slug: `w-g704-${stamp}` } })).body.workspace;
  await call({ apiOrigin, fetchImpl, name: "completeOnboarding", token: owner.token, body: { completion_path: "full", workspace_id: ws.id } });

  await call({ apiOrigin, fetchImpl, name: "createInvitation", params: { workspaceID: ws.id }, token: owner.token, body: { email: member.email, role: "member" } });
  const pending = (await call({ apiOrigin, fetchImpl, name: "myInvitations", token: member.token })).body.invitations ?? [];
  const invitation = pending.find((i) => i.workspace?.id === ws.id) ?? pending[0];
  if (!invitation?.token) throw new Error("seed: the member has no pending invitation");
  await call({ apiOrigin, fetchImpl, name: "acceptInvitation", params: { token: invitation.token }, token: member.token });
  await call({ apiOrigin, fetchImpl, name: "completeOnboarding", token: member.token, body: { completion_path: "invite_accept", workspace_id: ws.id } });

  const fixture = loadVerifiedFixture(fixtureId, repoRoot);
  const form = new FormData();
  form.append("file", new Blob([fixture.bytes]), basename(fixture.entry.path));
  form.append("title", basename(fixture.entry.path));
  const doc = await call({ apiOrigin, fetchImpl, name: "createFileDocument", params: { workspaceID: ws.id }, token: owner.token, form });

  const world = {
    apiOrigin,
    owner,
    member,
    organizationId: org.id,
    organizationSlug: org.slug ?? `o-g704-${stamp}`,
    workspaceId: ws.id,
    documentId: doc.body.document.id,
    revision: String(doc.body.document.revision ?? "1"),
    password,
    fixture,
  };
  mkdirSync(runDir, { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify({ ...world, password: undefined }, null, 2)}\n`);
  return world;
}

/** Uploads the fixture again as the candidate v2 bytes of a Save (never printed). */
async function v2BytesOf(fixture) {
  const form = new FormData();
  form.append("file", new Blob([fixture.bytes]), basename(fixture.entry.path));
  return form;
}

// ---- the per-case steps ----------------------------------------------------

async function versionsCount({ apiOrigin, fetchImpl, world }) {
  const res = await call({ apiOrigin, fetchImpl, name: "listDocumentVersions", params: { documentID: world.documentId }, token: world.member.token });
  return (res.body?.versions ?? []).length;
}

/** One AI turn on both hosts, with the code the answer carries. */
async function aiTurnOnBothRoutes({ apiOrigin, fetchImpl, world, frameToken, prompt }) {
  const session = await call({
    apiOrigin, fetchImpl, name: "aiUniworkDocumentChatCompletions", params: { documentID: world.documentId }, token: world.member.token,
    body: { messages: [{ role: "user", content: prompt }] }, allowStatuses: [400, 403, 404, 409, 429, 503],
  });
  const frame = await call({
    apiOrigin, fetchImpl, name: "aiUniworkFrameChatCompletions", params: { documentID: world.documentId }, token: frameToken,
    body: { messages: [{ role: "user", content: prompt }] }, allowStatuses: [400, 403, 404, 409, 429, 503],
  });
  return {
    session: { status: session.status, code: errorCodeOf(session), raw: { ok: session.ok, status: session.status, data: session.body } },
    frame: { status: frame.status, code: errorCodeOf(frame), raw: { ok: frame.ok, status: frame.status, data: frame.body } },
  };
}

/** The member's Save attempt: stage the bytes, then commit on the head revision. */
async function saveAttempt({ apiOrigin, fetchImpl, world, key }) {
  let upload;
  try {
    upload = await call({ apiOrigin, fetchImpl, name: "uploadDocumentFile", params: { documentID: world.documentId }, token: world.member.token, form: await v2BytesOf(world.fixture), headers: { "Idempotency-Key": `${key}-up` }, allowStatuses: [400, 403, 404, 409, 422] });
  } catch (error) {
    upload = { status: error.status ?? 0, body: { error: { code: "transport_error" } } };
  }
  let commit;
  try {
    commit = await call({
      apiOrigin, fetchImpl, name: "commitDocumentVersion", params: { documentID: world.documentId }, token: world.member.token,
      headers: { "Idempotency-Key": key }, body: { upload_id: upload.body?.upload_id ?? "none", base_revision: world.revision },
      allowStatuses: [400, 403, 404, 409, 422],
    });
  } catch (error) {
    commit = { status: error.status ?? 0, body: { error: { code: "transport_error" } } };
  }
  return { upload: { status: upload.status, code: errorCodeOf(upload) }, commit: { status: commit.status, code: errorCodeOf(commit) } };
}

/** Applies the revoke of one case; the returned status is what the admin route answered. */
async function applyRevoke({ apiOrigin, fetchImpl, world, caseName, fetchImpl2 }) {
  if (caseName === "deactivate") {
    const res = await call({ apiOrigin, fetchImpl: fetchImpl2 ?? fetchImpl, name: "deactivateOrgMember", params: { org: world.organizationSlug, userID: world.member.userId }, token: world.owner.token, allowStatuses: [400, 403, 404] });
    return { status: res.status, code: errorCodeOf(res), via: `POST ${apiPath("deactivateOrgMember", { org: world.organizationSlug, userID: world.member.userId }, G8_API_CALLS)}` };
  }
  if (caseName === "remove") {
    const res = await call({ apiOrigin, fetchImpl, name: "removeWorkspaceMember", params: { workspaceID: world.workspaceId, userID: world.member.userId }, token: world.owner.token, allowStatuses: [400, 403, 404] });
    return { status: res.status, code: errorCodeOf(res), via: `DELETE ${apiPath("removeWorkspaceMember", { workspaceID: world.workspaceId, userID: world.member.userId }, G8_API_CALLS)}` };
  }
  // downgrade: the document goes restricted and the member's own share drops to view
  const restricted = await call({ apiOrigin, fetchImpl, name: "patchDocument", params: { documentID: world.documentId }, token: world.owner.token, body: { revision: world.revision, visibility: "restricted" } });
  const share = await call({ apiOrigin, fetchImpl, name: "createDocumentShare", params: { documentID: world.documentId }, token: world.owner.token, body: { principal_type: "user", principal_id: world.member.userId, level: "view" } });
  return { status: restricted.status, code: "", via: `PATCH ${apiPath("patchDocument", { documentID: world.documentId }, G8_API_CALLS)} visibility=restricted + share level=view`, shareLevel: share.body?.share?.level ?? "view" };
}

/**
 * One (case, fixture) run. `runDir` supplies start.sh's status and ports.env; the
 * apiOrigin may be injected (tests) or read from ports.env (the real stack).
 */
export async function runRevokeCase({
  apiOrigin,
  fetchImpl = fetch,
  runDir,
  fixtureId,
  caseName,
  repoRoot = DEFAULT_REPO_ROOT,
  log = null,
}) {
  const steps = {};
  const startedAt = new Date().toISOString();
  const finish = (outcome) => ({
    caseName,
    fixtureId,
    status: outcome.status,
    exitCode: outcome.exitCode,
    reason: safe(outcome.reason ?? ""),
    blocker: safe(outcome.blocker ?? ""),
    owner: outcome.owner ?? "",
    steps,
    details: { ...(outcome.details ?? {}), revokeRoute: steps.revoke?.route ?? "" },
    versionCounts: outcome.versionCounts ?? {},
    startedAt,
    finishedAt: new Date().toISOString(),
  });

  const gate = startGate(readStartStatus(runDir));
  if (gate.gate !== "proceed") {
    steps.start = { status: gate.gate === "blocked" ? "BLOCKED" : "FAIL", reason: gate.reason };
    return finish(gate.gate === "blocked"
      ? { status: "BLOCKED", exitCode: BLOCKED_EXIT, reason: gate.reason, blocker: gate.reason, owner: REVOKE_OWNER }
      : { status: "FAIL", exitCode: 1, reason: gate.reason, owner: REVOKE_OWNER });
  }

  const expectations = CASE_EXPECTATIONS[caseName];
  if (!expectations) {
    steps.args = { status: "FAIL", reason: `unknown case ${caseName}` };
    return finish({ status: "FAIL", exitCode: 1, reason: `unknown case ${caseName}`, owner: REVOKE_OWNER });
  }

  let world = null;
  let frameToken = "";
  const key = `g7-04-revoke-${caseName}-${Date.now()}`;
  try {
    const seeded = await seedRevokeWorld({ apiOrigin, fetchImpl, fixtureId, repoRoot, runDir });
    world = seeded;
    steps.seed = { status: "PASS", documentId: world.documentId, workspaceId: world.workspaceId, memberId: world.member.userId };

    const before = await versionsCount({ apiOrigin, fetchImpl, world });
    steps.versionsBefore = { status: "PASS", count: before };

    // The web host opens through a frame token the member mints.
    const minted = await call({ apiOrigin, fetchImpl, name: "mintOfficeFrameToken", params: { documentID: world.documentId }, token: world.member.token });
    frameToken = minted.body?.token ?? "";
    steps.frameOpen = { status: frameToken ? "PASS" : "FAIL", canEdit: minted.body?.can_edit ?? null };

    const aiTurn1 = await aiTurnOnBothRoutes({ apiOrigin, fetchImpl, world, frameToken, prompt: AI_TURN_1_PROMPT });
    const aiSegment = classifyAiResponse(aiTurn1.session.raw, null, {
      allowRealUpstream: Boolean(fetchImpl?.allowRealAiUpstream || process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM === "1"),
    });
    const aiDisabled = aiTurn1.session.status === 503 && aiTurn1.session.code === "ai_disabled";
    steps.aiTurn1 = { status: aiDisabled ? "BLOCKED" : aiSegment.status, session: { status: aiTurn1.session.status, code: aiTurn1.session.code }, frame: { status: aiTurn1.frame.status, code: aiTurn1.frame.code }, reason: aiDisabled ? AI_DISABLED_BLOCKER : aiSegment.reason ?? "" };

    const revoke = await applyRevoke({ apiOrigin, fetchImpl, world, caseName });
    steps.revoke = { status: revoke.status === expectations.revoke ? "PASS" : "FAIL", route: revoke.via, httpStatus: revoke.status, code: revoke.code, shareLevel: revoke.shareLevel ?? "" };

    const aiTurn2 = await aiTurnOnBothRoutes({ apiOrigin, fetchImpl, world, frameToken, prompt: AI_TURN_2_PROMPT });
    steps.aiTurn2 = { status: aiTurn2.session.status === expectations.aiTurn2 && aiTurn2.frame.status === expectations.aiTurn2 ? "PASS" : "FAIL", session: { status: aiTurn2.session.status, code: aiTurn2.session.code }, frame: { status: aiTurn2.frame.status, code: aiTurn2.frame.code } };

    const save = await saveAttempt({ apiOrigin, fetchImpl, world, key });
    steps.saveRefused = { status: save.upload.status === expectations.saveUpload && save.commit.status === expectations.saveCommit ? "PASS" : "FAIL", upload: save.upload, commit: save.commit };

    const after = await versionsCount({ apiOrigin, fetchImpl, world });
    steps.versionsAfter = { status: after === before ? "PASS" : "FAIL", count: after };

    const intentRes = await call({ apiOrigin, fetchImpl, name: "lookupCommitIntent", params: { documentID: world.documentId }, token: world.member.token, headers: { "Idempotency-Key": key }, allowStatuses: [403, 404, 410] });
    const commitIntent = interpretCommitIntentLookup(intentRes);
    steps.commitIntent = { status: commitIntent.hasCommitted ? "FAIL" : "PASS", outcome: commitIntent.outcome, httpStatus: commitIntent.httpStatus };

    const verdict = decideRevokeOutcome({
      caseName, expectations, versionsBefore: before, versionsAfterRevoke: after, aiTurn1, aiTurn2, revoke, save, commitIntent,
    });
    const trim = (turn) => ({ session: { status: turn.session.status, code: turn.session.code }, frame: { status: turn.frame.status, code: turn.frame.code } });
    const details = { aiTurn1: trim(aiTurn1), aiTurn2: trim(aiTurn2), save, revoke, commitIntent, prepared: { restricted: caseName === "downgrade", shareLevel: revoke.shareLevel ?? "" } };
    if (log) {
      log(`case ${caseName} (${fixtureId}): versions before ${before}, AI turn 1 session ${aiTurn1.session.status}/frame ${aiTurn1.frame.status}`);
      log(`  revoke ${revoke.via} -> ${revoke.status}${revoke.code ? ` ${revoke.code}` : ""}`);
      log(`  AI turn 2 session ${aiTurn2.session.status}${aiTurn2.session.code ? ` ${aiTurn2.session.code}` : ""}/frame ${aiTurn2.frame.status}${aiTurn2.frame.code ? ` ${aiTurn2.frame.code}` : ""}; Save upload ${save.upload.status}/commit ${save.commit.status}${save.commit.code ? ` ${save.commit.code}` : ""}`);
      log(`  versions after ${after}; commit intent ${commitIntent.outcome} (http ${commitIntent.httpStatus}); verdict ${verdict.status}`);
    }
    return finish({ ...verdict, versionCounts: { versionsBefore: before, versionsAfterRevoke: after }, details });
  } catch (error) {
    steps.exception = { status: "FAIL", reason: safe(error instanceof Error ? error.message : String(error)) };
    return finish({ status: "FAIL", exitCode: 1, reason: safe(error instanceof Error ? error.message : String(error)), owner: REVOKE_OWNER });
  } finally {
    if (world) await cleanupWorld({ apiOrigin, fetchImpl, world });
  }
}

/** Best-effort cleanup: request the organization's deletion; never a token or a password in the answer. */
async function cleanupWorld({ apiOrigin, fetchImpl, world }) {
  try {
    await call({ apiOrigin, fetchImpl, name: "requestOrganizationDeletion", params: { orgID: world.organizationId }, token: world.owner.token, body: { confirm_slug: world.organizationSlug }, allowStatuses: [400, 403, 404, 409, 202] });
  } catch {
    // best effort so throwaway orgs do not accumulate on a real server
  }
}

// ---- CLI -------------------------------------------------------------------

/** The evidence line the CLI writes when it runs outside `evidence.mjs run`. */
async function writeEvidenceLine({ runDir, requirementId, fixtureId, command, argv, exitCode, status, blocker, artifact, startedAt }) {
  const { evidenceLine, fixtureSha256Of, harnessEvidenceId, ledgerIdentity } = await import("../harness/lib.mjs");
  const paths = harnessPaths(runDir);
  const line = evidenceLine({
    evidenceId: harnessEvidenceId(requirementId),
    ...(await ledgerIdentity()),
    requirementId,
    fixtureId,
    fixtureSha256: await fixtureSha256Of(fixtureId),
    fSha: process.env.OFFICE_FORK_SHA || "",
    platform: `${process.platform}-${process.arch}`,
    build: `node ${process.versions.node}`,
    command,
    argv,
    exitCode,
    result: status,
    artifact,
    checker: "harness:g7-04/revoke.mjs",
    blocker: status === "BLOCKED" ? blocker : "",
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  const { appendFileSync } = await import("node:fs");
  appendFileSync(paths.evidenceFile, `${JSON.stringify(line)}\n`);
}

async function main() {
  const startedAt = new Date().toISOString();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("usage: revoke.mjs --fixture <fx-docx-report-vi|fx-xlsx-revenue-xyz|all> --case <deactivate|downgrade|remove|all> [--run-dir <dir>] [--dry-run]");
    return 0;
  }
  const portsPath = harnessPaths(args.runDir).envFile;
  const ports = existsSync(portsPath) ? Object.fromEntries(readFileSync(portsPath, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const at = l.indexOf("="); return [l.slice(0, at).trim(), l.slice(at + 1).trim()]; })) : {};
  const apiOrigin = ports.API_ORIGIN ?? "";

  if (args.dryRun) {
    console.log(JSON.stringify({ dryRun: true, runDir: args.runDir, fixtures: args.fixtures, cases: args.cases, apiOrigin: apiOrigin ? "<set>" : "<missing>", startStatus: readStartStatus(args.runDir) }, null, 2));
    return 0;
  }
  if (!apiOrigin) {
    console.error(`FAILED: API_ORIGIN missing from ${portsPath} (run scripts/office/g5g6g7/harness/start.sh first)`);
    return 1;
  }

  const gate = startGate(readStartStatus(args.runDir));
  if (gate.gate !== "proceed") {
    const blocked = gate.gate === "blocked";
    console.error(`${blocked ? "BLOCKED" : "FAILED"}: ${gate.reason}`);
    return blocked ? BLOCKED_EXIT : 1;
  }

  const logDir = harnessPaths(args.runDir).logDir;
  mkdirSync(logDir, { recursive: true });
  let worst = 0;
  let worstStatus = "PASS";
  let blocker = "";
  const artifacts = [];
  for (const caseName of args.cases) {
    for (const fixtureId of args.fixtures) {
      const lines = [];
      const log = (message) => {
        lines.push(message);
        console.log(message);
      };
      const res = await runRevokeCase({ apiOrigin, runDir: args.runDir, fixtureId, caseName, log });
      const artifact = join(logDir, `g7-04-revoke-${caseName}-${fixtureId}.log`);
      writeFileSync(artifact, `${lines.join("\n")}\n`);
      artifacts.push(artifact);
      console.log(JSON.stringify({ case: caseName, fixture: fixtureId, status: res.status, exitCode: res.exitCode, reason: res.reason }, null, 2));
      if (res.status === "FAIL") {
        worst = 1;
        worstStatus = "FAIL";
      } else if (res.status === "BLOCKED" && worst === 0) {
        worst = BLOCKED_EXIT;
        worstStatus = "BLOCKED";
        blocker = res.blocker;
      }
      if (!process.env.OFFICE_EVIDENCE_ID) {
        await writeEvidenceLine({
          runDir: args.runDir,
          requirementId: process.env.OFFICE_EVIDENCE_REQ || "G7-A02",
          fixtureId,
          command: `node scripts/office/g5g6g7/g7-04/revoke.mjs --case ${caseName} --fixture ${fixtureId} --run-dir ${args.runDir}`,
          argv: [...process.argv],
          exitCode: res.exitCode,
          status: res.status,
          blocker: res.blocker,
          artifact,
          startedAt,
        });
      }
    }
  }
  if (worstStatus === "BLOCKED") console.error(`BLOCKED: ${blocker}`);
  else if (worstStatus === "FAIL") console.error("FAILED: at least one revoke case did not hold");
  return worst;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`revoke.mjs: ${error.message}`);
      process.exitCode = 1;
    });
}