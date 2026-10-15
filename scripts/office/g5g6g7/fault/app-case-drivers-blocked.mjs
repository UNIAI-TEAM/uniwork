// Case drivers of the G7-03a app-layer fault runner (UNI-1380, WI-4), part 2:
// `blocked` and `reconciling-stuck` (FQ-43, 44, 50, 51, 53). Part 1 and the
// shared helpers are app-case-drivers.mjs. Blocked reasons ride on the trace
// line's `code` (fork test-hooks/trace.ts: `record.lastError`), so each exit
// asserts `blocked:<reason>` exactly as EXPERIENCE › Lý do bị chặn names it.

import { closeSync, openSync, ftruncateSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  SYNC_STORE_BUDGET_BYTES, assertEntersWithCode, assertNeverState, assertStatePath, assertion, commitLookups,
  commitPosts, logSince, reachedUpstream, syncStoreScopeDir, uploadPosts,
} from "./app-cases-lib.mjs";
import { countAssertion, deltaAssertion, editAndSave, oneIntent, openFresh, pathAssertion, sameKey } from "./app-case-drivers.mjs";
import { docStatus, edit, save, signIn, signOut } from "./app-session.mjs";
import {
  archiveDocument, deactivateApp, readdAppToWorkspace, reactivateApp, removeAppFromWorkspace, restoreDocument,
  suspendOrg, unsuspendOrg,
} from "./app-tenant.mjs";

/** The blocked reason an exit label names ("reconciling → blocked member_deactivated" -> member_deactivated). */
export function reasonOf(label) {
  const match = /(session_expired|organization_suspended|member_deactivated|document_archived|permission_revoked|document_deleted|signed_out|foreign_account|store_full)/.exec(String(label));
  return match ? match[1] : null;
}

/**
 * Real server conditions: `set` before the app meets them, `lift` after. The
 * archived and deleted exits both use the trash (`/archive`): the server has
 * one archive state and answers 410 document_deleted for it (OQ-F6).
 */
const CONDITIONS = {
  permission_revoked: { set: (ctx) => removeAppFromWorkspace(ctx.tenant), lift: (ctx) => readdAppToWorkspace(ctx.tenant) },
  document_deleted: { set: (ctx, doc) => archiveDocument(ctx.tenant, doc), lift: (ctx, doc) => restoreDocument(ctx.tenant, doc) },
  document_archived: { set: (ctx, doc) => archiveDocument(ctx.tenant, doc), lift: (ctx, doc) => restoreDocument(ctx.tenant, doc) },
  member_deactivated: { set: (ctx) => deactivateApp(ctx.tenant), lift: (ctx) => reactivateApp(ctx.tenant) },
  organization_suspended: { admin: true, set: (ctx) => suspendOrg(ctx.tenant), lift: (ctx) => unsuspendOrg(ctx.tenant) },
};

/** FQ-43's extra runs with the real condition on the server instead of a synthetic status. */
export const EXTRA_EXITS = {
  "FQ-43": [
    { exit: "real: reconciling → blocked organization_suspended", real: true },
    { exit: "real: reconciling → blocked member_deactivated", real: true },
    { exit: "real: reconciling → blocked document_deleted", real: true },
  ],
};

const HOLD_LOOKUP = { id: "hold-lookup", match: { method: "GET", path: "^/api/v1/documents/[^/]+/versions/commit$", nth: 1 }, action: { type: "hold", until: "release" }, once: true };

/** Lifts a condition and never lets a failed lift pass silently (the next case would inherit it). */
async function lift(ctx, condition, docId, notes) {
  try {
    await condition.lift(ctx, docId);
  } catch (error) {
    notes.push(assertion("condition_lifted", "lifted", error.message, false));
  }
}

