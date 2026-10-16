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
//     (service/organization.go:155-156 RequireMemberQ, service/errors.go:53-57).
//     The two hosts answer that SAME refusal with two different codes, and the
//     driver asserts each route exactly (cloud D1-02, read from the Go code, never
//     assumed): the desktop session route passes the CodedError through as
//     403 `member_deactivated`, while the web frame route's actor resolver forwards
//     only ErrNotFound/ErrForbidden to mapServiceError and rewrites everything else
//     as a generic 401 `unauthorized` (handler/ai_mount.go:101-106) with
//     error_class `session` (handler/dto/sdo/error_class.go:64) — see FRAME_401_REASON.
//     The Save path is refused too: preflightDocument's view gate
//     (service/document_commit.go:272, service/organization.go:155-156) answers
//     403 `member_deactivated` on both the upload and the commit.
//
//   * `downgrade`: the document is set `restricted` and the app's own share goes
//     edit -> view (PATCH /documents/{id} visibility=restricted + POST
//     /documents/{id}/shares level=view, the qa-fault FQ-50 path, matrix.md FQ-50).
//     The AI turn only needs View (frameAIActor rechecks view,
//     handler/office_frame_ai.go:26-35; the session route's documentScope asks for
//     DocumentLevelView, service/ai_uniwork.go:391), so the next AI turn still
//     answers 200 on both routes — view-only AI is allowed by design (G6-05u,
//     Advisor; plan-G7-04.md:83-86). What the downgrade refuses is the SAVE: the
//     upload asks for DocumentLevelEdit (service/document_files.go:132-134) and
//     answers 403 `forbidden`, while the commit is answered 404 `not_found` at
//     resolveUpload (service/document_commit.go:277) because that runs BEFORE the
//     edit gate (:296). The upload's 403 is this case's edit-revoked proof.
//
//   * `remove`: DELETE /api/v1/workspaces/{ws}/members/{user} (router/workspaces.go:65
//     -> handler/workspace.go deleteMember -> WorkspaceService.RemoveMember). A
//     non-member holds no level, so nothing readable is 404 `not_found` by design on
//     both routes (service/document_permissions.go decideDocumentAccess:290-293, the
//     product rule a non-member never learns an id exists) — as in qa-fault FQ-12.
//
// Hard rules (spec "Build"):
//   * A 200 on the next AI turn after the revoke, a new version or a committed
//     commit intent is a FAIL, never a PASS. Each route is compared exactly; the
//     assertion is never widened to "any 4xx".
//   * A row may PASS only when AI turn 1 answered 200 on BOTH routes (D2-02,
//     cloud D2): the revoke can only be shown after a turn that really worked.
//     A turn 1 both routes refused 403 `office_capability_off` — and only when
//     BOTH routes answered that same refusal (BE-704-451) — is BLOCKED (exit 77)
//     with the capability named: the deployment has that flag off, so no turn
//     ever worked and the row can never PASS, whatever turn 2 answers. A turn 1
//     answering anything else but 200 (and not the 503 `ai_disabled` of a fake
//     deployment), including one route refusing the capability while the other
//     500s or times out, is a FAIL naming both routes. A capability that turns
//     off between the two turns (turn 1 200, turn 2 `office_capability_off`) is a
//     FAIL named as that flip, not as a revoke result (D2-03).
//   * Under `AI_PROVIDER=fake` the turn-1 CONTENT claim cannot be verified
//     (`classifyAiResponse` BLOCKs a 200 whose provider/model/content is labelled
//     fake), so the row must not end PASS while its own record says that step is
//     BLOCKED (BE-704-202): when every revoke assertion held the row is BLOCKED
//     (exit 77) naming `AI_CONTENT_BLOCKER`, and the record keeps every revoke
//     assertion as PASS so the evidence shows the revoke itself was proven. A
//     failing revoke assertion still wins over that BLOCKED.
//   * Every HTTP status and version count lands in the artifact log.
//
// Each (case, fixture) run seeds its OWN owner/member/workspace, and no world is
// cached on disk (D1-01, BE-704-04): a run must never inherit an earlier run's
// revoke, and a bearer token must never survive in the run dir.
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
 * Why the frame route answers 401 `unauthorized` after a deactivation while the
 * session route answers 403 `member_deactivated` (cloud D1-02, read from the Go
 * code): the frame actor resolver frameAIActor (handler/office_frame_ai.go:26-35)
 * re-runs the document ACL (service/office_frame.go:209-218 ->
 * service/document_permissions.go:307-335) and the refusal is the CodedError
 * errMemberDeactivated (service/organization.go:155-156, service/errors.go:53-57),
 * whose sentinel is deliberately NOT ErrForbidden; handler/ai_mount.go:101-102
 * forwards only ErrNotFound/ErrForbidden to mapServiceError and :103-106 rewrites
 * everything else as the generic 401 `unauthorized`. error_class `session` is the
 * code table's own entry (handler/dto/sdo/error_class.go:64) — the frame token
 * itself is stateless and still verifies. Both answers refuse the next AI turn.
 */
export const FRAME_401_REASON = "handler/ai_mount.go:101-106 rewrites the member_deactivated CodedError (service/organization.go:155-156, service/errors.go:53-57) as 401 unauthorized; error_class session per handler/dto/sdo/error_class.go:64; the session route passes the same refusal through as 403 member_deactivated";

/** Why the downgrade AI turn 2 is a 200: view-only AI is allowed by design (G6-05u, Advisor). */
export const VIEW_ONLY_AI_REASON = "view-only AI is allowed by design (G6-05u, Advisor; plan-G7-04.md:83-86): the AI turn needs DocumentLevelView only (handler/office_frame_ai.go:26-35, service/ai_uniwork.go:391)";

