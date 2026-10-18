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
//
// What these drivers know about the fork (apps/shell/src/main/uniwork-sync, aae163aed):
//   - a lease with < 4 h left projects `lease-expiring` above `ready` (lease/clock.ts:128-138,
//     offline-library/record.ts:70-88), so a SHORT lease is observed as `lease-expiring`;
//   - the library's reservation writes the pin row and the index BEFORE any download
//     (manager.ts reserve), so a fill must come after it and the content write must meet it;
//   - the clock-rollback latch is PERSISTED (lease/manager.ts:394-409): the lease record
//     changes while the lease itself is not extended;
//   - the library layer's budget is 2 GiB + 256 MiB + 16 MiB (offline-library/store.ts:36-47).
//
// Every resource a row takes from the VM (a mount, a filler file, a locked keyring) is
// OWNED before the operation that may create it and its cleanup is CHECKED with a
// read-back (review r2 R2-11): an unproven cleanup makes the row BLOCKED and stops the
// later rows, never a PASS on a VM that was not restored.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppBlocked } from "./app-session.mjs";
import { assertion } from "./app-cases-lib.mjs";
import { countAssertion } from "./app-case-drivers.mjs";
import {
  INDEX_RECORD_NAME, OFFLINE_DOWNLOAD_TIMEOUT_MS, OFFLINE_STATE_TIMEOUT_MS, S11_LOCK_SELECTOR, armOpenCut, awaitRowState, captureRowShots, collectOfflineState, downloadNow, downloadRequests,
  libraryBlobs, libraryStoreDir, listPlaintextCopies, noWriteAssertions, offlineBoolAssertion, offlineCountAssertion, offlineFresh, offlineOpen, offlineSnapshot,
  pinDocument, pinRecordNames, preStoreAssertion, resultAssertion, rowOf, ruleHitAssertion, runGuarded, storeArgs, storeDelta, upstreamDownloads,
  watchRowStatesOrBlocked, withOfflineCapability, writeStoreEvidence,
} from "./app-case-drivers-offline.mjs";
import { deltaAssertion } from "./app-case-drivers.mjs";

const blocked = (blocker) => ({ documentId: null, assertions: [], blocker });

/** The window a rewritten lease expiry may differ from the clock the runner read around the grant (ms). */
const LEASE_TOLERANCE_MS = 10_000;
/** A page of a tmpfs: a write smaller than the free space still needs one whole page. */
const TMPFS_PAGE_BYTES = 4096;

/**
 * The S3 row of one document, as the app's own snapshot shows it right now: its state,
 * S11 reason, whether a tab of the copy is open, the expiry of the lease behind it and
 * the committed version (null fields when it cannot answer). The row is the approved
 * product reading - no store file, no ciphertext.
 */
const rowReading = async (session, documentId) => {
  const row = rowOf(await offlineSnapshot(session), documentId);
  return {
    state: row?.state ?? null,
    lockReason: row?.lockReason ?? null,
    open: row?.open === true,
    leaseUntil: typeof row?.leaseUntil === "string" ? row.leaseUntil : null,
    version: Number.isInteger(row?.version) ? row.version : null,
  };
};

/** Whether the S11 lock panel is on screen right now (a read; never a click or an open). */
const lockPanelVisible = (session) =>
  session.shell.locator(S11_LOCK_SELECTOR).first().isVisible().then((visible) => visible === true).catch(() => false);

/** A refusal that names its code and the S11 reason: the pair the rows assert (an `ok` open never matches). */
const refusalAssertion = (ctx, name, opened, { lockReason = true } = {}) => {
  const codes = ctx.expect.offline("openRefusalCodes");
  const reason = lockReason ? ctx.expect.offline("lockReason") : null;
  const ok = opened?.ok === false && codes.includes(opened?.code) && (reason === null || opened?.lockReason === reason);
  const actual = opened?.ok === true ? "opened" : `${opened?.code ?? "no answer"}${opened?.lockReason ? ` / ${opened.lockReason}` : ""}`;
  return assertion(name, `${codes.join("|")}${reason ? ` / ${reason}` : ""}`, actual, ok);
};

/**
 * Runs a row's body with the resources it takes from the VM OWNED (review r2 R2-11).
 * `own(name, cleanup)` registers a cleanup BEFORE the operation that may create the
 * resource; every cleanup runs afterwards, last registered first, whatever the body
 * did, and each result is checked: a cleanup that answers `{ok:false}` or throws is a
 * failure. Any failure makes the row BLOCKED (`blocker` + `cleanupFailure`, which the
 * runner turns into a fail-stop of the later rows); the body's own error is not lost.
 */