// ---- FQ-43: reconciling -> blocked by the lookup's answer ---------------------------------
async function fq43(ctx) {
  const reason = reasonOf(ctx.run.label);
  const real = Boolean(ctx.run.exit?.real);
  const condition = CONDITIONS[reason];
  if (real && condition?.admin) {
    const blocker = await ctx.ensureAdmin();
    if (blocker) return { documentId: null, assertions: [], blocker };
  }
  const rules = real ? [...ctx.caseRules(["lose-commit-answer"]), ctx.ruleOf(HOLD_LOOKUP)] : ctx.caseRules(["lose-commit-answer", "lookup-verdict"]);
  const { doc, session, opened } = await openFresh(ctx, { rules });
  const notes = [];
  await editAndSave(ctx, session, opened, `B${ctx.run.index}`);
  if (real) {
    const held = await ctx.waitHeld("hold-lookup", 120_000);
    notes.push(assertion("lookup_held", "held", held ? "held" : "never", Boolean(held)));
    await condition.set(ctx, doc.id);
    await ctx.release("hold-lookup");
  }
  const blocked = await ctx.waitState(doc.id, "blocked", { timeout: 120_000 });
  const blockedAt = blocked ? new Date(blocked.ts).toISOString() : ctx.now();
  await ctx.sleep(10_000);
  const lines = ctx.trace(doc.id);
  const log = await ctx.proxyLog();
  const postsAfter = logSince(commitPosts(log, doc.id), blockedAt);
  if (real) await lift(ctx, condition, doc.id, notes);
  return {
    documentId: doc.id,
    assertions: [
      ...notes,
      pathAssertion(ctx, lines),
      assertEntersWithCode("blocked_reason", lines, "blocked", reason),
      countAssertion(ctx, "no_commit_after_blocked", "commitPostsAfterStop", postsAfter.length),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

// ---- FQ-44: reconciling-stuck rechecks without a new attempt -------------------------------
export const FQ44_RECHECK_MS = 5_000;
async function fq44(ctx) {
  const label = ctx.run.label;
  const stays = /ở lại/.test(label);
  const unknownRule = stays ? "always-unknown" : "fake-unknown";
  const unknown = stays
    ? ctx.ruleOf({ id: "always-unknown", match: { method: "GET", path: "^/api/v1/documents/[^/]+/versions/commit$" }, action: { type: "status", code: 410, body: { error: { code: "commit_intent_unknown" } } } })
    : ctx.caseRules([unknownRule])[0];
  const { doc, session, opened } = await openFresh(ctx, {
    rules: [...ctx.caseRules(["lose-commit-answer"]), unknown],
    launch: { recheckMs: FQ44_RECHECK_MS },
  });
  await editAndSave(ctx, session, opened, `K${ctx.run.index}`);
  const stuck = await ctx.waitState(doc.id, "reconciling-stuck", { timeout: 180_000 });
  const stuckAt = stuck ? new Date(stuck.ts).toISOString() : ctx.now();
  const out = [assertion("stuck", "reconciling-stuck", stuck?.to ?? "never", Boolean(stuck))];
  if (/committed/.test(label)) {
    const done = await ctx.waitState(doc.id, "committed", { timeout: 120_000 });
    out.push(assertion("stuck_to_committed", "reconciling-stuck → committed", done ? `${done.from}→${done.to}` : "never", done?.from === "reconciling-stuck"));
  } else if (/blocked/.test(label)) {
    await ctx.setRules([ctx.ruleOf({ id: "lookup-forbidden", match: { method: "GET", path: "^/api/v1/documents/[^/]+/versions/commit$" }, action: { type: "status", code: 403, body: { error: { code: "forbidden" } } } })]);
    const blocked = await ctx.waitState(doc.id, "blocked", { timeout: 120_000 });
    out.push(assertion("stuck_to_blocked", "reconciling-stuck → blocked", blocked ? `${blocked.from}→${blocked.to}` : "never", blocked?.from === "reconciling-stuck"));
    out.push(assertEntersWithCode("blocked_reason", ctx.trace(doc.id), "blocked", "permission_revoked"));
  } else {
    await ctx.sleep(FQ44_RECHECK_MS * 5);
    const lines = ctx.trace(doc.id);
    const lookupsAfter = logSince(commitLookups(await ctx.proxyLog(), doc.id), stuckAt);
    out.push(assertion("still_stuck", "reconciling-stuck", lines.at(-1)?.to ?? "none", lines.at(-1)?.to === "reconciling-stuck"));
    out.push(countAssertion(ctx, "rechecked", "commitLookupsAfterStuckMin", lookupsAfter.length));
  }
  const log = await ctx.proxyLog();
  const postsAfter = logSince(commitPosts(log, doc.id), stuckAt);
  const uploadsAfter = logSince(uploadPosts(log, doc.id), stuckAt);
  return {
    documentId: doc.id,
    assertions: [
      ...out,
      oneIntent(ctx, ctx.trace(doc.id)),
      countAssertion(ctx, "no_commit_after_stuck", "commitPostsAfterStop", postsAfter.length),
      countAssertion(ctx, "no_upload_after_stuck", "uploadPostsAfterStop", uploadsAfter.length),
      sameKey(ctx, log, doc.id),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

// ---- FQ-50: blocked -> queued when the server lifts the reason -----------------------------
async function fq50(ctx) {
  const reason = reasonOf(ctx.run.label);
  const condition = CONDITIONS[reason];
  if (condition.admin) {
    const blocker = await ctx.ensureAdmin();
    if (blocker) return { documentId: null, assertions: [], blocker };
  }
  const { doc, session, opened } = await openFresh(ctx);
  const notes = [];
  await edit(opened, `${ctx.marker}L${ctx.run.index}`);
  await condition.set(ctx, doc.id);
  const since = ctx.now();
  await save(session, opened);
  const blocked = await ctx.waitState(doc.id, "blocked", { since, timeout: 120_000 });
  await ctx.sleep(10_000);
  const liftAt = ctx.now();
  await lift(ctx, condition, doc.id, notes);
  const done = await ctx.waitState(doc.id, "committed", { since, timeout: 240_000 });
  const lines = ctx.trace(doc.id);
  const log = await ctx.proxyLog();
  const blockedAt = blocked ? new Date(blocked.ts).toISOString() : since;
  const whileBlocked = commitPosts(log, doc.id).filter((e) => String(e.ts) > blockedAt && String(e.ts) < liftAt);
  return {
    documentId: doc.id,
    assertions: [
      ...notes,
      assertEntersWithCode("blocked_reason", lines, "blocked", reason),
      pathAssertion(ctx, lines),
      assertion("committed_after_lift", "committed", done?.to ?? "never", Boolean(done)),
      countAssertion(ctx, "no_commit_while_blocked", "commitPostsWhileBlocked", whileBlocked.length),
      oneIntent(ctx, lines),
      sameKey(ctx, log, doc.id),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

// ---- FQ-51: session_expired / signed_out / foreign_account --------------------------------
async function fq51(ctx) {
  const reason = reasonOf(ctx.run.label);
  if (reason === "session_expired") {
    const { doc, session, opened } = await openFresh(ctx, { rules: ctx.caseRules(["fake-401"]) });
    const since = ctx.now();
    await editAndSave(ctx, session, opened, "E");
    const blocked = await ctx.waitState(doc.id, "blocked", { since, timeout: 120_000 });
    await signIn(session, ctx.tenant.apiOrigin, ctx.tenant.app);
    const done = await ctx.waitState(doc.id, "committed", { since, timeout: 180_000 });
    const lines = ctx.trace(doc.id);
    return {
      documentId: doc.id,
      assertions: [
        assertion("blocked", "blocked", blocked?.to ?? "never", Boolean(blocked)),
        assertEntersWithCode("blocked_reason", lines, "blocked", "session_expired"),
        pathAssertion(ctx, lines),
        assertion("committed_after_sign_in", "committed", done?.to ?? "never", Boolean(done)),
        sameKey(ctx, await ctx.proxyLog(), doc.id),
        await deltaAssertion(ctx, doc.id),
      ],
    };
  }
  // an intent parked offline, then the account signs out
  const { doc, session, opened } = await openFresh(ctx, { rules: [ctx.ruleOf({ id: "unreachable", match: { path: "^/api/v1/" }, action: { type: "reset" } })] });
  const since = ctx.now();
  await editAndSave(ctx, session, opened, "O");
  const parked = await ctx.waitState(doc.id, "paused_offline", { since, timeout: 60_000 });
  await ctx.clearRules();
  await signOut(session);
  const signedOut = await ctx.waitState(doc.id, "blocked", { since, timeout: 60_000 });
  const pre = [
    assertion("parked_offline", "paused_offline", parked?.to ?? "never", Boolean(parked)),
    assertEntersWithCode("blocked_signed_out", ctx.trace(doc.id), "blocked", "signed_out"),
  ];
  if (reason === "signed_out") {
    await signIn(session, ctx.tenant.apiOrigin, ctx.tenant.app);
    const done = await ctx.waitState(doc.id, "committed", { since, timeout: 180_000 });
    return {
      documentId: doc.id,
      assertions: [
        ...pre,
        assertion("committed_after_same_account", "committed", done?.to ?? "never", Boolean(done)),
        sameKey(ctx, await ctx.proxyLog(), doc.id),
        await deltaAssertion(ctx, doc.id),
      ],
    };
  }
  const foreignAt = ctx.now();
  await signIn(session, ctx.tenant.apiOrigin, ctx.tenant.foreign);
  await ctx.sleep(30_000);
  const log = logSince(await ctx.proxyLog(), foreignAt);
  const writes = [...commitPosts(log, doc.id), ...uploadPosts(log, doc.id)].filter(reachedUpstream);
  const after = ctx.trace(doc.id).filter((l) => String(l.ts) > foreignAt);
  return {
    documentId: doc.id,
    assertions: [
      ...pre,
      assertion("signed_out_entered_blocked", "blocked", signedOut?.to ?? "never", Boolean(signedOut)),
      countAssertion(ctx, "foreign_account_sends_nothing", "writesAfterForeignSignIn", writes.length),
      assertNeverState("foreign_account_never_dispatches", after, ["validating", "uploading", "committing", "committed"]),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

// ---- FQ-53: store full -> Save mints nothing; room again -> Save -> one intent --------------
async function fq53(ctx) {
  const { doc, session, opened } = await openFresh(ctx);
  const scope = syncStoreScopeDir(session.userDataDir, "default", ctx.tenant.app.userId);
  const filler = join(scope, "g7-03a-fault-filler.bin");
  mkdirSync(scope, { recursive: true });
  // sparse: the store's budget counts each file's size (fork store/layer.ts dirBytes)
  const fd = openSync(filler, "w");
  ftruncateSync(fd, SYNC_STORE_BUDGET_BYTES);
  closeSync(fd);
  const fullAt = ctx.now();
  await editAndSave(ctx, session, opened, "F");
  const refused = await ctx.waitFor(async () => {
    const s = await docStatus(session, opened.path);
    return s?.error === "store_full" ? s : null;
  }, 30_000);
  await ctx.sleep(5_000);
  const whileFull = ctx.trace(doc.id).filter((l) => String(l.ts) >= fullAt);
  const writesWhileFull = [...commitPosts(await ctx.proxyLog(), doc.id), ...uploadPosts(await ctx.proxyLog(), doc.id)];
  rmSync(filler, { force: true });
  const roomAt = ctx.now();
  await edit(opened, `${ctx.marker}F2`, 2);
  await save(session, opened);
  const done = await ctx.waitState(doc.id, "committed", { since: roomAt, timeout: 180_000 });
  const lines = ctx.trace(doc.id);
  return {
    documentId: doc.id,
    assertions: [
      assertion("save_refused_store_full", "status error store_full", refused?.error ?? "no store_full status", Boolean(refused)),
      assertion("no_intent_while_full", ctx.expect.clientIntentsWhileFull(), whileFull.length, whileFull.length === ctx.expect.clientIntentsWhileFull()),
      countAssertion(ctx, "no_request_while_full", "writesWhileFull", writesWhileFull.length),
      assertion("committed_after_room", "committed", done?.to ?? "never", Boolean(done)),
      oneIntent(ctx, lines),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

export const BLOCKED_DRIVERS = { "FQ-43": fq43, "FQ-44": fq44, "FQ-50": fq50, "FQ-51": fq51, "FQ-53": fq53 };
