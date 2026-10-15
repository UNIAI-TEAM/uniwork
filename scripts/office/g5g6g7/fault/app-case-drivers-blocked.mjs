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
import { accountStatus, docStatus, edit, save, signIn, signOut, signedOutFacts } from "./app-session.mjs";
import {
  archiveDocument, deactivateApp, reactivateApp, restoreDocument, setDocumentVisibility, shareDocumentLevel, suspendOrg, unsuspendOrg,
} from "./app-tenant.mjs";

/** The blocked reason an exit label names ("reconciling → blocked member_deactivated" -> member_deactivated). */
export function reasonOf(label) {
  const match = /(session_expired|organization_suspended|member_deactivated|document_archived|permission_revoked|document_deleted|signed_out|foreign_account|store_full)/.exec(String(label));
  return match ? match[1] : null;
}

/**
 * Real server conditions: `prepare` runs before the app opens the document (when
 * the open itself needs the condition), `set` before the app meets it, `lift`
 * after. The archived and deleted exits both use the trash (`/archive`): the
 * server has one archive state and answers 410 document_deleted for it (OQ-F6).
 *
 * `permission_revoked` is a downgrade of the app's own write permission, not a
 * workspace-member removal: EXPERIENCE › Save pill (:178) "quyền giảm … dispatch
 * gặp 403 → blocked permission_revoked", and the client reads that label from a
 * 403 `forbidden` (fork errors.ts:130). A member removal answers 404 not_found by
 * the product rule (a non-member never learns an id exists:
 * document_permissions.go:290-301) and can never produce the row's label, so the
 * document goes `restricted` with the app's own `edit` share and only that share
 * moves: as a workspace member the app reads it (share) but the member edit path
 * no longer applies (resolveLevelInTenant :136-144), and an upload then asks for
 * edit it does not hold -> 403 forbidden.
 */
export const CONDITIONS = {
  permission_revoked: {
    prepare: async (ctx, docId) => {
      await setDocumentVisibility(ctx.tenant, docId, "restricted");
      await shareDocumentLevel(ctx.tenant, docId, "edit");
    },
    set: (ctx, docId) => shareDocumentLevel(ctx.tenant, docId, "view"),
    lift: (ctx, docId) => shareDocumentLevel(ctx.tenant, docId, "edit"),
  },
  document_deleted: { set: (ctx, doc) => archiveDocument(ctx.tenant, doc), lift: (ctx, doc) => restoreDocument(ctx.tenant, doc) },
  document_archived: { set: (ctx, doc) => archiveDocument(ctx.tenant, doc), lift: (ctx, doc) => restoreDocument(ctx.tenant, doc) },
  member_deactivated: { set: (ctx) => deactivateApp(ctx.tenant), lift: (ctx) => reactivateApp(ctx.tenant) },
  organization_suspended: { admin: true, set: (ctx) => suspendOrg(ctx.tenant), lift: (ctx) => unsuspendOrg(ctx.tenant) },
};

