// Case drivers of the G7-03a app-layer fault runner (UNI-1380, WI-4), part 1:
// crash, offline, timeout-after-commit, claim expiry, two-device conflict and
// the exits of `reconciling` (FQ-20, 21, 22, 24, 25, 40, 41, 42). Part 2 is
// app-case-drivers-blocked.mjs. Each driver acts on a fresh document through
// the app (app-session.mjs) and the D server (app-tenant.mjs), with the row's
// proxy rules from cases.json, and returns `{documentId, assertions, blocker?}`.
// Expectations are the matrix's (matrix.md §2), never the fork's behaviour of
// the day: a known gap stays a FAIL, tagged `predicted` by the runner.

import {
  assertEntersWithCode, assertNeverState, assertStatePath, assertion, commitLookups, commitPosts,
  intentIdsOf, keyTagsOf, logSince, reachedUpstream, uploadPosts,
} from "./app-cases-lib.mjs";
import { crash, edit, openDocument, save } from "./app-session.mjs";
import { deviceBCommit, expireStagedClaims } from "./app-tenant.mjs";

const NEVER = ["failed", "cancelled"];

/** Opens a fresh document in a fresh app; installs `rules` after the open so the open itself is never faulted. */
export async function openFresh(ctx, { rules = [], launch = {} } = {}) {
  const doc = await ctx.newDocument();
  const session = await ctx.launch(launch);
  const opened = await openDocument(session, doc.id, ctx.kind);
  await ctx.setRules(rules);
  return { doc, session, opened };
}

/** Edit + explicit Save, then the first trace line of the new intent (or null). */
export async function editAndSave(ctx, session, opened, label, n = 1) {
  const since = ctx.now();
  await edit(opened, `${ctx.marker}${label}`, n);
  await save(session, opened);
  return ctx.waitState(opened.documentId, null, { since, timeout: 30_000 });
}

export const deltaAssertion = async (ctx, docId, expected) => {
  const delta = await ctx.versionDelta(docId);
  return assertion("version_delta", expected, delta, delta === expected);
};

export const oneIntent = (lines) => {
  const ids = intentIdsOf(lines);
  return assertion("one_intent", 1, ids.length, ids.length === 1);
};

/** Every commit POST and commit lookup of the document carries one keyTag (no replacement key). */
export const sameKey = (log, docId, { withUploads = false } = {}) => {
  const entries = [...commitPosts(log, docId), ...commitLookups(log, docId), ...(withUploads ? uploadPosts(log, docId) : [])];
  const tags = keyTagsOf(entries);
  return assertion(withUploads ? "one_key_uploads_and_commits" : "one_key_for_commits", 1, `${tags.length} keyTag(s) over ${entries.length} request(s)`, tags.length === 1);
};

/** The commit POSTs that reached the server and got `status`. */
const upstreamCommits = (log, docId, status = null) =>
  commitPosts(log, docId).filter((e) => reachedUpstream(e) && (status === null || e.status === status));

// ---- FQ-20: crash while offline, restart, network back --------------------------------
async function fq20(ctx) {
  const { doc, session, opened } = await openFresh(ctx, { rules: ctx.caseRules(["unreachable"]) });
  const first = await editAndSave(ctx, session, opened, "N");
  const parked = await ctx.waitState(doc.id, "paused_offline", { timeout: 60_000 });
  // snapshot N: the working copy the Save wrote (the e2e's own proof of what was saved)
  const snapshotN = ctx.sha256File(opened.path);
  await edit(opened, `${ctx.marker}N1`, 2);
  const killed = crash(session);
  const restarted = await ctx.launch({ requireSignIn: false });
  await ctx.sleep(8_000);
  const beforeLift = ctx.now();
  await ctx.clearRules();
  const done = await ctx.waitState(doc.id, "committed", { timeout: 180_000 });
  await ctx.waitSignedIn(restarted);
  const lines = ctx.trace(doc.id);
  const log = await ctx.proxyLog();
  const newest = await ctx.newestVersion(doc.id);
  const writesBeforeLift = commitPosts(log, doc.id).concat(uploadPosts(log, doc.id))
    .filter((e) => String(e.ts) < beforeLift && reachedUpstream(e));
  return {
    documentId: doc.id,
    assertions: [
      assertion("intent_minted_offline", "a trace line after Save", first ? first.to : "none", Boolean(first)),
      assertion("paused_offline_before_crash", "paused_offline", parked?.to ?? "never", Boolean(parked)),
      assertion("app_process_tree_killed", ">= 1 pid", killed, killed >= 1),
      oneIntent(lines),
      assertStatePath("client_path", lines, ["*", "paused_offline", "*", "validating", "*", "uploading", "*", "committing", "*", "committed"]),
      assertNeverState("no_terminal_failure", lines, [...NEVER, "conflict"]),
      assertion("committed_after_network_back", "committed", done?.to ?? "never", Boolean(done)),
      await deltaAssertion(ctx, doc.id, 1),
      assertion("version_is_snapshot_n", snapshotN, newest?.checksum_sha256 ?? null, Boolean(newest) && newest.checksum_sha256 === snapshotN),
      assertion("no_write_reached_server_before_rule_lifted", 0, writesBeforeLift.length, writesBeforeLift.length === 0),
      assertion("one_commit_200", 1, upstreamCommits(log, doc.id, 200).length, upstreamCommits(log, doc.id, 200).length === 1),
      sameKey(log, doc.id, { withUploads: true }),
    ],
  };
}