/** Why the downgrade commit is a 404: resolveUpload runs before the edit gate. */
export const DOWNGRADE_COMMIT_REASON = "resolveUpload runs before the edit gate (service/document_commit.go:277 vs :296) and the refused upload left no resolvable id; the edit-revoked proof of this case is the upload's 403 forbidden (service/document_files.go:132-134)";

/**
 * What the commit-intent lookup read proves, and what it cannot — the intent is
 * the CALLER's own (service/document_commit_intent.go:380-384: "another member's
 * key answers as an unknown one, so it reveals nothing", enforced at :429), so
 * the read is taken with the owner's token (the revoke never refuses it) and is
 * the OWNER's own answer; a revoked member's own read is refused 403/404. The
 * rule that a committed intent FAILs the row is proven by the unit test, and the
 * write path is refused before any intent is ever claimed
 * (service/document_commit.go:296 -> :305-309), so no intent can appear after
 * the revoke in the first place.
 */
export const COMMIT_INTENT_READ_REASON = "the intent is the caller's own (service/document_commit_intent.go:380-384, :429): this read is the owner's own answer, a revoked member's own read is refused 403/404, and the write path is refused before any intent is claimed (service/document_commit.go:296 -> :305-309)";

/**
 * The status each case makes the two hosts answer, per route, and what the Save
 * answers — read from the Go code (see the file header), never assumed. The AI
 * turn 2 is what the server really does: a closed tenant is refused on both
 * routes (403 `member_deactivated` on the session route, the 401 the frame actor
 * resolver writes on the frame route), a removal is 404 `not_found` on both, and
 * a downgrade to view leaves the AI turn (view) working and refuses the Save
 * (edit): the upload 403 `forbidden`, the commit 404 `not_found`.
 */
export const CASE_EXPECTATIONS = Object.freeze({
  deactivate: {
    revoke: 200,
    aiTurn2: {
      session: { status: 403, code: "member_deactivated" },
      frame: { status: 401, code: "unauthorized", errorClass: "session", why: FRAME_401_REASON },
    },
    saveUpload: { status: 403, code: "member_deactivated" },
    saveCommit: { status: 403, code: "member_deactivated" },
  },
  downgrade: {
    revoke: 200,
    aiTurn2: {
      session: { status: 200, why: VIEW_ONLY_AI_REASON },
      frame: { status: 200, why: VIEW_ONLY_AI_REASON },
    },
    saveUpload: { status: 403, code: "forbidden" },
    saveCommit: { status: 404, code: "not_found", why: DOWNGRADE_COMMIT_REASON },
  },
  // RemoveMember answers 204 on success (handler/workspace.go deleteMember); the 404
  // is what the removed member's own next calls answer, by design, on both routes.
  remove: {
    revoke: 204,
    aiTurn2: {
      session: { status: 404, code: "not_found" },
      frame: { status: 404, code: "not_found" },
    },
    saveUpload: { status: 404, code: "not_found" },
    saveCommit: { status: 404, code: "not_found" },
  },
});

/** BLOCKED reason under a fake deployment (contract-p0 §8). */
export const AI_DISABLED_BLOCKER = "no real upstream on this runner; contract-p0 §8";
export const AI_DISABLED_OWNER = "g7-qa";

/**
 * The named blocker of a turn-1 CONTENT that was never verifiable (BE-704-202):
 * turn 1 answered 200 on both routes but the answer carried the fake provider, so
 * `classifyAiResponse` BLOCKs the content step. Every revoke assertion may hold
 * and the row is still BLOCKED — the same rule the cross-host driver applies to a
 * BLOCKED step — and this text is what the artifact names, never a PASS.
 */
export const AI_CONTENT_BLOCKER = "turn-1 AI content not verifiable under the fake provider (real-AI round)";
export const AI_CONTENT_OWNER = AI_DISABLED_OWNER;
export const REVOKE_OWNER = "g7-qa";

/** The 403 a flag hides a UniWork capability with (service/ai_uniwork.go:498-514). */
export const CAPABILITY_OFF_CODE = "office_capability_off";
export const CAPABILITY_OFF_OWNER = "g7-qa";

/**
 * The named blocker of a deployment whose UniWork AI capability is off (D2-02):
 * turn 1 refused 403 `office_capability_off` with `fields.capability` naming the
 * format (e.g. `ai_uniwork_xlsx`), so no turn ever worked on this deployment and
 * the revoke cannot be shown — BLOCKED, never PASS.
 */
export function capabilityOffBlocker(capability) {
  return `UniWork AI capability ${capability || "ai_uniwork"} is off on this deployment: turn 1 refused, the revoke cannot be shown`;
}

/**
 * Why turn 1 must answer 200 on both routes before the row can PASS (D2-02): the
 * revoke assertion reads turn 2 against a turn 1 that worked, so a deployment
 * that refuses turn 1 proves nothing about the revoke.
 */
export const TURN_1_PRECONDITION_REASON = "the row may PASS only when AI turn 1 answered 200 on BOTH routes (D2-02): a refused turn 1 means the member's AI never worked, so a later refusal shows no revoke; 403 office_capability_off is BLOCKED with fields.capability named (service/ai_uniwork.go:498-514)";

/**
 * Why a capability that turns off BETWEEN the two turns is not a revoke result
 * (D2-03). Long text: it belongs to the record's `details.why`, never to the
 * 240-char-capped reason.
 */
export const CAPABILITY_FLIP_REASON = "the capability turned off between turn 1 and turn 2 (D2-03, service/ai_uniwork.go:498-514): a deployment change after a turn 1 that DID work, so the row FAILs as that flip and never as a revoke result";

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