export async function withOwnedResources(body) {
  const cleanups = [];
  let outcome = null;
  let thrown = null;
  try {
    outcome = await body((name, cleanup) => cleanups.push({ name, cleanup }));
  } catch (error) {
    thrown = error;
  }
  const failures = [];
  for (const { name, cleanup } of cleanups.reverse()) {
    try {
      const result = await cleanup();
      if (result && result.ok === false) failures.push(`${name}: ${result.line ?? "failed"}`);
    } catch (error) {
      failures.push(`${name}: ${error?.message ?? error}`);
    }
  }
  if (failures.length === 0) {
    if (thrown) throw thrown;
    return outcome;
  }
  const reason = failures.join("; ");
  const base = outcome ?? blocked("");
  const bodyNote = thrown ? ` (the row also threw: ${thrown?.message ?? thrown})` : "";
  return { ...base, blocker: `cleanup unproven: ${reason}${bodyNote}`, cleanupFailure: reason };
}

/** A promise's answer, or null when it has not settled in `ms` (a pin that waits on a held download never does). */
const settled = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

// ---- FL-02: disk full while the library writes ----------------------------------------
async function fl02(ctx) {
  const mountMb = ctx.expect.offline("diskMountMb");
  const leave = ctx.expect.offline("diskLeaveBytes");
  const budget = ctx.expect.offline("layerBudgetBytes");
  const faulted = ctx.expect.offline("faultedStates");
  const recovered = ctx.expect.offline("recoveredStates");
  const blocker = await withOfflineCapability(ctx);
  if (blocker) return blocked(blocker);
  return withOwnedResources(async (own) => {
    const userData = ctx.userDataDir();
    const vm = ctx.vm;
    const filler = { path: null };
    let session = null;
    // every resource is owned before the call that may create it; they are undone in reverse:
    // the app closes, the held download lets go, the filler goes, then the mount
    const probe = vm.probeTmpfsMount();
    let mount = { ok: false, line: probe.line };
    if (probe.ok) {
      own("unmount of the tmpfs", () => vm.unmountTmpfs(userData));
      mount = vm.mountTmpfs(userData, mountMb);
    }
    const mechanism = mount.ok ? "tmpfs" : "sparse";
    own("removal of the filler file", () => (filler.path ? vm.releaseFill(filler.path) : { ok: true }));
    own("release of the held content download", async () => {
      await ctx.release("hold-content").catch(() => undefined);
      return { ok: true };
    });
    own("close of the app", async () => {
      if (session) await ctx.close(session).catch(() => undefined);
      return { ok: true };
    });
    const docA = await ctx.newDocument();
    const docB = await ctx.newDocument();
    session = await ctx.launch();
    const pinA = await pinDocument(session, { documentId: docA.id, workspaceId: ctx.tenant.workspaceId });
    const readyA = await awaitRowState(ctx, session, docA.id, ctx.expect.offline("firstLaunchStates"));
    const before = collectOfflineState(storeArgs(ctx, [docA.id, docB.id]));
    // what B's content write will need, MEASURED: A is the same fixture, so its committed ciphertext is the size B's will be
    const intendedWrite = libraryBlobs(before, [docA.id]).reduce((sum, record) => sum + record.sizeBytes, 0);

    // 1. B's pin and reservation FIRST: the fork writes the pin row and the index before the download,
    //    and a hold rule keeps the content request at the proxy so the fill lands between the two
    await ctx.setRules(ctx.caseRules(["hold-content"]));
    const pinBPromise = pinDocument(session, { documentId: docB.id, workspaceId: ctx.tenant.workspaceId });
    const held = await ctx.waitHeld("hold-content", OFFLINE_STATE_TIMEOUT_MS);
    if (!held) {
      if (!(await ctx.appAlive(session).catch(() => false))) throw new AppBlocked("the app stopped before B's content download reached the proxy (harness down; no product claim)");
      const early = await settled(pinBPromise, 1_000);
      // a store_full this early, before any fill, is the reservation phase: nothing here is the content write
      if (early?.code === "store_full") return blocked("harness order: B's pin was refused store_full before the fill (the reservation phase), so the disk-full row cannot be exercised on its content write");
      return { documentId: docB.id, assertions: [resultAssertion("pin_b_accepted", early), assertion("b_content_download_held", "B's content GET reached the proxy and was held", "it never reached the proxy", false)] };
    }
    const reserved = collectOfflineState(storeArgs(ctx, [docA.id, docB.id]));
    const reservedPin = pinRecordNames([docB.id]).every((name) => reserved.library.some((record) => record.name === name));
    if (!reservedPin) {
      return blocked("harness order: B's pin row was not in the store while its content download was held (the reservation writes the pin row and the index before the download, manager.ts reserve), so the fill would hit the reservation, not the content write");
    }

    // 2. the fill, with the content write still to come
    let fill;
    try {
      if (mechanism === "tmpfs") {
        fill = vm.fillToLeave(userData, leave, { onPath: (path) => { filler.path = path; } });
      } else {
        const scope = join(libraryStoreDir(userData, ctx.deploymentId(), ctx.tenant.app.userId), "..");
        // leave less than the write needs, or the write would still fit under the budget
        const sparseLeave = Math.max(0, Math.min(leave, intendedWrite - 1));
        fill = vm.sparseFill(scope, budget, sparseLeave, { onPath: (path) => { filler.path = path; } });
      }
    } catch (error) {
      return blocked(mechanism === "tmpfs" ? `the tmpfs could not be filled: ${error.message}` : `no tmpfs (${mount.line}) and the sparse fallback failed: ${error.message}`);
    }
    filler.path = fill.path;
    // the fault is real when the filesystem has less room than the write needs (ENOSPC), or the scope's
    // measured usage plus the write crosses the layer's budget (store_full) - not when a file merely exists
    const faultReal = mechanism === "tmpfs"
      ? fill.freeAfter < Math.max(intendedWrite, TMPFS_PAGE_BYTES)
      : fill.scopeBytes <= budget && fill.scopeBytes + intendedWrite > budget;

    // 3. the content write meets the fault
    const boundary = (await ctx.proxyLog()).length;
    await ctx.release("hold-content");
    const pinB = await settled(pinBPromise, OFFLINE_DOWNLOAD_TIMEOUT_MS);
    const watch = await watchRowStatesOrBlocked(ctx, session, docB.id, { until: faulted, timeout: OFFLINE_STATE_TIMEOUT_MS });
    const contentServed = upstreamDownloads((await ctx.proxyLog()).slice(boundary), docB.id).filter((entry) => entry.status === 200);
    const faultedState = collectOfflineState(storeArgs(ctx, [docA.id, docB.id]));
    const aReading = await rowReading(session, docA.id);
    const shots = await captureRowShots(ctx, session, { s3: true });
    // free the space and retry: the retry is the product's, the space is the VM's
    await ctx.clearRules();
    const freed = fill.path ? vm.releaseFill(fill.path) : { ok: true };
    if (!freed.ok) return blocked(`the filler could not be removed before the retry: ${freed.line}`);
    const retry = await downloadNow(session, docB.id);
    const recoveredRow = await awaitRowState(ctx, session, docB.id, recovered);
    const log = await ctx.proxyLog();
    const after = collectOfflineState(storeArgs(ctx, [docA.id, docB.id]));
    writeStoreEvidence(ctx.runDirOut(), { before, faulted: faultedState, after });
    writeFileSync(
      join(ctx.runDirOut(), "offline-disk-mechanism.json"),
      `${JSON.stringify({
        mechanism, probe: probe.ok ? "sudo mount ok" : probe.line, mount: mount.ok ? "mounted" : mount.line ?? null, mountMb: mechanism === "tmpfs" ? mountMb : null, leaveBytes: leave,
        intendedWriteBytes: intendedWrite,
        fill: mechanism === "tmpfs"
          ? { freeBefore: fill.freeBefore, freeAfter: fill.freeAfter }
          : { apparentBytes: fill.apparentBytes, usedBefore: fill.usedBefore, scopeBytes: fill.scopeBytes, budgetBytes: budget },
      }, null, 2)}\n`,
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
        assertion(
          "fault_really_happened",
          mechanism === "tmpfs"
            ? `free < max(${intendedWrite} B intended write, ${TMPFS_PAGE_BYTES} B page) on the userData filesystem`
            : `scope usage <= ${budget} B budget < scope usage + ${intendedWrite} B intended write`,
          mechanism === "tmpfs" ? `${fill.freeAfter} B free` : `${fill.scopeBytes} B in the scope (${fill.apparentBytes} B filler)`,
          faultReal,
        ),
        resultAssertion("pin_a_accepted", pinA),
        assertion("a_ready_before_fault", ctx.expect.offline("firstLaunchStates").join("|"), readyA?.state ?? "never", Boolean(readyA)),
        preStoreAssertion(before, docA.id),
        assertion("b_reserved_before_fill", "B's pin row in the store while its content download was held", "present", reservedPin),
        resultAssertion("pin_b_accepted", pinB),
        // the evidence comes from the CONTENT write phase: B's content request was served after the fill
        assertion("fault_hit_the_content_write", ">= 1 upstream content download of B answered after the fill", contentServed.length, contentServed.length >= 1),
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
  });
}

/**
 * The short lease the row's own `rewrite_json` rule serves, proved against the clock:
 * the app's `leaseUntil` is `ttlMs` after a moment between `from` and `to` (the runner's
 * readings around the grant), so the rewrite took - a normal lease would be hours away.
 */
const leaseRewriteAssertion = (reading, ttlMs, from, to) => {
  const until = Date.parse(reading?.leaseUntil ?? "");
  const grantedAtMs = until - ttlMs;
  const ok = Number.isFinite(until) && grantedAtMs >= from - LEASE_TOLERANCE_MS && grantedAtMs <= to + LEASE_TOLERANCE_MS;
  return assertion(
    "lease_until_is_the_rewritten_expiry",
    `leaseUntil = a grant between the runner's readings + ${ttlMs} ms (tolerance ${LEASE_TOLERANCE_MS} ms)`,
    Number.isFinite(until) ? `leaseUntil - ${ttlMs} ms is ${grantedAtMs - from} ms after the pin started` : "no leaseUntil on the row",
    ok,
  );
};

// ---- FL-04a: the read lease expires while the offline copy is open --------------------
async function fl04a(ctx) {
  const faulted = ctx.expect.offline("faultedStates");
  const recoveredStates = ctx.expect.offline("recoveredStates");
  const shortLeaseStates = ctx.expect.offline("shortLeaseStates");
  const blocker = await withOfflineCapability(ctx);
  if (blocker) return blocked(blocker);
  // the lease the app is granted lives `ttlMs`, read from the rule the row carries (no number of this file's own)
  const shortLease = ctx.caseRules(["short-lease"]);
  const ttlMs = shortLease[0].action.patch.expires_at.now_plus_ms;
  const startedAt = Date.now();
  const { doc, session } = await offlineFresh(ctx, { rules: shortLease });
  const pinned = await pinDocument(session, { documentId: doc.id, workspaceId: ctx.tenant.workspaceId });
  // a lease with < 4 h left is `lease-expiring` in the fork (lease/clock.ts:128-138): that is the state a short grant shows, never `ready`
  const granted = await awaitRowState(ctx, session, doc.id, shortLeaseStates);
  const grantedBy = Date.now();
  const grantLog = await ctx.proxyLog();
  const before = collectOfflineState(storeArgs(ctx, [doc.id]));
  // offline from here: no renewal can extend the lease, and a Mở can only reach the cache
  await ctx.setRules(ctx.caseRules(["cut-lease", "cut-open"]));
  const openedBefore = await offlineOpen(session, doc.id);
  const openedAt = Date.now();
  const openReading = await rowReading(session, doc.id);
  const until = Date.parse(granted?.row?.leaseUntil ?? "");
  // the SAME tab must lock when the lease lapses: nothing below opens the document again until the lock was read
  const expired = await awaitRowState(ctx, session, doc.id, faulted, { timeout: ttlMs + OFFLINE_STATE_TIMEOUT_MS });
  const reading = await rowReading(session, doc.id);
  const lockedInPlace = await lockPanelVisible(session);
  const shots = await captureRowShots(ctx, session, { s11: true, s3: true });
  const faultedState = collectOfflineState(storeArgs(ctx, [doc.id]));
  // only now a second open, which must be refused
  const opened = await offlineOpen(session, doc.id);
  // the expiry is lifted by a real renewal: the network and the lease route are back
  await ctx.clearRules();
  const retry = await downloadNow(session, doc.id);
  const recovery = await awaitRowState(ctx, session, doc.id, recoveredStates);
  const recoveredReading = await rowReading(session, doc.id);
  const log = await ctx.proxyLog();
  const after = collectOfflineState(storeArgs(ctx, [doc.id]));
  writeStoreEvidence(ctx.runDirOut(), { before, faulted: faultedState, after });
  const renewedUntil = Date.parse(recoveredReading.leaseUntil ?? "");
  return {
    documentId: doc.id,
    assertions: [
      resultAssertion("pin_accepted", pinned),
      assertion("short_lease_granted", shortLeaseStates.join("|"), granted?.state ?? "never", Boolean(granted)),
      // the short expiry really was served to the app: the rewrite rule's own log line AND the expiry the app holds
      ruleHitAssertion("lease_expiry_rewritten", grantLog, "short-lease", { documentId: doc.id }),
      leaseRewriteAssertion(granted?.row, ttlMs, startedAt, grantedBy),
      assertion("open_served_before_expiry", "ok (the cached copy opens while the lease holds)", openedBefore?.ok === true ? "opened" : openedBefore?.code ?? "no answer", openedBefore?.ok === true),
      assertion("opened_promptly", "the open answered before leaseUntil", Number.isFinite(until) ? `${until - openedAt} ms to spare` : "no leaseUntil", Number.isFinite(until) && openedAt < until),
      assertion("copy_is_open_before_expiry", "the row reports an open tab of the copy", openReading.open ? "open" : "not open", openReading.open),
      assertion("row_lease_expired", faulted.join("|"), expired?.state ?? "never", Boolean(expired)),
      assertion("row_names_the_lock_reason", ctx.expect.offline("lockReason"), reading.lockReason ?? "none", reading.lockReason === ctx.expect.offline("lockReason")),
      // the already-open copy locks WHERE IT IS: same tab (the row still reports it open, no second open ran), lock panel up, reason named
      assertion(
        "open_tab_locks_in_place",
        `the lock panel is up, reason ${ctx.expect.offline("lockReason")}, the tab still open - before any reopen`,
        `panel=${lockedInPlace} reason=${reading.lockReason ?? "none"} open=${reading.open}`,
        lockedInPlace && reading.lockReason === ctx.expect.offline("lockReason") && reading.open,
      ),
      refusalAssertion(ctx, "open_refused_lease_expired", opened),
      // no content once locked: the lock covered the tab already and a reopen is refused too
      offlineBoolAssertion(ctx, "content_not_served", "contentNotServed", lockedInPlace && opened?.ok === false),
      resultAssertion("renew_accepted", retry),
      assertion("row_recovered_by_renewal", recoveredStates.join("|"), recovery?.state ?? "never", Boolean(recovery)),
      // recovery keeps a FULL-TTL lease: the renewed expiry is far beyond the short one
      assertion("recovered_lease_is_full_ttl", `leaseUntil beyond now + ${ttlMs} ms`, recoveredReading.leaseUntil ?? "no leaseUntil", Number.isFinite(renewedUntil) && renewedUntil > Date.now() + ttlMs),
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
  // the approved product reading of the lease: the expiry and the committed version the S3 row reports
  const leaseBefore = await rowReading(session, doc.id);
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
  const expiryBefore = Date.parse(leaseBefore.leaseUntil ?? "");
  const expiryDuring = reading.leaseUntil === null ? null : Date.parse(reading.leaseUntil);
  // NOT the ciphertext: the fork persists the clock_rollback latch (lease/manager.ts:394-409), so the
  // lease record is rewritten while the lease is not extended. Extension is read from the semantic
  // fields of the approved reading - the expiry may not move later and the committed version stays.
  const expiryHeld = Number.isFinite(expiryBefore) && (expiryDuring === null || expiryDuring <= expiryBefore);
  const versionHeld = leaseBefore.version === null || reading.version === null || reading.version === leaseBefore.version;
  return {
    documentId: doc.id,
    assertions: [
      resultAssertion("pin_accepted", pinned),
      assertion("first_launch_ready", ctx.expect.offline("firstLaunchStates").join("|"), ready?.state ?? "never", Boolean(ready)),
      preStoreAssertion(before, doc.id),
      assertion("lease_expiry_read_before", "the ready row reports leaseUntil", leaseBefore.leaseUntil ?? "no leaseUntil", Number.isFinite(expiryBefore)),
      // the fault really happened: the app's own wall clock is behind the runner's
      assertion("wall_clock_moved_back", `>= ${skewMinutes} min behind (libfaketime, tolerance 1 min)`, behindMs === null ? "no answer" : `${(behindMs / 60_000).toFixed(1)} min`, behindMs !== null && behindMs >= (skewMinutes - 1) * 60_000),
      assertion("relaunch_signed_in", "signed in", signedIn ? "signed in" : "not signed in", Boolean(signedIn)),
      refusalAssertion(ctx, "open_refused_clock_rollback", opened),
      assertion("row_locked", faulted.join("|"), row?.state ?? "never", Boolean(row)),
      assertion("row_names_the_lock_reason", ctx.expect.offline("lockReason"), reading.lockReason ?? "none", reading.lockReason === ctx.expect.offline("lockReason")),
      offlineBoolAssertion(ctx, "content_not_served", "contentNotServed", opened?.ok === false),
      offlineCountAssertion(ctx, "no_plaintext_copy_materialized", "plaintextCopies", copies.length),
      // no renewal got through while the clock was back, and the lease's expiry and generation did not move
      offlineBoolAssertion(ctx, "never_extends_lease", "neverExtendsLease", leaseGrants.length === 0 && expiryHeld && versionHeld),
      resultAssertion("retry_accepted", retry),
      assertion("row_recovered_after_real_clock", recoveredStates.join("|"), recovery?.state ?? "never", Boolean(recovery)),
      ...shots,
      ...noWriteAssertions(ctx, log, doc.id),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

/** the lease PUTs that got an answer after a log position (a reset is a cut, not an answer) */
function leasePutsSince(log, boundary) {
  return log
    .slice(boundary)
    .filter((entry) => entry.method === "PUT" && String(entry.path).endsWith("/office/offline-lease") && entry.status !== "reset");
}

const PUT_STEP_MS = 2_000;
/** How long the app's own online pass may take to renew a due lease once the network is back (the sync poll interval is far below it). */
const RENEW_WAIT_MS = 90_000;

/**
 * Waits - never causing anything - for the lease manager's own online pass (`onOnlinePass` -> `renew()` on a DUE
 * lease, fork lease/manager.ts:531-532, 818-854) to put its renewal on the wire. Returns the answered lease PUTs
 * since `boundary` once `want` of them are there, or once the first one shows no further PUT is owed, or when the
 * wait ran out (possibly empty: the caller names that BLOCKED "fork did not renew").
 */
async function awaitLeasePuts(ctx, boundary, want) {
  const steps = Math.ceil(RENEW_WAIT_MS / PUT_STEP_MS);
  for (let step = 0; step < steps; step += 1) {
    const puts = leasePutsSince(await ctx.proxyLog(), boundary);
    const revokedFirst = puts[0]?.status === 403;
    if (puts.length >= want || (puts.length >= 1 && !revokedFirst)) return puts;
    await ctx.sleep(PUT_STEP_MS);
  }
  return leasePutsSince(await ctx.proxyLog(), boundary);
}

const putLine = (entry) => `${entry.status}${entry.errorCode ? ` ${entry.errorCode}` : ""}${entry.policyEpoch !== undefined ? ` policy_epoch ${entry.policyEpoch}` : ""}`;

/** Sleeps until the half of a short lease the fork's `shouldRenew` waits for is spent (+ 5 s margin). */
async function waitRenewalDue(ctx, leaseUntil, ttlMs) {
  const until = Date.parse(leaseUntil ?? "");
  await ctx.sleep(Number.isFinite(until) ? Math.max(0, until - ttlMs / 2 - Date.now()) + 5_000 : ttlMs);
}

// ---- FL-06: the lease is revoked on D while the app is offline ------------------------
//
// The fork's real path (aae163aed), which this row drives and never shortcuts:
//   - the due renewal is the lease manager's ONLINE pass (`onOnlinePass`/`renew()` of a lease with < 50 % TTL left);
//     `downloadNow` of a same-head snapshot does not renew (offline-library/manager.ts:1036-1038) and `pin` of an
//     existing row is `pinned` with no request (:893), so neither is used to cause anything here;
//   - a live 403 `offline_lease_revoked` on that renewal re-grants ONCE in the same call (lease/manager.ts:653-674),
//     which is BY DESIGN (D office_lease.go:294-355: the CLI bumps the org epoch and ends old-epoch leases, it does not
//     ban new grants): window A asserts 403, then 200 under the NEW epoch, in that order, and a usable row again;
//   - the refused copy (`revoked`, S11 `permission_revoked`) therefore exists only where the re-grant is refused:
//     window B is an INJECTED refusal, not D's behaviour - the proxy rule `refuse-regrant` answers the 2nd lease PUT of the
//     window with 403 again (the shape of a person whose access is gone), so grant() runs and is refused, and the row is revoked.
async function fl06(ctx) {
  const faulted = ctx.expect.offline("faultedStates");
  const shortLeaseStates = ctx.expect.offline("shortLeaseStates");
  const regrantStates = ctx.expect.offline("regrantStates");
  const refusedStatus = ctx.expect.offline("renewRefusalStatus");
  const refusedCode = ctx.expect.offline("renewRefusalCode");
  const blocker = await withOfflineCapability(ctx);
  if (blocker) return blocked(blocker);
  // a SHORT lease (the row's rewrite rule, as FL-04a): once half of it is spent the next online pass owes a renewal
  const shortLease = ctx.caseRules(["short-lease"]);
  const ttlMs = shortLease[0].action.patch.expires_at.now_plus_ms;
  const startedAt = Date.now();
  const { doc, session } = await offlineFresh(ctx, { rules: shortLease });
  const pinned = await pinDocument(session, { documentId: doc.id, workspaceId: ctx.tenant.workspaceId });
  const granted = await awaitRowState(ctx, session, doc.id, shortLeaseStates);
  const grantedBy = Date.now();
  const before = collectOfflineState(storeArgs(ctx, [doc.id]));

  // ---- window A: offline -> revoke -> network back -> the due renewal is refused, the live session re-grants once
  const cutBoundary = (await ctx.proxyLog()).length;
  await ctx.setRules(ctx.caseRules(["cut-network"]));
  const revoke = await ctx.revokeOfflineLeases();
  if (revoke.failure) return blocked(revoke.failure);
  const evidence = revoke.evidence;
  await waitRenewalDue(ctx, granted?.row?.leaseUntil, ttlMs);
  // nothing got a lease while the app had no network - no session, no grant
  const cutGrants = leasePutsSince(await ctx.proxyLog(), cutBoundary).filter((entry) => entry.status === 200);
  const boundaryA = (await ctx.proxyLog()).length;
  // network back (the short-lease rule stays so the re-granted lease is short again and window B can be caused the same way)
  await ctx.setRules(shortLease);
  const putsA = await awaitLeasePuts(ctx, boundaryA, 2);
  if (putsA.length === 0) return blocked(`fork did not renew: no lease PUT reached the proxy within ${RENEW_WAIT_MS / 1000} s of the network coming back, so the due-renewal path was not exercised`);
  const regrantedRow = await awaitRowState(ctx, session, doc.id, regrantStates);
  const refusalIndex = putsA.findIndex((entry) => entry.status === refusedStatus && entry.errorCode === refusedCode);
  const regrantIndex = putsA.findIndex((entry, index) => index > refusalIndex && entry.status === 200 && Number.isInteger(evidence?.epoch) && entry.policyEpoch === evidence.epoch);

  // window A's verdicts, kept apart: a wrong answer there is a FAIL even when window B cannot run
  const assertionsA = [
    resultAssertion("pin_accepted", pinned),
    assertion("short_lease_granted", shortLeaseStates.join("|"), granted?.state ?? "never", Boolean(granted)),
    leaseRewriteAssertion(granted?.row, ttlMs, startedAt, grantedBy),
    preStoreAssertion(before, doc.id),
    // the revoke hit THIS run's organization and ended at least one live lease: the CLI's own stdout
    assertion(
      "revoke_cli_hit_this_org",
      `${ctx.tenant.orgId}, >= 1 live lease revoked`,
      evidence?.line ?? "no CLI line",
      evidence?.orgId === ctx.tenant.orgId && Number.isInteger(evidence?.revoked) && evidence.revoked >= 1,
    ),
    // no grant without the live session: nothing answered 200 while the network was cut
    assertion("regrant_needs_live_session", "no lease 200 while the network was cut", `${cutGrants.length} lease 200(s)`, cutGrants.length === 0),
    // the FIRST lease PUT of the window is the due renewal of the old-epoch lease: refused with the EXACT code (a 200 or another 403 fails)
    assertion(
      "renew_refused_after_revoke",
      `first PUT offline-lease answered ${refusedStatus} ${refusedCode}`,
      putsA.map(putLine).join(", ") || "(no renew seen)",
      refusalIndex === 0,
    ),
    // ... and the live session's single re-grant follows it in the same window, under the NEW epoch of the CLI line (the OLD epoch fails)
    assertion(
      "regrant_records_new_epoch",
      `then a 200 lease grant with policy_epoch ${evidence?.epoch ?? "?"} (the CLI line's epoch), in that order`,
      putsA.map(putLine).join(", ") || "(no grant seen)",
      refusalIndex === 0 && regrantIndex === 1,
    ),
    assertion("regrant_row_usable", regrantStates.join("|"), regrantedRow?.state ?? "never", Boolean(regrantedRow)),
  ];

  // ---- window B: the same cause again, with the re-grant refused -> the revoked copy (S3 revoked, S11)
  await ctx.setRules(ctx.caseRules(["cut-network"]));
  const revokeB = await ctx.revokeOfflineLeases();
  if (revokeB.failure && !assertionsA.every((entry) => entry.ok)) return { documentId: doc.id, assertions: assertionsA };
  if (revokeB.failure) return blocked(revokeB.failure);
  const regrantedReading = await rowReading(session, doc.id);
  await waitRenewalDue(ctx, regrantedReading.leaseUntil, ttlMs);
  const boundaryB = (await ctx.proxyLog()).length;
  await ctx.setRules(ctx.caseRules(["refuse-regrant"]));
  const putsB = await awaitLeasePuts(ctx, boundaryB, 2);
  if (putsB.length === 0 && !assertionsA.every((entry) => entry.ok)) return { documentId: doc.id, assertions: assertionsA };
  if (putsB.length === 0) return blocked(`fork did not renew: no lease PUT reached the proxy within ${RENEW_WAIT_MS / 1000} s in the second window, so the refused re-grant was not exercised`);
  const row = await awaitRowState(ctx, session, doc.id, faulted);
  // a Mở can only reach the cache now, which is what raises S11
  await armOpenCut(ctx);
  const opened = await offlineOpen(session, doc.id);
  const shots = await captureRowShots(ctx, session, { s11: true, s3: true });
  const faultedState = collectOfflineState(storeArgs(ctx, [doc.id]));
  const copies = listPlaintextCopies(ctx.userDataDir(), ctx.deploymentId(), { accountIds: [ctx.tenant.app.userId] });
  writeStoreEvidence(ctx.runDirOut(), { before, faulted: faultedState, after: faultedState });
  const log = await ctx.proxyLog();
  return {
    documentId: doc.id,
    assertions: [
      ...assertionsA,
      // window B: the same renewal is refused again and the re-grant is refused too by the INJECTED proxy rule `refuse-regrant`
      // (grant() runs and gets the 403; D itself never refuses a by-design re-grant)
      assertion(
        "s11_window_renew_refused",
        `first PUT answered ${refusedStatus} ${refusedCode}, then the re-grant refused by the INJECTED rule refuse-regrant, no 200`,
        putsB.map(putLine).join(", ") || "(no renew seen)",
        putsB[0]?.status === refusedStatus && putsB[0]?.errorCode === refusedCode && putsB[1]?.status === "synthetic" && putsB[1]?.ruleId === "refuse-regrant" && !putsB.some((entry) => entry.status === 200),
      ),
      assertion("row_revoked", faulted.join("|"), row?.state ?? "never", Boolean(row)),
      refusalAssertion(ctx, "open_refused_permission_revoked", opened),
      offlineCountAssertion(ctx, "no_plaintext_copy_left", "plaintextCopies", copies.length),
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
  return withOwnedResources(async (own) => {
    const { doc, session } = await offlineFresh(ctx);
    const pinned = await pinDocument(session, { documentId: doc.id, workspaceId: ctx.tenant.workspaceId });
    const ready = await awaitRowState(ctx, session, doc.id, ctx.expect.offline("firstLaunchStates"));
    const before = collectOfflineState(storeArgs(ctx, [doc.id]));
    await ctx.close(session);
    // the unlock is owned BEFORE the lock attempt: a lock whose reply was lost may still have taken effect, and
    // the shared keyring must never stay locked for the next row; its answer is the wrapper's own read-back
    own("unlock of the keyring", () => ctx.vm.keyring.unlock());
    const lock = ctx.vm.keyring.lock();
    if (!lock.ok) return blocked(lock.line);
    // CL3-1: the locked collection makes the second launch ask for the keyring password; the wrapper's stub
    // answers that prompt with a cancel (INJECTED), the way a user who dismisses the dialog does. The first
    // launch had an unlocked keyring and no prompt: the count is read here and again after the second launch.
    const promptsBefore = ctx.vm.keyring.prompts();
    const second = await ctx.launch({ requireSignIn: false });
    const promptsAfter = ctx.vm.keyring.prompts();
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
    // a fact about the harness, not an assertion: the row claims nothing about the prompt UI itself
    writeFileSync(join(ctx.runDirOut(), "keyring-prompt-injected.json"), `${JSON.stringify({
      injected: true,
      by: "app-keyring-prompter.py (harness-owned org.gnome.keyring.SystemPrompter)",
      answer: "cancel",
      promptsAnsweredBeforeSecondLaunch: promptsBefore.answered,
      promptsAnsweredAfterSecondLaunch: promptsAfter.answered,
    }, null, 2)}
`);
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
  });
}

export const OFFLINE_FAULT_DRIVERS = {
  "FL-02": (ctx) => runGuarded(ctx, fl02),
  "FL-04a": (ctx) => runGuarded(ctx, fl04a),
  "FL-05": (ctx) => runGuarded(ctx, fl05),
  "FL-06": (ctx) => runGuarded(ctx, fl06),
  "FL-09": (ctx) => runGuarded(ctx, fl09),
};
