// Case drivers of the G7-03a app-layer fault runner (UNI-1380, WI-4), part 1:
// crash, offline, timeout-after-commit, claim expiry, two-device conflict and
// the exits of `reconciling` (FQ-20, 21, 22, 24, 25, 40, 41, 42). Part 2 is
// app-case-drivers-blocked.mjs. Each driver acts on a fresh document through
// the app (app-session.mjs) and the D server (app-tenant.mjs), with the row's
// proxy rules from cases.json, and returns `{documentId, assertions, blocker?}`.
// Expectations are the matrix's (matrix.md §2), never the fork's behaviour of
// the day: a known gap stays a FAIL, tagged `predicted` by the runner. Every
// number, status and state path a driver compares is read from the row's
// `expect` in cases.json (`ctx.expect`, case-expect.mjs; review r1 R1-2): a
// driver holds the scenario, never a number of its own.

import {
  assertEntersWithCode, assertNeverState, assertStatePath, assertion, commitLookups, commitPosts,
  intentIdsOf, keyTagsOf, logSince, reachedUpstream, uploadPosts,
} from "./app-cases-lib.mjs";
import { crash, edit, openDocument, save } from "./app-session.mjs";
import { compareMeasure } from "./case-expect.mjs";
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

/** The version count the run added to the document, against `expect.server.versionDelta` of the run. */
export const deltaAssertion = async (ctx, docId) => {
  const expected = ctx.expect.versionDelta();
  const delta = await ctx.versionDelta(docId);
  return assertion("version_delta", expected, delta, delta === expected);
};

/** `expect.clientIntents` distinct intents in the trace. */
export const oneIntent = (ctx, lines) => {
  const expected = ctx.expect.clientIntents();
  const ids = intentIdsOf(lines);
  return assertion("one_intent", expected, ids.length, ids.length === expected);
};

/** The run's state path against `expect.clientPath`. */
export const pathAssertion = (ctx, lines) => assertStatePath("client_path", lines, ctx.expect.clientPath());

/** A proxy-log count against `expect.proxyLog[key]` (`<name>Min` = at least). */
export const countAssertion = (ctx, name, key, actual) => {
  const expected = ctx.expect.proxy(key);
  return assertion(name, /Min$/.test(key) ? `>= ${expected}` : expected, actual, compareMeasure(key, expected, actual));
};