// ---- FQ-21: network cut during upload ---------------------------------------------------
async function fq21(ctx) {
  const { doc, session, opened } = await openFresh(ctx, { rules: ctx.caseRules(["cut-upload"]) });
  await editAndSave(ctx, session, opened, "U");
  const done = await ctx.waitState(doc.id, "committed", { timeout: 180_000 });
  const lines = ctx.trace(doc.id);
  const log = await ctx.proxyLog();
  const uploads = uploadPosts(log, doc.id);
  return {
    documentId: doc.id,
    assertions: [
      oneIntent(lines),
      assertStatePath("client_path", lines, ["*", "paused_offline|queued", "*", "committed"]),
      assertNeverState("no_terminal_failure", lines, [...NEVER, "conflict", "reconciling"]),
      assertion("committed", "committed", done?.to ?? "never", Boolean(done)),
      assertion("first_upload_reset_then_retried", "reset, then 201", uploads.map((e) => e.status).join(","), uploads[0]?.status === "reset" && uploads.some((e) => e.status === 201)),
      assertion("one_commit_200", 1, upstreamCommits(log, doc.id, 200).length, upstreamCommits(log, doc.id, 200).length === 1),
      sameKey(log, doc.id, { withUploads: true }),
      await deltaAssertion(ctx, doc.id, 1),
    ],
  };
}

// ---- FQ-22: timeout after commit, reconciled by lookup ---------------------------------
async function fq22(ctx) {
  const { doc, session, opened } = await openFresh(ctx, { rules: ctx.caseRules(["lose-commit-answer"]) });
  await editAndSave(ctx, session, opened, "T");
  const done = await ctx.waitState(doc.id, "committed", { timeout: 180_000 });
  const lines = ctx.trace(doc.id);
  const log = await ctx.proxyLog();
  const posts = commitPosts(log, doc.id);
  return {
    documentId: doc.id,
    assertions: [
      oneIntent(lines),
      assertStatePath("client_path", lines, ["*", "reconciling", "committed"]),
      assertion("committed", "committed", done?.to ?? "never", Boolean(done)),
      assertion("exactly_one_commit_post", 1, posts.length, posts.length === 1),
      assertion("lookup_after_lost_answer", ">= 1 GET versions/commit", commitLookups(log, doc.id).length, commitLookups(log, doc.id).length >= 1),
      sameKey(log, doc.id),
      await deltaAssertion(ctx, doc.id, 1),
    ],
  };
}