/** The error class a refused answer carries (`error.error_class`), or "". */
export function errorClassOf(res) {
  const errorClass = res?.body?.error?.error_class ?? res?.data?.error?.error_class ?? "";
  return typeof errorClass === "string" ? errorClass : "";
}

/** The machine-readable detail a refused answer carries (`error.fields`), or {}. */
export function errorFieldsOf(res) {
  const fields = res?.body?.error?.fields ?? res?.data?.error?.fields;
  return fields && typeof fields === "object" ? fields : {};
}

function safe(text) {
  return redactSignInError(String(text ?? ""));
}

/** `403 member_deactivated` / `401 unauthorized error_class=session` / `0 timeout` for a reason line. */
function answerOf(answer) {
  if (!answer) return "none";
  const code = answer.code ? ` ${answer.code}` : "";
  const errorClass = answer.errorClass ? ` error_class=${answer.errorClass}` : "";
  return `${answer.status ?? "none"}${code}${errorClass}`;
}

/**
 * How many characters ONE dynamic value may occupy inside a reason
 * (BE-704-452). Every value the wire supplies — a route's error code,
 * `error.fields.capability`, an `error_class` — is an answer the row did not
 * choose, so it is bounded BEFORE it is interpolated, never truncated after: a
 * 21-char cap carries every real code this row can read
 * (`office_capability_off`, `member_deactivated`, `ai_uniwork_xlsx`).
 */
export const REASON_VALUE_MAX_CHARS = 21;

/**
 * How many characters a numeric tuple field may occupy (`9999` and `-999` fit,
 * anything wider is `big`). A number is never lost by it: the version counts
 * live in the record's own `versionCounts`, and the statuses in the steps and
 * `details` the reason leaves out.
 */
const TUPLE_NUMBER_MAX_CHARS = 4;

/**
 * One dynamic value of a reason, made safe BY CONSTRUCTION (BE-704-452):
 * redacted first, so the value is already a fixed point of the record's own
 * `redactSignInError` (a token-shaped run becomes `<redacted>`), and then — when
 * it still does not fit the cap — replaced by an explicit `oversized(<length>)`
 * marker. Never truncated: a bounded value is MARKED, so the reason still shows
 * which cell it was and the tuple never silently loses a measurement.
 */
export function reasonValueOf(raw, maxChars = REASON_VALUE_MAX_CHARS) {
  const text = redactSignInError(String(raw ?? ""));
  if (!text) return "";
  return text.length <= maxChars ? text : `oversized(${text.length})`;
}

/** One numeric tuple field: a small integer, or `none` when the run measured none. */
function tupleNumberOf(raw) {
  if (raw === null || raw === undefined || raw === "") return "none";
  const value = Number(raw);
  if (!Number.isFinite(value)) return "none";
  const text = String(value);
  return text.length <= TUPLE_NUMBER_MAX_CHARS ? text : "big";
}

/**
 * `403 forbidden` / `0 timeout` / `none` — one MEASURED route answer as the
 * reason's own compact entry: the status as a small number and the code bounded
 * and redacted (BE-704-452). The `error_class` and the transport message are
 * evidence for the record's `details`, never characters spent inside the
 * 240-char reason.
 */
function measuredAnswerOf(answer) {
  if (!answer) return "none";
  const code = reasonValueOf(answer.code);
  return `${tupleNumberOf(answer.status)}${code ? ` ${code}` : ""}`;
}

/**
 * The compact MEASURED tuple every BLOCKED/FAIL reason is built from
 * (BE-704-350, BE-704-351, BE-704-352): turn 1 and turn 2 status/code per route,
 * the version counts before and after the revoke, and BOTH Save answers — the
 * Save upload and commit through the SAME mapper as the AI routes (BE-704-450).
 * A route that produced no HTTP answer carries its own transport code instead
 * (`timeout`, `transport`, or `http_<status>` for a 5xx the call refused), never
 * a server code. A part the run never reached is left out, so even a
 * prerequisite or driver failure reads as one tuple.
 *
 * Compact codes only — never prose, never an expectation interpolated as an
 * observation — and every dynamic value is bounded by `reasonValueOf`
 * (BE-704-452), so the whole reason is inside the record's own 240-char
 * redaction by construction: the widest composition is 37 (verdict) + 2 + 58
 * (turn 1) + 1 + 58 (turn 2) + 1 + 12 (versions) + 1 + 64 (Save) = 234
 * characters — a 21-char code/capability cap, a 4-char numeric cap and the
 * static separators — and a fixed point of `redactSignInError`, because every
 * piece of it already is one.
 */
export function measuredTupleOf(measured) {
  const { aiTurn1, aiTurn2, versionsBefore, versionsAfterRevoke, save } = measured ?? {};
  const parts = [];
  if (aiTurn1) parts.push(`t1 ${routePairOf(aiTurn1)}`);
  if (aiTurn2) parts.push(`t2 ${routePairOf(aiTurn2)}`);
  if (versionsBefore != null || versionsAfterRevoke != null) parts.push(`v ${tupleNumberOf(versionsBefore)}->${tupleNumberOf(versionsAfterRevoke)}`);
  if (save) parts.push(`save up ${measuredAnswerOf(save.upload)}/cm ${measuredAnswerOf(save.commit)}`);
  return parts.length ? parts.join(" ") : "no measurement";
}

/**
 * `s<session>/f<frame>`, the measured status and CODE of both routes — no
 * error_class and no transport message: those are evidence for the record's
 * `details`, and every character here is spent inside the reason's 240-char
 * redaction.
 */
function routePairOf(turn) {
  return `s${measuredAnswerOf(turn?.session)}/f${measuredAnswerOf(turn?.frame)}`;
}