/** FQ-43's extra runs with the real condition on the server instead of a synthetic status; they also reach reconciling first, so they carry the same predicted OQ-F11 (Advisor qa-fault_local:23). */
export const EXTRA_EXITS = {
  "FQ-43": [
    { exit: "real: reconciling → blocked organization_suspended", real: true, predicted: "OQ-F11" },
    { exit: "real: reconciling → blocked member_deactivated", real: true, predicted: "OQ-F11" },
    { exit: "real: reconciling → blocked document_deleted", real: true, predicted: "OQ-F11" },
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
  // `prepare` is the condition the app's own open needs (permission_revoked's
  // restricted visibility + edit share); the others open an ordinary document
  const { doc, session, opened } = await openFresh(ctx, { prepare: condition.prepare ?? null });
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
/** The two rules that make the session really expire: a dead commit answer and a dead refresh (FIX-15). */
export const FQ51_SESSION_RULES = ["fake-401", "fake-refresh-401"];
async function fq51(ctx) {
  const reason = reasonOf(ctx.run.label);
  if (reason === "session_expired") {
    // Both rules are needed for the session to really expire: the commit answers
    // 401 (`fake-401`) and the refresh it triggers is the server's own dead-device
    // verdict (`fake-refresh-401`). With the refresh still succeeding (cloud 12c)
    // the app renewed its token silently and committed 30 ms later, so this exit
    // never reached re-auth and died as an infra FAIL on the empty login URL.
    const { doc, session, opened } = await openFresh(ctx, { rules: ctx.caseRules(FQ51_SESSION_RULES) });
    const since = ctx.now();
    await editAndSave(ctx, session, opened, "E");
    const blocked = await ctx.waitState(doc.id, "blocked", { since, timeout: 120_000 });
    // the re-auth below only means something on a dead session: while the app is
    // still signed in accountLogin() opens no browser leg, the login URL never
    // comes, and the exit reports an infra FAIL instead of the product's own
    // session_expired verdict (which is what `signed_out_before_sign_in` reads).
    const account = await accountStatus(session);
    const signedOut = account?.loggedIn === false;
    const done = signedOut
      ? await (async () => {
        await signIn(session, ctx.tenant.apiOrigin, ctx.tenant.app);
        return ctx.waitState(doc.id, "committed", { since, timeout: 180_000 });
      })()
      : null;
    const lines = ctx.trace(doc.id);
    return {
      documentId: doc.id,
      assertions: [
        assertion("blocked", "blocked", blocked?.to ?? "never", Boolean(blocked)),
        assertEntersWithCode("blocked_reason", lines, "blocked", "session_expired"),
        assertion("signed_out_before_sign_in", "the app is not logged in", account?.state ?? "unknown", signedOut),
        pathAssertion(ctx, lines),
        assertion("committed_after_sign_in", "committed", done?.to ?? "never", Boolean(done)),
        sameKey(ctx, await ctx.proxyLog(), doc.id),
        await deltaAssertion(ctx, doc.id),
      ],
    };
  }
  // An intent parked offline, then the account signs out. G5-11 locks the
  // session at sign-out: the queue session is stopped and its in-flight records
  // are parked (uniwork-docs/service.ts:1936-2050), every working copy of the
  // account is locked with reason `signed_out` (service.ts:2651-2666,
  // EXPERIENCE › Lý do bị chặn :149) and the sync center reports the
  // signed-out summary (sync-center.ts:1184-1200). The reason is a LOCK reason,
  // not a queue code - `UniworkDocErrorCode` (home-api.ts:159-190) has no
  // `signed_out` and `BLOCKED_REASONS` (queue/machine.ts:125-137) maps none, so
  // the trace can never carry `blocked:signed_out`; the row's "blocked
  // signed_out" is asserted on the two surfaces that do carry it.
  const { doc, session, opened } = await openFresh(ctx, { rules: [ctx.ruleOf({ id: "unreachable", match: { path: "^/api/v1/" }, action: { type: "reset" } })] });
  const since = ctx.now();
  await editAndSave(ctx, session, opened, "O");
  const parked = await ctx.waitState(doc.id, "paused_offline", { since, timeout: 60_000 });
  // the network stays cut across the sign-out: a parked intent must not race the
  // lock and commit (r13's exits committed http=200 exactly that way while the
  // sign-out was still waiting on its prompt)
  await signOut(session);
  const lockedAt = ctx.now();
  const account = await accountStatus(session);
  const signedOutFactsNow = await signedOutFacts(session);
  await ctx.sleep(10_000);
  const whileSignedOut = [...commitPosts(await ctx.proxyLog(), doc.id), ...uploadPosts(await ctx.proxyLog(), doc.id)]
    .filter((e) => String(e.ts) >= lockedAt);
  const pre = [
    assertion("parked_offline", "paused_offline", parked?.to ?? "never", Boolean(parked)),
    assertion("signed_out_before_sign_in", "the app is not logged in", account?.state ?? "unknown", account?.loggedIn === false),
    assertion("signed_out_row_locked", "status signed_out with >= 1 locked item",
      `${signedOutFactsNow.status ?? signedOutFactsNow.error ?? "none"}/locked=${signedOutFactsNow.lockedCount ?? "-"}`,
      signedOutFactsNow.status === "signed_out" && Number.isInteger(signedOutFactsNow.lockedCount) && signedOutFactsNow.lockedCount >= 1),
    assertion("no_dispatch_while_signed_out", 0, whileSignedOut.length, whileSignedOut.length === 0),
  ];
  await ctx.clearRules();
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
  // sparse: the store's budget counts each file's size across the account's
  // scope (fork store/layer.ts dirBytes :220, the write gate :353), so the
  // filler only has to be SYNC_STORE_BUDGET_BYTES large, not to hold bytes
  // (G5-11 raised the budget to 1 GiB: the constant is the fork's, lib above)
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