// ---- FQ-24: upload claim expired before the commit lands (predicted FAIL F4) -----------
async function fq24(ctx) {
  const { doc, session, opened } = await openFresh(ctx, { rules: ctx.caseRules(["hold-before-commit"]) });
  await editAndSave(ctx, session, opened, "C");
  const held = await ctx.waitHeld("hold-before-commit", 60_000);
  if (!held) return { documentId: doc.id, assertions: [assertion("commit_held", "held", "never", false)] };
  const expired = expireStagedClaims({ databaseUrl: ctx.databaseUrl, orgId: ctx.tenant.orgId });
  // a setup that did not age a claim proves nothing about F4: BLOCKED, not FAIL
  if (expired.blocker) {
    await ctx.release("hold-before-commit");
    return { documentId: doc.id, assertions: [], blocker: expired.blocker };
  }
  await ctx.release("hold-before-commit");
  const settled = await ctx.waitState(doc.id, ["committed", "reconciling-stuck", "conflict", "failed", "blocked"], { timeout: 180_000 });
  const lines = ctx.trace(doc.id);
  const log = await ctx.proxyLog();
  const posts = commitPosts(log, doc.id);
  const uploads = uploadPosts(log, doc.id).filter(reachedUpstream);
  return {
    documentId: doc.id,
    assertions: [
      assertion("claim_expired_in_run_db", ">= 1 row", expired.rows, expired.rows >= 1),
      assertion("first_commit_409_upload_invalid", 409, posts[0]?.status ?? null, posts[0]?.status === 409),
      oneIntent(lines),
      assertStatePath("client_path", lines, ["*", "reconciling", "queued", "*", "committed"]),
      assertion("settled_committed", "committed", settled?.to ?? "never", settled?.to === "committed"),
      assertion("reuploaded_after_fence", ">= 2 uploads reached the server", uploads.length, uploads.length >= 2),
      assertion("commit_200_after_reupload", "a 200 commit after the last upload",
        posts.map((e) => e.status).join(","),
        posts.some((e) => e.status === 200 && uploads.length > 0 && String(e.ts) > String(uploads[uploads.length - 1].ts))),
      await deltaAssertion(ctx, doc.id, 1),
    ],
  };
}

// ---- FQ-25: offline intent meets device B's version: conflict, no auto retry -------------
async function fq25(ctx) {
  const { doc, session, opened } = await openFresh(ctx, { rules: ctx.caseRules(["unreachable"]) });
  await editAndSave(ctx, session, opened, "O");
  const parked = await ctx.waitState(doc.id, "paused_offline", { timeout: 60_000 });
  const b = await deviceBCommit(ctx.tenant, doc.id, ctx.fixture);
  await ctx.clearRules();
  const conflict = await ctx.waitState(doc.id, "conflict", { timeout: 180_000 });
  await ctx.sleep(20_000);
  const lines = ctx.trace(doc.id);
  const log = await ctx.proxyLog();
  const appCommits = upstreamCommits(log, doc.id);
  return {
    documentId: doc.id,
    assertions: [
      assertion("paused_offline", "paused_offline", parked?.to ?? "never", Boolean(parked)),
      assertion("device_b_commit_200", 200, b.status, b.status === 200),
      assertStatePath("client_path", lines, ["*", "paused_offline", "*", "committing|queued", "*", "conflict"]),
      assertion("stays_in_conflict", "conflict (last state)", lines.at(-1)?.to ?? "none", Boolean(conflict) && lines.at(-1)?.to === "conflict"),
      assertion("one_app_commit_409_no_auto_retry", "1 commit, 409", appCommits.map((e) => e.status).join(",") || "none", appCommits.length === 1 && appCommits[0].status === 409),
      await deltaAssertion(ctx, doc.id, 1),
    ],
  };
}