/**
 * The ONE builder of a row reason (BE-704-350): the verdict as a compact code,
 * then the measured tuple — both built from bounded pieces only (BE-704-452).
 * Every BLOCKED and FAIL verdict goes through it, so no reason can outgrow the
 * record's 240-char redaction or print an expectation where a measurement
 * belongs; the long text — the expectation, the blocker, the file:line why, the
 * mismatch prose — belongs to `details` and to `blocker`. The verdict's own
 * dynamic parts (a capability name, a status, an unknown case) are passed
 * through `reasonValueOf` at the call site, never concatenated raw.
 */
export function verdictReasonOf(verdict, measured) {
  return `${verdict}; ${measuredTupleOf(measured)}`;
}

/**
 * "" when the measured answer is exactly the expected one — status first, then
 * the code and the error_class when the expectation names them. One rule, used
 * by the step record and by the verdict, so a route's answer is never widened.
 */
export function answerMismatch(label, want, got) {
  if (got?.status === want.status && (!want.code || got.code === want.code) && (!want.errorClass || got.errorClass === want.errorClass)) return "";
  return `${label} answered ${answerOf(got)}, want ${answerOf(want)}`;
}

/**
 * Why turn 1 is not the 200 both routes must answer (D2-02), "" when it is. One
 * helper, used by the step record and by the verdict, so the two can never drift.
 */
export function turn1MissesOf(aiTurn1) {
  return [
    answerMismatch("the session route", { status: 200 }, aiTurn1?.session),
    answerMismatch("the frame route", { status: 200 }, aiTurn1?.frame),
  ].filter(Boolean);
}

/** The 403 `office_capability_off` refusal a deployment answers one route with (D2-02). */
function isCapabilityRefusal(answer) {
  return answer?.status === 403 && answer?.code === CAPABILITY_OFF_CODE;
}

/**
 * D2-02 as BE-704-451 fixed it: the capability-off BLOCKED applies only when
 * BOTH turn-1 routes answered that same refusal. The flag is off
 * deployment-wide, so one route refusing the whole turn while the other route
 * answered anything else (a 5xx, a timeout, a different code) is NOT a
 * capability blocker — that other route failed on its own and the row is the
 * `turn1_not_200` FAIL naming both measurements. One helper, so the verdict and
 * the row's own step can never read the turn differently.
 */
export function turn1CapabilityOffOf(aiTurn1) {
  return isCapabilityRefusal(aiTurn1?.session) && isCapabilityRefusal(aiTurn1?.frame);
}

/**
 * The pure verdict of one case. Hard rules first: a new version, a committed
 * intent or a per-route AI/Save answer that is not the code's is a FAIL. Only
 * when every revoke assertion passed may a turn 1 that refused the whole turn
 * downgrade the result to BLOCKED — 403 `office_capability_off` (D2-02) with the
 * capability named, or a fake deployment's 503 `ai_disabled` — and a turn 1 that
 * answered 200 but whose own CONTENT step is BLOCKED (`aiTurn1Step`, the row's
 * recorded step) is BLOCKED too, never PASS (BE-704-202).
 *
 * Every verdict's reason is `verdictReasonOf` over the MEASURED tuple
 * (BE-704-350): a compact code plus measurements, never prose, so it survives
 * the record's 240-char redaction. The expectation it was read against, the
 * mismatch prose, the blocker and the file:line why go to `details`.
 */
