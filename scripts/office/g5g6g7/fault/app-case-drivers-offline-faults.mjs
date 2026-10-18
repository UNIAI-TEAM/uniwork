// Case drivers of the G7-03b W2 rows (UNI-1382): FL-02 disk full, FL-04a read-lease
// expiry, FL-05 clock moved back, FL-06 revoke while offline, FL-09 keystore
// locked. They sit on the helpers of app-case-drivers-offline.mjs (W1) and are
// registered beside OFFLINE_DRIVERS (app-cases.mjs); a row's numbers come from its
// `expect.offline` / `expect.proxyLog` in cases.json, never from this file.
//
// What the VM must give each row (a missing tool is BLOCKED with the exact runner
// line, never a PASS; `ctx.vm` is app-offline-env.mjs, replaced by fakes in tests):
//   FL-02  `sudo -n mount -t tmpfs` (root) - else the sparse fill (no root)
//   FL-05  libfaketime installed (apt-get install -y libfaketime)
//   FL-06  `go` + the run's DATABASE_URL (uniwork-admin revoke-offline-leases)
//   FL-09  the runner under `APP_KEYRING_CONTROL=1 … app-keyring.sh`
//   FL-04a nothing beyond the harness (proxy rewrite_json + cut rules)

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertion } from "./app-cases-lib.mjs";
import { countAssertion } from "./app-case-drivers.mjs";
import {
  INDEX_RECORD_NAME, OFFLINE_STATE_TIMEOUT_MS, armOpenCut, awaitRowState, captureRowShots, collectOfflineState, downloadNow, downloadRequests, libraryStoreDir,
  listPlaintextCopies, noWriteAssertions, offlineBoolAssertion, offlineCountAssertion, offlineFresh, offlineOpen, offlineSnapshot, pinDocument,
  pinRecordNames, preStoreAssertion, resultAssertion, rowOf, ruleHitAssertion, runGuarded, storeArgs, storeDelta, watchRowStatesOrBlocked,
  upstreamDownloads, withOfflineCapability, writeStoreEvidence,
} from "./app-case-drivers-offline.mjs";
import { deltaAssertion } from "./app-case-drivers.mjs";

const blocked = (blocker) => ({ documentId: null, assertions: [], blocker });

/** The S3 row of one document and its S11 lock reason, from a fresh snapshot (null fields when it cannot answer). */
const rowReading = async (session, documentId) => {
  const row = rowOf(await offlineSnapshot(session), documentId);
  return { state: row?.state ?? null, lockReason: row?.lockReason ?? null };
};

/** A refusal that names its code and the S11 reason: the pair the rows assert (an `ok` open never matches). */
const refusalAssertion = (ctx, name, opened, { lockReason = true } = {}) => {
  const codes = ctx.expect.offline("openRefusalCodes");
  const reason = lockReason ? ctx.expect.offline("lockReason") : null;
  const ok = opened?.ok === false && codes.includes(opened?.code) && (reason === null || opened?.lockReason === reason);
  const actual = opened?.ok === true ? "opened" : `${opened?.code ?? "no answer"}${opened?.lockReason ? ` / ${opened.lockReason}` : ""}`;
  return assertion(name, `${codes.join("|")}${reason ? ` / ${reason}` : ""}`, actual, ok);
};

/** A store slice (`drafts`, `offline-leases`, ...) must be unchanged between two readings: nothing removed or rewritten. */
const sliceUntouched = (before, after, store) => {
  const delta = storeDelta(
    { records: (before.records ?? []).filter((record) => record.store === store) },
    { records: (after.records ?? []).filter((record) => record.store === store) },
  );
  return delta.removed.length === 0 && delta.changed.length === 0;
};