// ---- FQ-40: the exits of reconciling -----------------------------------------------------
async function fq40(ctx) {
  const label = ctx.run.label;
  if (/committed/.test(label)) {
    const { doc, session, opened } = await openFresh(ctx, { rules: ctx.caseRules(["lose-commit-answer"]) });
    await editAndSave(ctx, session, opened, "R1");
    const done = await ctx.waitState(doc.id, "committed", { timeout: 180_000 });
    const lines = ctx.trace(doc.id);
    const log = await ctx.proxyLog();
    return {
      documentId: doc.id,
      assertions: [
        assertStatePath("client_path", lines, ["*", "reconciling", "committed"]),
        assertion("receipt", "committed", done?.to ?? "never", Boolean(done)),
        sameKey(log, doc.id),
        await deltaAssertion(ctx, doc.id, 1),
      ],
    };
  }
  if (/in_flight/.test(label)) {
    const { doc, session, opened } = await openFresh(ctx, { rules: ctx.caseRules(["lose-commit-answer", "fake-in-flight"]) });
    await editAndSave(ctx, session, opened, "R5");
    const done = await ctx.waitState(doc.id, "committed", { timeout: 240_000 });
    const lines = ctx.trace(doc.id);
    const log = await ctx.proxyLog();
    const lookups = commitLookups(log, doc.id);
    const inFlight = lines.filter((l) => l.from === "reconciling" && l.code === "in_flight");
    return {
      documentId: doc.id,
      assertions: [
        assertion("in_flight_kept_reconciling", "reconciling → reconciling on in_flight", inFlight.map((l) => `${l.from}→${l.to}`).join(",") || "no in_flight lookup traced",
          inFlight.length >= 1 && inFlight.every((l) => l.to === "reconciling")),
        assertion("looked_up_again", ">= 2 lookups", lookups.length, lookups.length >= 2 && lookups[0].status === "synthetic"),
        assertStatePath("client_path", lines, ["*", "reconciling", "*", "committed"]),
        assertion("receipt", "committed", done?.to ?? "never", Boolean(done)),
        sameKey(log, doc.id),
        await deltaAssertion(ctx, doc.id, 1),
      ],
    };
  }
  if (/paused_offline/.test(label)) {
    // the lookup cannot reach the server: the commit landed, its answer and the lookup are lost
    const lookupReset = ctx.ruleOf({ id: "lookup-reset", match: { method: "GET", path: "^/api/v1/documents/[^/]+/versions/commit$" }, action: { type: "reset" } });
    const { doc, session, opened } = await openFresh(ctx, { rules: [...ctx.caseRules(["lose-commit-answer"]), lookupReset] });
    const since = ctx.now();
    await editAndSave(ctx, session, opened, "R4");
    const reached = await ctx.waitState(doc.id, "paused_offline", { since, from: "reconciling", timeout: 120_000 });
    await ctx.sleep(10_000);
    const log = await ctx.proxyLog();
    const postsWhilePaused = logSince(commitPosts(log, doc.id), reached ? new Date(reached.ts).toISOString() : since);
    await ctx.clearRules();
    const done = await ctx.waitState(doc.id, "committed", { timeout: 180_000 });
    return {
      documentId: doc.id,
      assertions: [
        assertion("reconciling_to_paused_offline", "reconciling → paused_offline", reached ? `${reached.from}→${reached.to}` : "never", Boolean(reached)),
        assertion("no_commit_while_paused", 0, postsWhilePaused.length, postsWhilePaused.length === 0),
        assertion("receipt_after_network_back", "committed", done?.to ?? "never", Boolean(done)),
        sameKey(await ctx.proxyLog(), doc.id),
        await deltaAssertion(ctx, doc.id, 1),
      ],
    };
  }
  if (/paused_admin/.test(label)) {
    // office_sync_write turns off for the organization while the lookup is held
    const blocker = await ctx.ensureAdmin();
    if (blocker) return { documentId: null, assertions: [], blocker };
    const holdLookup = ctx.ruleOf({ id: "hold-lookup", match: { method: "GET", path: "^/api/v1/documents/[^/]+/versions/commit$", nth: 1 }, action: { type: "hold", until: "release" }, once: true });
    const { doc, session, opened } = await openFresh(ctx, { rules: [...ctx.caseRules(["lose-commit-answer"]), holdLookup] });
    const since = ctx.now();
    await editAndSave(ctx, session, opened, "R3");
    const held = await ctx.waitHeld("hold-lookup", 120_000);
    await ctx.setSyncWrite(false);
    await ctx.release("hold-lookup");
    const reached = await ctx.waitState(doc.id, "paused_admin", { since, timeout: 120_000 });
    await ctx.sleep(10_000);
    const log = await ctx.proxyLog();
    const postsWhilePaused = logSince(commitPosts(log, doc.id), reached ? new Date(reached.ts).toISOString() : since);
    await ctx.clearSyncWrite();
    const done = await ctx.waitState(doc.id, "committed", { timeout: 180_000 });
    return {
      documentId: doc.id,
      assertions: [
        assertion("lookup_held", "held", held ? "held" : "never", Boolean(held)),
        assertion("reconciling_to_paused_admin", "reconciling → paused_admin", reached ? `${reached.from}→${reached.to}` : "never", reached?.from === "reconciling"),
        assertion("no_commit_while_paused", 0, postsWhilePaused.length, postsWhilePaused.length === 0),
        assertion("receipt_after_capability_back", "committed", done?.to ?? "never", Boolean(done)),
        sameKey(await ctx.proxyLog(), doc.id),
        await deltaAssertion(ctx, doc.id, 1),
      ],
    };
  }
  // not_committed: device B commits first, the app's commit is refused after the
  // claim (409) and its answer is lost, so the lookup says not_committed (FQ-09)
  const { doc, session, opened } = await openFresh(ctx, { rules: ctx.caseRules(["lose-commit-answer"]) });
  await edit(opened, `${ctx.marker}R2`);
  const b = await deviceBCommit(ctx.tenant, doc.id, ctx.fixture);
  const since = ctx.now();
  await save(session, opened);
  const reached = await ctx.waitState(doc.id, "queued", { since, from: "reconciling", timeout: 120_000 });
  await ctx.waitState(doc.id, ["conflict", "committed"], { since, timeout: 120_000 });
  const lines = ctx.trace(doc.id);
  const log = await ctx.proxyLog();
  const lookup = commitLookups(log, doc.id).find(reachedUpstream);
  return {
    documentId: doc.id,
    assertions: [
      assertion("device_b_commit_200", 200, b.status, b.status === 200),
      assertion("lookup_answered_by_server", 200, lookup?.status ?? "none", lookup?.status === 200),
      assertion("reconciling_to_queued", "reconciling → queued", reached ? `${reached.from}→${reached.to}` : "never", Boolean(reached)),
      assertion("new_attempt_same_key", ">= 2 commit POSTs", commitPosts(log, doc.id).length, commitPosts(log, doc.id).length >= 2),
      sameKey(log, doc.id),
      assertNeverState("no_terminal_failure", lines, NEVER),
      await deltaAssertion(ctx, doc.id, 1),
    ],
  };
}