export function decideRevokeOutcome({
  expectations,
  versionsBefore,
  versionsAfterRevoke,
  aiTurn1,
  aiTurn2,
  revoke,
  save,
  commitIntent,
  aiDisabled = null,
  aiTurn1Step = null,
}) {
  const x = expectations;
  const measured = { aiTurn1, aiTurn2, versionsBefore, versionsAfterRevoke, save };
  // The expectation side of the row: long text, never a reason.
  const expected = {
    aiTurn1: { session: answerOf({ status: 200 }), frame: answerOf({ status: 200 }) },
    aiTurn2: { session: answerOf(x.aiTurn2.session), frame: answerOf(x.aiTurn2.frame) },
    save: { upload: answerOf(x.saveUpload), commit: answerOf(x.saveCommit) },
    revoke: x.revoke,
  };
  const fail = (verdict, { why = "", mismatch = [] } = {}) => ({
    status: "FAIL",
    exitCode: 1,
    owner: REVOKE_OWNER,
    reason: verdictReasonOf(verdict, measured),
    details: { verdict, expected, why, mismatch },
  });
  const blocked = (verdict, blocker, owner, why = "", mismatch = []) => ({
    status: "BLOCKED",
    exitCode: BLOCKED_EXIT,
    owner,
    blocker,
    reason: verdictReasonOf(verdict, measured),
    details: { verdict, expected, why, mismatch },
  });
  // Under a fake deployment the turn-1 CONTENT claim cannot be proven; the turn
  // answers 503 `ai_disabled` (contract-p0 §8). Derived from the turn itself so a
  // caller cannot forget to pass the flag.
  const turn1Disabled =
    aiDisabled ?? (aiTurn1?.session?.status === 503 && aiTurn1?.session?.code === "ai_disabled");
  // D2-02: a turn 1 the deployment refused because the capability is off proves
  // no revoke — but only when BOTH routes answered that same refusal
  // (BE-704-451); one refusal with a failing other route is the turn-1 FAIL
  // below. The capability comes from the response's own fields
  // (service/ai_uniwork.go:498-514), never assumed.
  const turn1CapabilityOff = turn1CapabilityOffOf(aiTurn1);
  const turn1Capability = aiTurn1?.session?.capability || aiTurn1?.frame?.capability || "ai_uniwork";
  // BE-704-202: the row's own turn-1 step is the source of truth for the content
  // claim. A 200 whose content `classifyAiResponse` BLOCKed leaves that step
  // BLOCKED, and a row must never end PASS while a step inside it is BLOCKED —
  // the rule the cross-host driver applies. The two environment refusals carry
  // their own blockers and are excluded here.
  const turn1ContentBlocked =
    aiTurn1Step?.status === "BLOCKED" && !turn1Disabled && !turn1CapabilityOff;
  if (versionsAfterRevoke !== versionsBefore) {
    return fail("version_delta");
  }
  if (commitIntent?.hasCommitted) {
    return fail("commit_intent_committed", { why: COMMIT_INTENT_READ_REASON });
  }
  const saveMisses = [
    answerMismatch("the upload", x.saveUpload, save?.upload),
    answerMismatch("the commit", x.saveCommit, save?.commit),
  ].filter(Boolean);
  if (saveMisses.length) {
    return fail("save_not_refused", { mismatch: saveMisses });
  }
  if (revoke?.status !== x.revoke) {
    return fail(`revoke_status ${tupleNumberOf(revoke?.status)}`);
  }
  // D2-02: the capability off at turn 1 blocks the row whatever turn 2 says —
  // but only after every revoke assertion held, so a real defect still FAILs.
  if (turn1CapabilityOff) {
    return blocked(`capability_off ${reasonValueOf(turn1Capability)}`, capabilityOffBlocker(turn1Capability), CAPABILITY_OFF_OWNER, TURN_1_PRECONDITION_REASON);
  }
  if (turn1Disabled) {
    return blocked("ai_disabled", AI_DISABLED_BLOCKER, AI_DISABLED_OWNER, AI_DISABLED_BLOCKER);
  }
  // D2-02: the row may PASS only after a turn 1 that answered 200 on both
  // routes; anything else but the fake deployment's 503 is a FAIL naming both.
  const turn1Misses = turn1MissesOf(aiTurn1);
  if (turn1Misses.length) {
    return fail("turn1_not_200", { why: TURN_1_PRECONDITION_REASON, mismatch: turn1Misses });
  }
  // D2-03: turn 1 worked and the capability turned off before turn 2 — a
  // deployment change, not the revoke, so it is named as that flip.
  const turn2CapabilityOff =
    (aiTurn2?.session?.status === 403 && aiTurn2?.session?.code === CAPABILITY_OFF_CODE) ||
    (aiTurn2?.frame?.status === 403 && aiTurn2?.frame?.code === CAPABILITY_OFF_CODE);
  if (turn2CapabilityOff) {
    const flipped = aiTurn2?.session?.capability || aiTurn2?.frame?.capability || "ai_uniwork";
    return fail(`capability_flip ${reasonValueOf(flipped)}`, { why: CAPABILITY_FLIP_REASON });
  }
  const turn2Misses = [
    answerMismatch("the session route", x.aiTurn2.session, aiTurn2?.session),
    answerMismatch("the frame route", x.aiTurn2.frame, aiTurn2?.frame),
  ].filter(Boolean);
  if (turn2Misses.length) {
    return fail("turn2_not_refused", { mismatch: turn2Misses });
  }
  // BE-704-202: every revoke assertion held and turn 1 did answer 200 on both
  // routes, but the CONTENT of that turn is BLOCKED (a fake provider's 200), so
  // the row is BLOCKED — never PASS — naming that blocker, while every revoke
  // assertion stays PASS in the record so the artifact still shows the revoke
  // itself was proven. Deliberately after every FAIL check: any FAIL still wins.
  if (turn1ContentBlocked) {
    return blocked("content_not_verifiable", AI_CONTENT_BLOCKER, AI_CONTENT_OWNER, AI_CONTENT_BLOCKER);
  }
  return { status: "PASS", exitCode: 0, reason: verdictReasonOf("revoke_held", measured), details: { verdict: "revoke_held", expected } };
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

/** The file an earlier driver version cached its world in; it is deleted, never read. */
const LEGACY_WORLD_CACHE = "g7-04-revoke-world.json";

/**
 * Seeds the owner (the admin who revokes) and the editor member (the second user
 * whose access is revoked), an organization and a workspace, and uploads the
 * fixture as a file document owned by the owner but edited by the member.
 *
 * Every call seeds a FRESH world. One cloud run reuses a run dir for all six
 * (case, fixture) runs, and a cached member would already be deactivated by the
 * second run (D1-01); a cache file would also hold bearer tokens in the run dir
 * (BE-704-04). A cache an earlier driver version wrote is removed here, never
 * read back. Nothing here prints or returns a password: the throwaway one both
 * registrations use lives in this call's memory only.
 */
async function seedRevokeWorld({ apiOrigin, fetchImpl, fixtureId, repoRoot, runDir, now = Date.now() }) {
  try {
    rmSync(join(runDir, LEGACY_WORLD_CACHE), { force: true });
  } catch {
    // best effort: an older driver's cache file is deleted, never read
  }
  const stamp = `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const password = `g704-${Math.random().toString(36).slice(2, 12)}`;

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

  return {
    apiOrigin,
    owner,
    member,
    organizationId: org.id,
    organizationSlug: org.slug ?? `o-g704-${stamp}`,
    workspaceId: ws.id,
    documentId: doc.body.document.id,
    revision: String(doc.body.document.revision ?? "1"),
    fixture,
  };
}

/** Uploads the fixture again as the candidate v2 bytes of a Save (never printed). */
async function v2BytesOf(fixture) {
  const form = new FormData();
  form.append("file", new Blob([fixture.bytes]), basename(fixture.entry.path));
  return form;
}

// ---- the per-case steps ----------------------------------------------------

/**
 * The version count, always read with the OWNER's bearer (BE-704-02): the owner
 * keeps read access in every case, while the revoked member's own read is refused
 * — 403 `member_deactivated` after a deactivate, 404 `not_found` after a remove —
 * which would turn the count itself into a hard FAIL before the "+0 versions"
 * assertion is evaluated.
 */
async function versionsCount({ apiOrigin, fetchImpl, world }) {
  const res = await call({ apiOrigin, fetchImpl, name: "listDocumentVersions", params: { documentID: world.documentId }, token: world.owner.token });
  return { status: res.status, count: (res.body?.versions ?? []).length, by: "owner" };
}

/**
 * The measured record of a route whose call produced no usable HTTP answer
 * (BE-704-352): a distinct code that can never be mistaken for a server code —
 * `http_<status>` when the route did answer with a status the call refuses (a
 * 5xx), `timeout` when the request never came back, `transport` for any other
 * failure. `raw.ok` is false, so `classifyAiResponse` BLOCKs that route's content
 * claim instead of reading a 200 that never happened.
 */
function routeErrorOf(error) {
  const status = Number(error?.status) || 0;
  const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError" || error?.code === "ABORT_ERR";
  const code = status ? `http_${status}` : timedOut ? "timeout" : "transport";
  return {
    status,
    code,
    errorClass: "",
    capability: "",
    error: error instanceof Error ? error.message : String(error),
    raw: { ok: false, status, data: null },
  };
}

/**
 * Whether an exception the shared table's `call()` raised is a ROUTE failure the
 * reason may name (BE-704-454): a refused status (`ApiError` — a 5xx the call's
 * `allowStatuses` did not include), a request that was aborted or timed out
 * (`TimeoutError`/`AbortError`/`ABORT_ERR`), or the platform's own `fetch`
 * rejection (the `TypeError` undici raises for a connection failure, carrying
 * the socket error as its `cause`). Anything else is a harness defect, not a
 * route answer.
 */
function isRouteFailure(error) {
  if (error instanceof ApiError) return true;
  if (error?.name === "TimeoutError" || error?.name === "AbortError" || error?.code === "ABORT_ERR") return true;
  return error instanceof TypeError && error.cause !== undefined;
}

/**
 * One route call as the record measures it: the HTTP answer the driver's own
 * `call()` returned, or the transport/status failure `routeErrorOf` names. Only
 * the failures `isRouteFailure` recognizes are classified; ANY other exception
 * is rethrown to the outer `driver_error` path (BE-704-454), so a harness defect
 * can never be reported as a product-style route transport failure.
 */
async function measureRoute(request) {
  try {
    const res = await request();
    return { status: res.status, code: errorCodeOf(res), errorClass: errorClassOf(res), capability: capabilityOf(res), error: "", raw: { ok: res.ok, status: res.status, data: res.body } };
  } catch (error) {
    if (!isRouteFailure(error)) throw error;
    return routeErrorOf(error);
  }
}

/**
 * One AI turn on both hosts, with the status, code and error_class the answer
 * carries. Each route captures its OWN transport/status error and both routes are
 * ALWAYS tried (BE-704-352): a session 500 or timeout must still carry the frame
 * route's measurement in the turn-1 FAIL, never end as a generic exception FAIL.
 */
async function aiTurnOnBothRoutes({ apiOrigin, fetchImpl, world, frameToken, prompt }) {
  const allowed = [400, 401, 403, 404, 409, 429, 503];
  const session = await measureRoute(() => call({
    apiOrigin, fetchImpl, name: "aiUniworkDocumentChatCompletions", params: { documentID: world.documentId }, token: world.member.token,
    body: { messages: [{ role: "user", content: prompt }] }, allowStatuses: allowed,
  }));
  const frame = await measureRoute(() => call({
    apiOrigin, fetchImpl, name: "aiUniworkFrameChatCompletions", params: { documentID: world.documentId }, token: frameToken,
    body: { messages: [{ role: "user", content: prompt }] }, allowStatuses: allowed,
  }));
  return { session, frame };
}

/** The capability a refused turn names (`error.fields.capability`), or "". */
function capabilityOf(res) {
  const capability = errorFieldsOf(res).capability;
  return typeof capability === "string" ? capability : "";
}

/** The member's Save attempt: stage the bytes, then commit on the head revision. */
async function saveAttempt({ apiOrigin, fetchImpl, world, key }) {
  // BE-704-450: the Save upload and commit go through the SAME route wrapper as
  // the AI routes, so a refused 5xx, a timeout and a transport failure are named
  // `http_<status>`/`timeout`/`transport` here too — one mapper, one vocabulary.
  const form = await v2BytesOf(world.fixture);
  const upload = await measureRoute(() => call({
    apiOrigin, fetchImpl, name: "uploadDocumentFile", params: { documentID: world.documentId }, token: world.member.token,
    form, headers: { "Idempotency-Key": `${key}-up` }, allowStatuses: [400, 403, 404, 409, 422],
  }));
  const commit = await measureRoute(() => call({
    apiOrigin, fetchImpl, name: "commitDocumentVersion", params: { documentID: world.documentId }, token: world.member.token,
    headers: { "Idempotency-Key": key }, body: { upload_id: upload.raw?.data?.upload_id ?? "none", base_revision: world.revision },
    allowStatuses: [400, 403, 404, 409, 422],
  }));
  // The record's own Save shape: the status, the mapped code and (for a
  // transport failure) the message — never a credential-shaped answer.
  const saveAnswerOf = (measured) => ({ status: measured.status, code: measured.code, error: safe(measured.error) });
  return { upload: saveAnswerOf(upload), commit: saveAnswerOf(commit) };
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
 * One (case, fixture) run, on a world seeded for that run alone. `runDir`
 * supplies start.sh's status and ports.env; the apiOrigin may be injected
 * (tests) or read from ports.env (the real stack).
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
    // A prerequisite failure was never measured: the reason is still the ONE
    // helper's compact code (BE-704-350), and the long start.sh text lives in
    // `blocker`, `details.gate` and the run's own log.
    const blockedGate = gate.gate === "blocked";
    steps.start = { status: blockedGate ? "BLOCKED" : "FAIL", reason: gate.reason };
    if (log) log(`${blockedGate ? "BLOCKED" : "FAIL"}: ${gate.reason}`);
    return finish(blockedGate
      ? { status: "BLOCKED", exitCode: BLOCKED_EXIT, owner: REVOKE_OWNER, blocker: gate.reason, reason: verdictReasonOf("start_blocked", null), details: { verdict: "start_blocked", gate: gate.reason } }
      : { status: "FAIL", exitCode: 1, owner: REVOKE_OWNER, reason: verdictReasonOf("start_failed", null), details: { verdict: "start_failed", gate: gate.reason } });
  }

  const expectations = CASE_EXPECTATIONS[caseName];
  if (!expectations) {
    steps.args = { status: "FAIL", reason: `unknown case ${caseName}` };
    return finish({ status: "FAIL", exitCode: 1, owner: REVOKE_OWNER, reason: verdictReasonOf(`unknown_case ${reasonValueOf(caseName)}`, null), details: { verdict: `unknown_case ${caseName}` } });
  }

  let world = null;
  let frameToken = "";
  // The measured tuple every verdict reason is built from (BE-704-350): filled as
  // the run progresses, so even a driver failure reports what was measured.
  const measured = { aiTurn1: null, aiTurn2: null, versionsBefore: null, versionsAfterRevoke: null, save: null };
  const key = `g7-04-revoke-${caseName}-${Date.now()}`;
  try {
    const seeded = await seedRevokeWorld({ apiOrigin, fetchImpl, fixtureId, repoRoot, runDir });
    world = seeded;
    steps.seed = { status: "PASS", documentId: world.documentId, workspaceId: world.workspaceId, memberId: world.member.userId };

    const before = await versionsCount({ apiOrigin, fetchImpl, world });
    measured.versionsBefore = before.count;
    steps.versionsBefore = { status: "PASS", count: before.count, by: before.by };

    // The web host opens through a frame token the member mints.
    const minted = await call({ apiOrigin, fetchImpl, name: "mintOfficeFrameToken", params: { documentID: world.documentId }, token: world.member.token });
    frameToken = minted.body?.token ?? "";
    steps.frameOpen = { status: frameToken ? "PASS" : "FAIL", canEdit: minted.body?.can_edit ?? null };

    const aiTurn1 = await aiTurnOnBothRoutes({ apiOrigin, fetchImpl, world, frameToken, prompt: AI_TURN_1_PROMPT });
    measured.aiTurn1 = aiTurn1;
    const aiSegment = classifyAiResponse(aiTurn1.session.raw, null, {
      allowRealUpstream: Boolean(fetchImpl?.allowRealAiUpstream || process.env.HARNESS_ALLOW_REAL_AI_UPSTREAM === "1"),
    });
    const aiDisabled = aiTurn1.session.status === 503 && aiTurn1.session.code === "ai_disabled";
    // D2-02 + BE-704-451: a capability-off turn 1 is the same kind of BLOCKED —
    // the environment cannot show the revoke — and names the capability it read,
    // but only when BOTH routes answered that refusal; a mixed turn is the FAIL
    // below.
    const turn1CapabilityOff = turn1CapabilityOffOf(aiTurn1);
    const turn1Capability = aiTurn1.session.capability || aiTurn1.frame.capability || "ai_uniwork";
    // A turn 1 that answered something other than 200 (and is not one of the two
    // environment refusals) is the FAIL the verdict names, so the step says FAIL
    // too — the artifact never reads BLOCKED where the row FAILed. The step reason
    // is the same compact code the verdict uses; the measurements are its own
    // session/frame fields and the row's measured tuple.
    const turn1Misses = turn1MissesOf(aiTurn1);
    steps.aiTurn1 = {
      status: aiDisabled || turn1CapabilityOff ? "BLOCKED" : turn1Misses.length ? "FAIL" : aiSegment.status,
      session: { status: aiTurn1.session.status, code: aiTurn1.session.code, capability: aiTurn1.session.capability },
      frame: { status: aiTurn1.frame.status, code: aiTurn1.frame.code, capability: aiTurn1.frame.capability },
      reason: aiDisabled
        ? "ai_disabled"
        : turn1CapabilityOff
          ? `capability_off ${reasonValueOf(turn1Capability)}`
          : turn1Misses.length
            ? "turn1_not_200"
            : aiSegment.reason ?? "",
    };

    const revoke = await applyRevoke({ apiOrigin, fetchImpl, world, caseName });
    steps.revoke = { status: revoke.status === expectations.revoke ? "PASS" : "FAIL", route: revoke.via, httpStatus: revoke.status, code: revoke.code, shareLevel: revoke.shareLevel ?? "" };

    const aiTurn2 = await aiTurnOnBothRoutes({ apiOrigin, fetchImpl, world, frameToken, prompt: AI_TURN_2_PROMPT });
    measured.aiTurn2 = aiTurn2;
    const turn2Misses = [
      answerMismatch("session", expectations.aiTurn2.session, aiTurn2.session),
      answerMismatch("frame", expectations.aiTurn2.frame, aiTurn2.frame),
    ].filter(Boolean);
    steps.aiTurn2 = {
      status: turn2Misses.length ? "FAIL" : "PASS",
      session: { status: aiTurn2.session.status, code: aiTurn2.session.code },
      frame: { status: aiTurn2.frame.status, code: aiTurn2.frame.code, errorClass: aiTurn2.frame.errorClass },
      reason: turn2Misses.length ? "turn2_not_refused" : "",
    };

    const save = await saveAttempt({ apiOrigin, fetchImpl, world, key });
    measured.save = save;
    const saveMisses = [
      answerMismatch("upload", expectations.saveUpload, save.upload),
      answerMismatch("commit", expectations.saveCommit, save.commit),
    ].filter(Boolean);
    steps.saveRefused = { status: saveMisses.length ? "FAIL" : "PASS", upload: save.upload, commit: save.commit, reason: saveMisses.length ? "save_not_refused" : "" };

    const after = await versionsCount({ apiOrigin, fetchImpl, world });
    measured.versionsAfterRevoke = after.count;
    steps.versionsAfter = { status: after.count === before.count ? "PASS" : "FAIL", count: after.count, by: after.by };

    // The lookup reads the OWNER's token (the revoked member's own read is refused
    // by the document gate) and hands interpretCommitIntentLookup the shape it
    // reads: the tracer helper reads res.data, while this driver's call() answers
    // { status, ok, body } (BE-704-01) — so the body is passed as `data`, never
    // silently swallowed. What the read proves is COMMIT_INTENT_READ_REASON.
    const intentRes = await call({ apiOrigin, fetchImpl, name: "lookupCommitIntent", params: { documentID: world.documentId }, token: world.owner.token, headers: { "Idempotency-Key": key }, allowStatuses: [403, 404, 410] });
    const commitIntent = interpretCommitIntentLookup({ ...intentRes, data: intentRes.body });
    steps.commitIntent = { status: commitIntent.hasCommitted ? "FAIL" : "PASS", outcome: commitIntent.outcome, httpStatus: commitIntent.httpStatus, by: "owner" };

    const routeNotes = [
      ...Object.entries(expectations.aiTurn2).map(([route, want]) => ({ route: `aiTurn2.${route}`, expect: answerOf(want), why: want.why ?? "" })),
      { route: "saveUpload", expect: answerOf(expectations.saveUpload), why: expectations.saveUpload.why ?? "" },
      { route: "saveCommit", expect: answerOf(expectations.saveCommit), why: expectations.saveCommit.why ?? "" },
      { route: "aiTurn1", expect: "200 on both routes", why: TURN_1_PRECONDITION_REASON },
      { route: "commitIntent", expect: "never committed", why: COMMIT_INTENT_READ_REASON },
    ].filter((note) => note.why);

    const verdict = decideRevokeOutcome({
      expectations, versionsBefore: before.count, versionsAfterRevoke: after.count, aiTurn1, aiTurn2, revoke, save, commitIntent,
      // the row's own recorded turn-1 step decides the content claim (BE-704-202)
      aiTurn1Step: steps.aiTurn1,
    });
    const trim = (turn) => ({
      session: { status: turn.session.status, code: turn.session.code, errorClass: turn.session.errorClass, capability: turn.session.capability, error: turn.session.error ?? "" },
      frame: { status: turn.frame.status, code: turn.frame.code, errorClass: turn.frame.errorClass, capability: turn.frame.capability, error: turn.frame.error ?? "" },
    });
    // The verdict's own details (verdict code, expectation, why, mismatch prose)
    // come first: they are the long text its 240-char-capped reason left out.
    const details = { ...(verdict.details ?? {}), aiTurn1: trim(aiTurn1), aiTurn2: trim(aiTurn2), save, revoke, commitIntent, routeNotes, prepared: { restricted: caseName === "downgrade", shareLevel: revoke.shareLevel ?? "" } };
    if (log) {
      log(`case ${caseName} (${fixtureId}): versions before ${before.count} (read by ${before.by}), AI turn 1 session ${answerOf(aiTurn1.session)}/frame ${answerOf(aiTurn1.frame)}`);
      log(`  revoke ${revoke.via} -> ${revoke.status}${revoke.code ? ` ${revoke.code}` : ""}`);
      log(`  AI turn 2 session ${answerOf(aiTurn2.session)}/frame ${answerOf(aiTurn2.frame)}; Save upload ${answerOf(save.upload)}/commit ${answerOf(save.commit)}`);
      log(`  versions after ${after.count} (read by ${after.by}); commit intent ${commitIntent.outcome} (http ${commitIntent.httpStatus}); verdict ${verdict.status}`);
      log(`  reason ${verdict.reason}`);
      for (const note of routeNotes) log(`  expected ${note.route} ${note.expect} — ${note.why}`);
    }
    return finish({ ...verdict, versionCounts: { versionsBefore: before.count, versionsAfterRevoke: after.count }, details });
  } catch (error) {
    // A driver failure has no measurement of its own where it stopped, so the
    // reason is the ONE helper over what WAS measured and the message — long text
    // — goes to `details.error`, the step record and the run's own log
    // (BE-704-350: never a prose reason cut at 240).
    const message = safe(error instanceof Error ? error.message : String(error));
    steps.exception = { status: "FAIL", reason: message };
    if (log) log(`driver error: ${message}`);
    return finish({ status: "FAIL", exitCode: 1, owner: REVOKE_OWNER, reason: verdictReasonOf("driver_error", measured), details: { verdict: "driver_error", error: message, measured } });
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
      // Every (case, fixture) run seeds its own world: no run can see an earlier
      // run's revoke (D1-01) and nothing but the artifact text is left behind.
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