// ---- FL-02: disk full while the library writes ----------------------------------------
async function fl02(ctx) {
  const mountMb = ctx.expect.offline("diskMountMb");
  const leave = ctx.expect.offline("diskLeaveBytes");
  const budget = ctx.expect.offline("layerBudgetBytes");
  const faulted = ctx.expect.offline("faultedStates");
  const recovered = ctx.expect.offline("recoveredStates");
  const blocker = await withOfflineCapability(ctx);
  if (blocker) return blocked(blocker);
  const userData = ctx.userDataDir();
  const vm = ctx.vm;
  // the mechanism, decided BEFORE the app launches: a tmpfs must be the userData the app starts on
  const probe = vm.probeTmpfsMount();
  const mount = probe.ok ? vm.mountTmpfs(userData, mountMb) : { ok: false, line: probe.line };
  const mechanism = mount.ok ? "tmpfs" : "sparse";
  const filler = { path: null };
  let session;
  try {
    const docA = await ctx.newDocument();
    const docB = await ctx.newDocument();
    session = await ctx.launch();
    const pinA = await pinDocument(session, { documentId: docA.id, workspaceId: ctx.tenant.workspaceId });
    const readyA = await awaitRowState(ctx, session, docA.id, ctx.expect.offline("firstLaunchStates"));
    const before = collectOfflineState(storeArgs(ctx, [docA.id, docB.id]));
    // the fault: a really full filesystem (tmpfs), or the library layer's own budget crossed
    let fill;
    if (mechanism === "tmpfs") {
      fill = vm.fillToLeave(userData, leave);
      filler.path = fill.path;
    } else {
      const scope = join(libraryStoreDir(userData, ctx.deploymentId(), ctx.tenant.app.userId), "..");
      fill = vm.sparseFill(scope, budget, leave);
      filler.path = fill.path;
    }
    const faultReal = mechanism === "tmpfs" ? fill.freeAfter <= leave + 4096 : fill.apparentBytes >= budget - leave;
    const pinB = await pinDocument(session, { documentId: docB.id, workspaceId: ctx.tenant.workspaceId });
    const watch = await watchRowStatesOrBlocked(ctx, session, docB.id, { until: faulted, timeout: OFFLINE_STATE_TIMEOUT_MS });
    const faultedState = collectOfflineState(storeArgs(ctx, [docA.id, docB.id]));
    const aReading = await rowReading(session, docA.id);
    const shots = await captureRowShots(ctx, session, { s3: true });
    // free the space and retry: the retry is the product's, the space is the VM's
    vm.releaseFill(filler.path);
    const retry = await downloadNow(session, docB.id);
    const recoveredRow = await awaitRowState(ctx, session, docB.id, recovered);
    const log = await ctx.proxyLog();
    const after = collectOfflineState(storeArgs(ctx, [docA.id, docB.id]));
    writeStoreEvidence(ctx.runDirOut(), { before, faulted: faultedState, after });
    writeFileSync(
      join(ctx.runDirOut(), "offline-disk-mechanism.json"),
      `${JSON.stringify({ mechanism, probe: probe.ok ? "sudo mount ok" : probe.line, mount: mount.ok ? "mounted" : mount.line ?? null, mountMb: mechanism === "tmpfs" ? mountMb : null, leaveBytes: leave, fill: mechanism === "tmpfs" ? { freeBefore: fill.freeBefore, freeAfter: fill.freeAfter } : { apparentBytes: fill.apparentBytes, budgetBytes: budget } }, null, 2)}\n`,
    );
    // everything the library held before B was pinned is A's (its pin row, its blobs) plus the shared index
    const aNames = new Set(before.library.map((record) => record.name));
    const toFault = storeDelta(before, faultedState);
    const bPinKey = `library/${pinRecordNames([docB.id])[0]}`;
    // nothing but B's own pin row (and the index that lists it) may have changed while faulted: no blob = nothing partial marked ready
    const strayAdded = toFault.added.filter((key) => key !== bPinKey);
    const aTouched = [...toFault.removed, ...toFault.changed].filter((key) => aNames.has(key.replace(/^library\//, "")) && key !== `library/${INDEX_RECORD_NAME}`);
    return {
      documentId: docB.id,
      assertions: [
        assertion("mechanism_reported", "tmpfs (real ENOSPC) or sparse (store_full)", `${mechanism}${mount.ok ? "" : ` - tmpfs not used: ${mount.line}`}`, true),
        assertion("fault_really_happened", mechanism === "tmpfs" ? `free <= ${leave} B (+1 page) on the userData filesystem` : `a sparse filler of ${budget - leave} B in the library scope`, mechanism === "tmpfs" ? `${fill.freeAfter} B free` : `${fill.apparentBytes} B apparent`, faultReal),
        resultAssertion("pin_a_accepted", pinA),
        assertion("a_ready_before_fault", ctx.expect.offline("firstLaunchStates").join("|"), readyA?.state ?? "never", Boolean(readyA)),
        preStoreAssertion(before, docA.id),
        resultAssertion("pin_b_accepted", pinB),
        assertion("b_row_faulted", faulted.join("|"), watch.states.join(" → ") || "(no row seen)", Boolean(watch.found)),
        assertion("b_never_ready_while_faulted", "never ready", watch.states.join(" → ") || "(no row seen)", !watch.states.includes("ready")),
        assertion("nothing_partial_in_the_store", "only B's pin row added while faulted (no blob)", strayAdded.length === 0 ? "pin row only" : strayAdded.join(", "), strayAdded.length === 0),
        offlineBoolAssertion(ctx, "kept_old_copy", "keptOldCopy", aReading.state === "ready" && aTouched.length === 0),
        resultAssertion("retry_accepted", retry),
        assertion("b_recovered_after_free_space", recovered.join("|"), recoveredRow?.state ?? "never", Boolean(recoveredRow)),
        countAssertion(ctx, "b_download_requests", "downloadRequestsMin", downloadRequests(log, docB.id).length),
        ...shots,
        ...noWriteAssertions(ctx, log, docB.id),
        await deltaAssertion(ctx, docB.id),
      ],
    };
  } finally {
    if (session) await ctx.close(session).catch(() => {});
    if (filler.path) vm.releaseFill(filler.path);
    if (mechanism === "tmpfs") vm.unmountTmpfs(userData);
  }
}

// ---- FL-04a: the read lease expires while the offline copy is open --------------------
async function fl04a(ctx) {
  const faulted = ctx.expect.offline("faultedStates");
  const recoveredStates = ctx.expect.offline("recoveredStates");
  const blocker = await withOfflineCapability(ctx);
  if (blocker) return blocked(blocker);
  // the lease the app is granted lives `ttlMs`, read from the rule the row carries (no number of this file's own)
  const shortLease = ctx.caseRules(["short-lease"]);
  const ttlMs = shortLease[0].action.patch.expires_at.now_plus_ms;
  const { doc, session } = await offlineFresh(ctx, { rules: shortLease });
  const pinned = await pinDocument(session, { documentId: doc.id, workspaceId: ctx.tenant.workspaceId });
  const ready = await awaitRowState(ctx, session, doc.id, ctx.expect.offline("firstLaunchStates"));
  const grantLog = await ctx.proxyLog();
  const before = collectOfflineState(storeArgs(ctx, [doc.id]));
  // offline from here: no renewal can extend the lease, and a Mở can only reach the cache
  await ctx.setRules(ctx.caseRules(["cut-lease", "cut-open"]));
  const openedBefore = await offlineOpen(session, doc.id);
  const expired = await awaitRowState(ctx, session, doc.id, faulted, { timeout: ttlMs + OFFLINE_STATE_TIMEOUT_MS });
  const reading = await rowReading(session, doc.id);
  const opened = await offlineOpen(session, doc.id);
  const shots = await captureRowShots(ctx, session, { s11: true, s3: true });
  const faultedState = collectOfflineState(storeArgs(ctx, [doc.id]));
  // the expiry is lifted by a real renewal: the network and the lease route are back
  await ctx.clearRules();
  const retry = await downloadNow(session, doc.id);
  const recovery = await awaitRowState(ctx, session, doc.id, recoveredStates);
  const log = await ctx.proxyLog();
  const after = collectOfflineState(storeArgs(ctx, [doc.id]));
  writeStoreEvidence(ctx.runDirOut(), { before, faulted: faultedState, after });
  return {
    documentId: doc.id,
    assertions: [
      resultAssertion("pin_accepted", pinned),
      assertion("first_launch_ready", ctx.expect.offline("firstLaunchStates").join("|"), ready?.state ?? "never", Boolean(ready)),
      // the short expiry really was served to the app: the rewrite rule's own log line
      ruleHitAssertion("lease_expiry_rewritten", grantLog, "short-lease", { documentId: doc.id }),
      assertion("open_served_before_expiry", "ok (the cached copy opens while the lease holds)", openedBefore?.ok === true ? "opened" : openedBefore?.code ?? "no answer", openedBefore?.ok === true),
      assertion("row_lease_expired", faulted.join("|"), expired?.state ?? "never", Boolean(expired)),
      assertion("row_names_the_lock_reason", ctx.expect.offline("lockReason"), reading.lockReason ?? "none", reading.lockReason === ctx.expect.offline("lockReason")),
      refusalAssertion(ctx, "open_refused_lease_expired", opened),
      offlineBoolAssertion(ctx, "content_not_served", "contentNotServed", opened?.ok === false),
      offlineBoolAssertion(ctx, "draft_kept", "draftKept", sliceUntouched(before, faultedState, "drafts")),
      resultAssertion("renew_accepted", retry),
      assertion("row_recovered_by_renewal", recoveredStates.join("|"), recovery?.state ?? "never", Boolean(recovery)),
      ...shots,
      ...noWriteAssertions(ctx, log, doc.id),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

// ---- FL-05: the wall clock is moved back across a restart -----------------------------
async function fl05(ctx) {
  const faulted = ctx.expect.offline("faultedStates");
  const recoveredStates = ctx.expect.offline("recoveredStates");
  const skewMinutes = ctx.expect.offline("clockSkewMinutes");
  // the VM precondition first: no libfaketime is BLOCKED, with the install line
  const lib = ctx.vm.findFaketime();
  if (lib.line) return blocked(lib.line);
  const blocker = await withOfflineCapability(ctx);
  if (blocker) return blocked(blocker);
  const { doc, session } = await offlineFresh(ctx);
  const pinned = await pinDocument(session, { documentId: doc.id, workspaceId: ctx.tenant.workspaceId });
  const ready = await awaitRowState(ctx, session, doc.id, ctx.expect.offline("firstLaunchStates"));
  const before = collectOfflineState(storeArgs(ctx, [doc.id]));
  await ctx.close(session);
  // the second launch runs `skewMinutes` behind the latest wall clock the first one saw
  const second = await ctx.launch({ requireSignIn: false, extraEnv: ctx.vm.faketimeEnv(lib.path, skewMinutes) });
  const signedIn = await ctx.waitSignedIn(second);
  const appNow = await second.app.evaluate(() => Date.now()).catch(() => null);
  const behindMs = typeof appNow === "number" ? Date.now() - appNow : null;
  await ctx.setRules(ctx.caseRules(["cut-lease", "cut-open"]));
  const boundary = (await ctx.proxyLog()).length;
  const opened = await offlineOpen(second, doc.id);
  const row = await awaitRowState(ctx, second, doc.id, faulted);
  const reading = await rowReading(second, doc.id);
  const shots = await captureRowShots(ctx, second, { s11: true, s3: true });
  const window = (await ctx.proxyLog()).slice(boundary);
  const faultedState = collectOfflineState(storeArgs(ctx, [doc.id]));
  const copies = listPlaintextCopies(ctx.userDataDir(), ctx.deploymentId(), { accountIds: [ctx.tenant.app.userId] });
  const leaseGrants = window.filter((entry) => entry.method === "PUT" && String(entry.path).endsWith("/office/offline-lease") && entry.status === 200);
  // the real clock back: the latched rollback lifts only through a successful online renewal
  await ctx.close(second);
  const third = await ctx.launch({ requireSignIn: false });
  await ctx.waitSignedIn(third);
  await ctx.clearRules();
  const retry = await downloadNow(third, doc.id);
  const recovery = await awaitRowState(ctx, third, doc.id, recoveredStates);
  const log = await ctx.proxyLog();
  const after = collectOfflineState(storeArgs(ctx, [doc.id]));
  writeStoreEvidence(ctx.runDirOut(), { before, faulted: faultedState, after });
  return {
    documentId: doc.id,
    assertions: [
      resultAssertion("pin_accepted", pinned),
      assertion("first_launch_ready", ctx.expect.offline("firstLaunchStates").join("|"), ready?.state ?? "never", Boolean(ready)),
      preStoreAssertion(before, doc.id),
      // the fault really happened: the app's own wall clock is behind the runner's
      assertion("wall_clock_moved_back", `>= ${skewMinutes} min behind (libfaketime, tolerance 1 min)`, behindMs === null ? "no answer" : `${(behindMs / 60_000).toFixed(1)} min`, behindMs !== null && behindMs >= (skewMinutes - 1) * 60_000),
      assertion("relaunch_signed_in", "signed in", signedIn ? "signed in" : "not signed in", Boolean(signedIn)),
      refusalAssertion(ctx, "open_refused_clock_rollback", opened),
      assertion("row_locked", faulted.join("|"), row?.state ?? "never", Boolean(row)),
      assertion("row_names_the_lock_reason", ctx.expect.offline("lockReason"), reading.lockReason ?? "none", reading.lockReason === ctx.expect.offline("lockReason")),
      offlineBoolAssertion(ctx, "content_not_served", "contentNotServed", opened?.ok === false),
      offlineCountAssertion(ctx, "no_plaintext_copy_materialized", "plaintextCopies", copies.length),
      // no renewal got through while the clock was back, and the lease record is untouched
      offlineBoolAssertion(ctx, "never_extends_lease", "neverExtendsLease", leaseGrants.length === 0 && sliceUntouched(before, faultedState, "offline-leases")),
      resultAssertion("retry_accepted", retry),
      assertion("row_recovered_after_real_clock", recoveredStates.join("|"), recovery?.state ?? "never", Boolean(recovery)),
      ...shots,
      ...noWriteAssertions(ctx, log, doc.id),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

// ---- FL-06: the lease is revoked on D while the app is offline ------------------------
async function fl06(ctx) {
  const faulted = ctx.expect.offline("faultedStates");
  const blocker = await withOfflineCapability(ctx);
  if (blocker) return blocked(blocker);
  const { doc, session } = await offlineFresh(ctx);
  const pinned = await pinDocument(session, { documentId: doc.id, workspaceId: ctx.tenant.workspaceId });
  const ready = await awaitRowState(ctx, session, doc.id, ctx.expect.offline("firstLaunchStates"));
  const before = collectOfflineState(storeArgs(ctx, [doc.id]));
  // offline: the proxy resets every /api/ request, then the lease is revoked on D
  await ctx.setRules(ctx.caseRules(["cut-network"]));
  const revokeFailure = await ctx.revokeOfflineLeases();
  if (revokeFailure) return blocked(revokeFailure);
  const boundary = (await ctx.proxyLog()).length;
  // back online: the next renew meets the revoked lease
  await ctx.clearRules();
  const retry = await downloadNow(session, doc.id);
  const row = await awaitRowState(ctx, session, doc.id, faulted);
  const window = (await ctx.proxyLog()).slice(boundary);
  const renews = window.filter((entry) => entry.method === "PUT" && String(entry.path).endsWith("/office/offline-lease"));
  const refusedStatus = ctx.expect.offline("renewRefusalStatus");
  // a Mở can only reach the cache now, which is what raises S11
  await armOpenCut(ctx);
  const opened = await offlineOpen(session, doc.id);
  const shots = await captureRowShots(ctx, session, { s11: true, s3: true });
  const faultedState = collectOfflineState(storeArgs(ctx, [doc.id]));
  const copies = listPlaintextCopies(ctx.userDataDir(), ctx.deploymentId(), { accountIds: [ctx.tenant.app.userId] });
  const log = await ctx.proxyLog();
  writeStoreEvidence(ctx.runDirOut(), { before, faulted: faultedState, after: faultedState });
  return {
    documentId: doc.id,
    assertions: [
      resultAssertion("pin_accepted", pinned),
      assertion("first_launch_ready", ctx.expect.offline("firstLaunchStates").join("|"), ready?.state ?? "never", Boolean(ready)),
      preStoreAssertion(before, doc.id),
      // the renewal after the revoke was refused: a PUT on the lease route answered the expected status
      assertion("renew_refused_after_revoke", `PUT offline-lease answered ${refusedStatus}`, renews.map((entry) => entry.status).join(",") || "(no renew seen)", renews.some((entry) => entry.status === refusedStatus)),
      assertion("retry_answered", "an answer (a refusal is expected)", retry?.ok === true ? "ok" : retry?.code ?? "no answer", Boolean(retry)),
      assertion("row_revoked", faulted.join("|"), row?.state ?? "never", Boolean(row)),
      refusalAssertion(ctx, "open_refused_permission_revoked", opened),
      offlineCountAssertion(ctx, "no_plaintext_copy_left", "plaintextCopies", copies.length),
      offlineBoolAssertion(ctx, "draft_kept", "draftKept", sliceUntouched(before, faultedState, "drafts")),
      ...shots,
      ...noWriteAssertions(ctx, log, doc.id),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

// ---- FL-09: the OS keystore is locked when the app starts -----------------------------
async function fl09(ctx) {
  const recoveredStates = ctx.expect.offline("recoveredStates");
  const unavailable = ctx.vm.keyring.available();
  if (unavailable) return blocked(unavailable);
  const blocker = await withOfflineCapability(ctx);
  if (blocker) return blocked(blocker);
  const { doc, session } = await offlineFresh(ctx);
  const pinned = await pinDocument(session, { documentId: doc.id, workspaceId: ctx.tenant.workspaceId });
  const ready = await awaitRowState(ctx, session, doc.id, ctx.expect.offline("firstLaunchStates"));
  const before = collectOfflineState(storeArgs(ctx, [doc.id]));
  await ctx.close(session);
  const lock = ctx.vm.keyring.lock();
  if (!lock.ok) return blocked(lock.line);
  try {
    const second = await ctx.launch({ requireSignIn: false });
    await armOpenCut(ctx);
    const boundary = (await ctx.proxyLog()).length;
    const opened = await offlineOpen(second, doc.id);
    const reading = await rowReading(second, doc.id);
    const shots = await captureRowShots(ctx, second, { s11: true, s3: true });
    const faultedState = collectOfflineState(storeArgs(ctx, [doc.id]));
    const window = (await ctx.proxyLog()).slice(boundary);
    const copies = listPlaintextCopies(ctx.userDataDir(), ctx.deploymentId(), { accountIds: [ctx.tenant.app.userId] });
    const delta = storeDelta(before, faultedState);
    const untouched = delta.added.length === 0 && delta.removed.length === 0 && delta.changed.length === 0;
    // unlock, then the user's retry: in the same app first, a relaunch when the process kept its failed keyring state
    const unlock = ctx.vm.keyring.unlock();
    await ctx.clearRules();
    let path = "in-app retry";
    let retry = await downloadNow(second, doc.id);
    let recovery = await awaitRowState(ctx, second, doc.id, recoveredStates, { timeout: Math.min(OFFLINE_STATE_TIMEOUT_MS, 30_000) });
    if (!recovery) {
      await ctx.close(second);
      const third = await ctx.launch({ requireSignIn: false });
      await ctx.waitSignedIn(third);
      path = "after relaunch";
      retry = await downloadNow(third, doc.id);
      recovery = await awaitRowState(ctx, third, doc.id, recoveredStates);
    }
    const log = await ctx.proxyLog();
    const after = collectOfflineState(storeArgs(ctx, [doc.id]));
    writeStoreEvidence(ctx.runDirOut(), { before, faulted: faultedState, after });
    return {
      documentId: doc.id,
      assertions: [
        resultAssertion("pin_accepted", pinned),
        assertion("first_launch_ready", ctx.expect.offline("firstLaunchStates").join("|"), ready?.state ?? "never", Boolean(ready)),
        preStoreAssertion(before, doc.id),
        assertion("keystore_really_locked", "the wrapper locked the collection", "locked", lock.ok),
        refusalAssertion(ctx, "open_refused_keystore_locked", opened),
        assertion("row_names_the_lock_reason_when_listed", ctx.expect.offline("lockReason"), reading.lockReason ?? "(no row listed: the library could not be read)", reading.lockReason === null || reading.lockReason === ctx.expect.offline("lockReason")),
        // nothing was decrypted: the store did not move, no plaintext copy appeared, no content download ran
        // (the open's server-first attempt meets the cut and is reset: only a download that REACHED the server counts)
        offlineBoolAssertion(ctx, "nothing_decrypted", "nothingDecrypted", untouched && copies.length === 0 && upstreamDownloads(window, doc.id).length === 0),
        assertion("unlock_accepted", "ok", unlock.ok ? "ok" : unlock.line, unlock.ok),
        resultAssertion("retry_accepted", retry),
        assertion("row_recovered_after_unlock", `${recoveredStates.join("|")} (${path})`, recovery?.state ?? "never", Boolean(recovery)),
        ...shots,
        ...noWriteAssertions(ctx, log, doc.id),
        await deltaAssertion(ctx, doc.id),
      ],
    };
  } finally {
    // never leave the shared keyring locked for the next row, whatever happened above (an unlock on an unlocked keyring answers ok)
    ctx.vm.keyring.unlock();
  }
}

export const OFFLINE_FAULT_DRIVERS = {
  "FL-02": (ctx) => runGuarded(ctx, fl02),
  "FL-04a": (ctx) => runGuarded(ctx, fl04a),
  "FL-05": (ctx) => runGuarded(ctx, fl05),
  "FL-06": (ctx) => runGuarded(ctx, fl06),
  "FL-09": (ctx) => runGuarded(ctx, fl09),
};