/** Every commit POST and commit lookup of the document carries `expect.proxyLog.keyTags` keyTag(s) (no replacement key). */
export const sameKey = (ctx, log, docId, { withUploads = false } = {}) => {
  const expected = ctx.expect.proxy("keyTags");
  const entries = [...commitPosts(log, docId), ...commitLookups(log, docId), ...(withUploads ? uploadPosts(log, docId) : [])];
  const tags = keyTagsOf(entries);
  return assertion(withUploads ? "one_key_uploads_and_commits" : "one_key_for_commits", expected, `${tags.length} keyTag(s) over ${entries.length} request(s)`, tags.length === expected);
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
      oneIntent(ctx, lines),
      pathAssertion(ctx, lines),
      assertNeverState("no_terminal_failure", lines, [...NEVER, "conflict"]),
      assertion("committed_after_network_back", "committed", done?.to ?? "never", Boolean(done)),
      await deltaAssertion(ctx, doc.id),
      assertion("version_is_snapshot_n", snapshotN, newest?.checksum_sha256 ?? null, Boolean(newest) && newest.checksum_sha256 === snapshotN),
      countAssertion(ctx, "no_write_reached_server_before_rule_lifted", "writesBeforeRuleLifted", writesBeforeLift.length),
      countAssertion(ctx, "one_commit_200", "upstreamCommits200", upstreamCommits(log, doc.id, 200).length),
      sameKey(ctx, log, doc.id, { withUploads: true }),
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
  const first = ctx.expect.status("first_upload");
  const retried = ctx.expect.status("retry_upload");
  return {
    documentId: doc.id,
    assertions: [
      oneIntent(ctx, lines),
      pathAssertion(ctx, lines),
      assertNeverState("no_terminal_failure", lines, [...NEVER, "conflict", "reconciling"]),
      assertion("committed", "committed", done?.to ?? "never", Boolean(done)),
      assertion("first_upload_reset_then_retried", `${first}, then ${retried}`, uploads.map((e) => e.status).join(","), uploads[0]?.status === first && uploads.some((e) => e.status === retried)),
      countAssertion(ctx, "one_commit_200", "upstreamCommits200", upstreamCommits(log, doc.id, 200).length),
      sameKey(ctx, log, doc.id, { withUploads: true }),
      await deltaAssertion(ctx, doc.id),
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
  const lookup = commitLookups(log, doc.id).find(reachedUpstream);
  return {
    documentId: doc.id,
    assertions: [
      oneIntent(ctx, lines),
      pathAssertion(ctx, lines),
      assertion("committed", "committed", done?.to ?? "never", Boolean(done)),
      countAssertion(ctx, "exactly_one_commit_post", "commitPosts", posts.length),
      countAssertion(ctx, "lookup_after_lost_answer", "commitLookupsMin", commitLookups(log, doc.id).length),
      assertion("lookup_answered", ctx.expect.lookup().status, lookup?.status ?? "none", lookup?.status === ctx.expect.lookup().status),
      sameKey(ctx, log, doc.id),
      await deltaAssertion(ctx, doc.id),
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
      assertion("first_commit_409_upload_invalid", ctx.expect.status("first_commit"), posts[0]?.status ?? null, posts[0]?.status === ctx.expect.status("first_commit")),
      oneIntent(ctx, lines),
      pathAssertion(ctx, lines),
      assertion("settled_committed", "committed", settled?.to ?? "never", settled?.to === "committed"),
      countAssertion(ctx, "reuploaded_after_fence", "uploadPostsReachedUpstreamMin", uploads.length),
      assertion("commit_200_after_reupload", `a ${ctx.expect.status("final_commit")} commit after the last upload`,
        posts.map((e) => e.status).join(","),
        posts.some((e) => e.status === ctx.expect.status("final_commit") && uploads.length > 0 && String(e.ts) > String(uploads[uploads.length - 1].ts))),
      await deltaAssertion(ctx, doc.id),
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
      assertion("device_b_commit_200", ctx.expect.status("device_b_commit"), b.status, b.status === ctx.expect.status("device_b_commit")),
      pathAssertion(ctx, lines),
      assertion("stays_in_conflict", "conflict (last state)", lines.at(-1)?.to ?? "none", Boolean(conflict) && lines.at(-1)?.to === "conflict"),
      assertion("one_app_commit_409_no_auto_retry", `${ctx.expect.proxy("appCommitPosts")} commit, ${ctx.expect.status("app_commit")}`, appCommits.map((e) => e.status).join(",") || "none",
        appCommits.length === ctx.expect.proxy("appCommitPosts") && appCommits.every((e) => e.status === ctx.expect.status("app_commit"))),
      await deltaAssertion(ctx, doc.id),
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
        pathAssertion(ctx, lines),
        assertion("receipt", "committed", done?.to ?? "never", Boolean(done)),
        sameKey(ctx, log, doc.id),
        await deltaAssertion(ctx, doc.id),
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
        assertion("looked_up_again", `>= ${ctx.expect.proxy("commitLookupsMin")} lookups, the first synthetic`, lookups.length, compareMeasure("commitLookupsMin", ctx.expect.proxy("commitLookupsMin"), lookups.length) && lookups[0].status === "synthetic"),
        pathAssertion(ctx, lines),
        assertion("receipt", "committed", done?.to ?? "never", Boolean(done)),
        sameKey(ctx, log, doc.id),
        await deltaAssertion(ctx, doc.id),
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
        countAssertion(ctx, "no_commit_while_paused", "commitPostsWhilePaused", postsWhilePaused.length),
        assertion("receipt_after_network_back", "committed", done?.to ?? "never", Boolean(done)),
        sameKey(ctx, await ctx.proxyLog(), doc.id),
        await deltaAssertion(ctx, doc.id),
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
        countAssertion(ctx, "no_commit_while_paused", "commitPostsWhilePaused", postsWhilePaused.length),
        assertion("receipt_after_capability_back", "committed", done?.to ?? "never", Boolean(done)),
        sameKey(ctx, await ctx.proxyLog(), doc.id),
        await deltaAssertion(ctx, doc.id),
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
      assertion("device_b_commit_200", ctx.expect.status("device_b_commit"), b.status, b.status === ctx.expect.status("device_b_commit")),
      assertion("lookup_answered_by_server", ctx.expect.lookup().status, lookup?.status ?? "none", lookup?.status === ctx.expect.lookup().status),
      assertion("reconciling_to_queued", "reconciling → queued", reached ? `${reached.from}→${reached.to}` : "never", Boolean(reached)),
      countAssertion(ctx, "new_attempt_same_key", "commitPostsMin", commitPosts(log, doc.id).length),
      sameKey(ctx, log, doc.id),
      assertNeverState("no_terminal_failure", lines, NEVER),
      await deltaAssertion(ctx, doc.id),
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
  const lookup410 = commitLookups(log, doc.id).find((e) => e.status === ctx.expect.lookup().status);
  const postsAfter = logSince(commitPosts(log, doc.id), stuckAt);
  return {
    documentId: doc.id,
    assertions: [
      pathAssertion(ctx, lines),
      assertion("stuck", "reconciling-stuck", stuck?.to ?? "never", Boolean(stuck)),
      assertEntersWithCode("unknown_lookup", lines, "reconciling-stuck", ctx.expect.lookup().errorCode),
      assertion("lookup_410_from_server", ctx.expect.lookup().status, lookup410?.status ?? "none", Boolean(lookup410)),
      assertNeverState("never_queued_again", lines.filter((l) => l.from === "reconciling" || l.from === "reconciling-stuck"), ["queued"]),
      countAssertion(ctx, "no_commit_after_stuck", "commitPostsAfterStop", postsAfter.length),
      await deltaAssertion(ctx, doc.id),
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
      pathAssertion(ctx, lines),
      assertion("stuck_after_the_knob", `>= ${FQ42_STUCK_AFTER_MS - 1_000} ms in reconciling`, waitedMs, waitedMs !== null && waitedMs >= FQ42_STUCK_AFTER_MS - 1_000),
      countAssertion(ctx, "only_the_first_commit_post", "commitPosts", commitPosts(log, doc.id).length),
      assertion("last_state_stuck", "reconciling-stuck", lines.at(-1)?.to ?? "none", lines.at(-1)?.to === "reconciling-stuck"),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

export const QUEUE_DRIVERS = { "FQ-20": fq20, "FQ-21": fq21, "FQ-22": fq22, "FQ-24": fq24, "FQ-25": fq25, "FQ-40": fq40, "FQ-41": fq41, "FQ-42": fq42 };