// ---- FQ-41: lookup says unknown (410) -> reconciling-stuck, never queued ------------------
async function fq41(ctx) {
  const { doc, session, opened } = await openFresh(ctx, { rules: ctx.caseRules(["drop-commit"]) });
  await editAndSave(ctx, session, opened, "S");
  const stuck = await ctx.waitState(doc.id, "reconciling-stuck", { timeout: 180_000 });
  const stuckAt = ctx.now();
  await ctx.sleep(20_000);
  const lines = ctx.trace(doc.id);
  const log = await ctx.proxyLog();
  const lookup410 = commitLookups(log, doc.id).find((e) => e.status === 410);
  const postsAfter = logSince(commitPosts(log, doc.id), stuckAt);
  return {
    documentId: doc.id,
    assertions: [
      assertStatePath("client_path", lines, ["*", "reconciling", "reconciling-stuck"]),
      assertion("stuck", "reconciling-stuck", stuck?.to ?? "never", Boolean(stuck)),
      assertEntersWithCode("unknown_lookup", lines, "reconciling-stuck", "commit_intent_unknown"),
      assertion("lookup_410_from_server", 410, lookup410?.status ?? "none", Boolean(lookup410)),
      assertNeverState("never_queued_again", lines.filter((l) => l.from === "reconciling" || l.from === "reconciling-stuck"), ["queued"]),
      assertion("no_commit_after_stuck", 0, postsAfter.length, postsAfter.length === 0),
      await deltaAssertion(ctx, doc.id, 0),
    ],
  };
}

// ---- FQ-42: no verdict for stuckAfterMs -> reconciling-stuck (F-clock knob) ---------------
export const FQ42_STUCK_AFTER_MS = 20_000;
async function fq42(ctx) {
  const { doc, session, opened } = await openFresh(ctx, {
    rules: ctx.caseRules(["drop-commit", "always-in-flight"]),
    launch: { stuckAfterMs: FQ42_STUCK_AFTER_MS },
  });
  await editAndSave(ctx, session, opened, "K");
  const stuck = await ctx.waitState(doc.id, "reconciling-stuck", { timeout: 240_000 });
  const lines = ctx.trace(doc.id);
  const log = await ctx.proxyLog();
  const entered = lines.find((l) => l.to === "reconciling");
  const waitedMs = entered && stuck ? Date.parse(stuck.ts) - Date.parse(entered.ts) : null;
  return {
    documentId: doc.id,
    assertions: [
      assertStatePath("client_path", lines, ["*", "reconciling", "*", "reconciling-stuck"]),
      assertion("stuck_after_the_knob", `>= ${FQ42_STUCK_AFTER_MS - 1_000} ms in reconciling`, waitedMs, waitedMs !== null && waitedMs >= FQ42_STUCK_AFTER_MS - 1_000),
      assertion("only_the_first_commit_post", 1, commitPosts(log, doc.id).length, commitPosts(log, doc.id).length === 1),
      assertion("last_state_stuck", "reconciling-stuck", lines.at(-1)?.to ?? "none", lines.at(-1)?.to === "reconciling-stuck"),
      await deltaAssertion(ctx, doc.id, 0),
    ],
  };
}

export const QUEUE_DRIVERS = { "FQ-20": fq20, "FQ-21": fq21, "FQ-22": fq22, "FQ-24": fq24, "FQ-25": fq25, "FQ-40": fq40, "FQ-41": fq41, "FQ-42": fq42 };
