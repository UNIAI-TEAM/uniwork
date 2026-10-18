// G7-03b (UNI-1382) fix1, group 2: the reviewer_be r2 counterexamples for the W2
// drivers (G703-R2-4..9, R2-11) as node tests on the REGISTERED drivers and the REAL
// cases.json rows, against the fake app/proxy/store/VM (app-cases-fl-fakes.mjs, which
// now projects a short lease like the fork, reserves before it downloads and renews
// only a due lease). Each was RED on 1cd27efc7 and is GREEN after the fix.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fl-fix1-faults.test.mjs
import "./app-cases-fl-fast.mjs";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { OFFLINE_FAULT_DRIVERS, withOwnedResources } from "./app-case-drivers-offline-faults.mjs";
import { S11_LOCK_SELECTOR, pinRecordNames } from "./app-case-drivers-offline.mjs";
import { createOfflineFlagGuard, uncleanBlocker } from "./app-offline-flag.mjs";
import { createWorld } from "./app-cases-fl-fakes.mjs";
import { loadFaultCases } from "./server-cases-lib.mjs";

const FORK_LAYER_BUDGET = 2 * 1024 ** 3 + 256 * 1024 ** 2 + 16 * 1024 ** 2;

async function run(rowId, tweak = () => {}) {
  const world = createWorld(rowId);
  try {
    tweak(world);
    const outcome = await OFFLINE_FAULT_DRIVERS[rowId](world.ctx);
    const byName = Object.fromEntries(outcome.assertions.map((a) => [a.name, a]));
    const files = Object.fromEntries(readdirSync(world.runDir).map((name) => [name, readFileSync(join(world.runDir, name), "utf8")]));
    return { world, outcome, byName, files, failed: outcome.assertions.filter((a) => !a.ok).map((a) => a.name) };
  } finally {
    world.clean();
  }
}

// ---- R2-4: the budget is the fork's, and the fault is measured -----------------------------

test("R2-4: FL-02 carries the fork's layer budget (2 GiB + 256 MiB + 16 MiB = 2432696320), not 2415919104", () => {
  const row = loadFaultCases().cases.find((r) => r.id === "FL-02");
  assert.equal(FORK_LAYER_BUDGET, 2432696320);
  assert.equal(row.expect.offline.layerBudgetBytes, FORK_LAYER_BUDGET);
});

test("R2-4: FL-02 on the sparse fallback measures scope usage + the intended write against the budget", async () => {
  const { byName, files, failed } = await run("FL-02", (w) => { w.tmpfsMountable = false; });
  assert.deepEqual(failed, []);
  assert.match(byName.fault_really_happened.expected, /scope usage <= 2432696320 B budget < scope usage \+ \d+ B intended write/);
  const report = JSON.parse(files["offline-disk-mechanism.json"]);
  assert.ok(report.intendedWriteBytes > 0, "the intended write is measured from A's committed ciphertext");
  assert.ok(report.fill.scopeBytes + report.intendedWriteBytes > FORK_LAYER_BUDGET);
  assert.ok(report.fill.scopeBytes <= FORK_LAYER_BUDGET);
});

test("R2-4: FL-02 a filler sized to the OLD budget (16 MiB under the real one) is no fault - fault_really_happened fails", async () => {
  const { failed } = await run("FL-02", (w) => {
    w.tmpfsMountable = false;
    const sparse = w.vm.sparseFill;
    w.vm.sparseFill = (scope, budget, leave, options) => {
      const fill = sparse(scope, 2415919104, leave, options);
      return fill;
    };
  });
  assert.ok(failed.includes("fault_really_happened"));
});

// ---- R2-5: reservation first, then the fill, then the content write --------------------

test("R2-5: FL-02 pins B and reserves FIRST, holds its content download, THEN fills, then the content write meets the fault", async () => {
  for (const sparse of [false, true]) {
    const order = [];
    const { byName, failed } = await run("FL-02", (w) => {
      w.tmpfsMountable = !sparse;
      for (const method of ["fillToLeave", "sparseFill"]) {
        const original = w.vm[method];
        w.vm[method] = (...args) => {
          const pinB = readdirSync(w.libraryDir()).filter((name) => [...w.rows.keys(), ...Array.from({ length: 4 }, (_, i) => `01JDOC${String(i + 1).padStart(20, "0")}`)].some((id) => pinRecordNames([id]).includes(name)));
          order.push({ held: w.held.has("hold-content"), pinRows: pinB.length });
          return original(...args);
        };
      }
    });
    assert.deepEqual(failed, [], `sparse=${sparse}`);
    assert.equal(order.length, 1);
    assert.equal(order[0].held, true, "the content download was held when the fill happened");
    assert.equal(order[0].pinRows, 2, "A's and B's pin rows are in the store before the fill");
    assert.equal(byName.b_reserved_before_fill.ok, true);
    assert.equal(byName.fault_hit_the_content_write.ok, true);
  }
});

test("R2-5: a reservation-phase store_full (refused before any fill) is BLOCKED(harness order), never a product FAIL", async () => {
  const { outcome } = await run("FL-02", (w) => {
    const pin = w.product.pin;
    let calls = 0;
    w.product.pin = async (input) => {
      calls += 1;
      if (calls === 2) return { ok: false, code: "store_full" };
      return pin(input);
    };
  });
  assert.match(outcome.blocker, /^harness order: B's pin was refused store_full before the fill/);
  assert.deepEqual(outcome.assertions, []);
});

test("R2-5: B's pin row missing while its content download is held is BLOCKED(harness order)", async () => {
  const { outcome } = await run("FL-02", (w) => {
    const pin = w.product.pin;
    let calls = 0;
    w.product.pin = async (input) => {
      calls += 1;
      if (calls < 2) return pin(input);
      // the content request is held with NO reservation written first
      await new Promise((resolve) => w.held.set("hold-content", resolve));
      return { ok: true };
    };
  });
  assert.match(outcome.blocker, /^harness order: B's pin row was not in the store while its content download was held/);
});

test("R2-5: evidence must come from the content write phase - no upstream content answer after the fill fails fault_hit_the_content_write", async () => {
  const { failed } = await run("FL-02", (w) => {
    const pin = w.product.pin;
    let calls = 0;
    w.product.pin = async (input) => {
      calls += 1;
      if (calls < 2) return pin(input);
      w.rows.set(input.documentId, { state: "disk-full", name: "doc" });
      w.writeRecord(w.libraryDir(), `pin/${input.documentId}`, Buffer.from(`pin-${input.documentId}`));
      await new Promise((resolve) => w.held.set("hold-content", resolve));
      // the row reads disk-full but the held content request never went upstream (no 200 in the log)
      return { ok: true };
    };
  });
  assert.ok(failed.includes("fault_hit_the_content_write"));
});

// ---- R2-6 / R2-7: FL-04a ------------------------------------------------------------------

test("R2-6: FL-04a expects lease-expiring for the short lease (the fork's < 4 h rule) and proves leaseUntil = the rewritten expiry", async () => {
  const { byName, failed, world } = await run("FL-04a");
  assert.deepEqual(failed, []);
  assert.equal(byName.short_lease_granted.actual, "lease-expiring");
  assert.equal(byName.lease_until_is_the_rewritten_expiry.ok, true);
  assert.deepEqual(world.row.expect.offline.shortLeaseStates, ["lease-expiring"]);
  assert.equal("firstLaunchStates" in world.row.expect.offline, false, "ready is not expected before the short lease lapses");
});

test("R2-6: FL-04a a short lease the product shows as ready is not the state the fork projects - short_lease_granted fails", async () => {
  const { failed } = await run("FL-04a", (w) => {
    const rowsFor = w.product.rowsFor;
    w.product.rowsFor = (dep) => rowsFor(dep).map((row) => (row.state === "lease-expiring" ? { ...row, state: "ready" } : row));
  });
  assert.ok(failed.includes("short_lease_granted"));
});

test("R2-6: FL-04a a rewrite that only LOGGED a hit (the app still holds a 24 h lease) fails lease_until_is_the_rewritten_expiry", async () => {
  const { failed, byName } = await run("FL-04a", (w) => {
    const rowsFor = w.product.rowsFor;
    w.product.rowsFor = (dep) => rowsFor(dep).map((row) => ({ ...row, leaseUntil: new Date(Date.now() + 24 * 3600_000).toISOString() }));
  });
  assert.ok(failed.includes("lease_until_is_the_rewritten_expiry"), JSON.stringify(byName.lease_until_is_the_rewritten_expiry));
});

test("R2-6: FL-04a recovery keeps a full-TTL ready: a renewal that grants another short lease fails recovered_lease_is_full_ttl", async () => {
  const { failed } = await run("FL-04a", (w) => {
    const rowsFor = w.product.rowsFor;
    w.product.rowsFor = (dep) => rowsFor(dep).map((row) => (w.rules.length === 0 && row.state === "ready" ? { ...row, leaseUntil: new Date(Date.now() + 60_000).toISOString() } : row));
  });
  assert.ok(failed.includes("recovered_lease_is_full_ttl"));
});

test("R2-7: FL-04a the ALREADY-OPEN copy locks in place (S11 + reason, tab still open) BEFORE any reopen", async () => {
  const seen = [];
  const { byName, failed } = await run("FL-04a", (w) => {
    const open = w.product.open;
    w.product.open = (documentId) => {
      seen.push({ lockPanelAlreadyUp: w.visible.has(S11_LOCK_SELECTOR) });
      return open(documentId);
    };
  });
  assert.deepEqual(failed, []);
  assert.equal(seen.length, 2, "an open before the expiry and one reopen after the lock was read");
  assert.equal(seen[0].lockPanelAlreadyUp, false);
  assert.equal(seen[1].lockPanelAlreadyUp, true, "the lock came from the expiry, not from the reopen's refusal");
  assert.match(byName.open_tab_locks_in_place.actual, /panel=true reason=lease_expired open=true/);
});

test("R2-7: FL-04a a product whose open tab keeps showing the content after expiry fails open_tab_locks_in_place even though a REOPEN is refused", async () => {
  const { failed, byName } = await run("FL-04a", (w) => { w.lockStaysHidden = true; });
  assert.ok(failed.includes("open_tab_locks_in_place"), JSON.stringify(byName.open_tab_locks_in_place));
  assert.equal(byName.open_refused_lease_expired.ok, true, "the second open is refused - that alone is not the in-place lock");
});

test("R2-7: FL-04a a copy that was never open (the row reports no open tab) fails copy_is_open_before_expiry", async () => {
  const { failed } = await run("FL-04a", (w) => {
    const rowsFor = w.product.rowsFor;
    w.product.rowsFor = (dep) => rowsFor(dep).map((row) => ({ ...row, open: false }));
  });
  assert.ok(failed.includes("copy_is_open_before_expiry"));
  assert.ok(failed.includes("open_tab_locks_in_place"));
});

// ---- R2-8: FL-05 --------------------------------------------------------------------------

test("R2-8: FL-05 a persisted clock_rollback latch (the lease record is rewritten) is NOT an extension", async () => {
  const { failed, byName, files } = await run("FL-05");
  assert.deepEqual(failed, []);
  assert.equal(byName.never_extends_lease.ok, true);
  const before = JSON.parse(files["offline-store-before.json"]).leases;
  const faulted = JSON.parse(files["offline-store-faulted.json"]).leases;
  assert.notDeepEqual(before.map((r) => r.sha256), faulted.map((r) => r.sha256), "the latch was persisted: the ciphertext of the lease record moved");
});

test("R2-8: FL-05 a lease whose expiry moves later while the clock is back fails never_extends_lease", async () => {
  const { failed } = await run("FL-05", (w) => { w.extendOnRollback = true; });
  assert.ok(failed.includes("never_extends_lease"));
});

test("R2-8: FL-05 a committed version that changes while the clock is back fails never_extends_lease", async () => {
  const { failed } = await run("FL-05", (w) => {
    const rowsFor = w.product.rowsFor;
    w.product.rowsFor = (dep) => rowsFor(dep).map((row) => (row.lockReason === "clock_rollback" ? { ...row, version: 2 } : row));
  });
  assert.ok(failed.includes("never_extends_lease"));
});

test("R2-8: FL-05 a row that reports no expiry before the fault cannot make the lease claim vacuous", async () => {
  const { failed } = await run("FL-05", (w) => {
    const rowsFor = w.product.rowsFor;
    w.product.rowsFor = (dep) => rowsFor(dep).map((row) => ({ ...row, leaseUntil: null }));
  });
  assert.ok(failed.includes("lease_expiry_read_before"));
  assert.ok(failed.includes("never_extends_lease"));
});

// ---- R2-9: FL-06 --------------------------------------------------------------------------

test("R2-9: FL-06 grants a SHORT lease first, waits until the renewal is due, and the due renewal meets the exact revoke code", async () => {
  const { world, byName, failed } = await run("FL-06");
  assert.deepEqual(failed, []);
  assert.equal(byName.short_lease_granted.actual, "lease-expiring");
  assert.ok(world.sleptMs >= 60_000, `the driver waited until half the 120 s lease was spent (slept ${world.sleptMs} ms)`);
  assert.match(byName.revoke_cli_hit_this_org.actual, /^01JORGANIZATION000000000 offline policy epoch now 2, 1 live lease\(s\) revoked$/);
  assert.match(byName.renew_refused_after_revoke.actual, /403 offline_lease_revoked/);
});

test("R2-9: FL-06 the fake's downloadNow does not lease-PUT a fresh lease (no renewal is due), only a due one", async () => {
  const world = createWorld("FL-06");
  try {
    const session = await world.ctx.launch();
    const doc = await world.ctx.newDocument();
    await session.shell.evaluate(async (id) => window.uniworkSyncCenter.offlinePin({ documentId: id }), doc.id);
    const puts = () => world.log.filter((entry) => entry.method === "PUT").length;
    assert.equal(puts(), 1, "the pin's first grant");
    await session.shell.evaluate(async (id) => window.uniworkSyncCenter.offlineDownloadNow(id), doc.id);
    assert.equal(puts(), 1, "a fresh 24 h lease is not renewed by a retry");
  } finally {
    world.clean();
  }
});

test("R2-9: FL-06 a driver that never lets the renewal come due sees no refusal (the wait is what causes it)", async () => {
  const { failed } = await run("FL-06", (w) => { w.ctx.sleep = async () => {}; });
  assert.ok(failed.includes("renew_refused_after_revoke"));
  assert.ok(failed.includes("row_revoked"));
});

test("R2-9: FL-06 a 403 that is not offline_lease_revoked (access_denied) is not the revoke", async () => {
  const { failed, byName } = await run("FL-06", (w) => { w.revokeErrorCode = "access_denied"; });
  assert.ok(failed.includes("renew_refused_after_revoke"), JSON.stringify(byName.renew_refused_after_revoke));
});

test("R2-9: FL-06 a revoke CLI line for ANOTHER organization, or that revoked nothing, fails revoke_cli_hit_this_org", async () => {
  const other = await run("FL-06", (w) => { w.revokeOrgId = "01JOTHERORG00000000000000"; });
  assert.ok(other.failed.includes("revoke_cli_hit_this_org"));
  const none = await run("FL-06", (w) => { w.revokedCount = 0; });
  assert.ok(none.failed.includes("revoke_cli_hit_this_org"));
});

test("R2-9: FL-06 the row carries the short-lease rule, the exact refusal code and no draft claim", () => {
  const row = loadFaultCases().cases.find((r) => r.id === "FL-06");
  assert.deepEqual(row.proxyRules.map((rule) => rule.id), ["short-lease", "cut-network", "cut-open"]);
  assert.equal(row.expect.offline.renewRefusalCode, "offline_lease_revoked");
  assert.equal(row.expect.offline.renewRefusalStatus, 403);
});

// ---- R2-11: cleanup is owned, checked and fail-stops ---------------------------------------

test("R2-11: withOwnedResources runs every cleanup (last first), checks each result and keeps the body's own error", async () => {
  const order = [];
  const outcome = await withOwnedResources(async (own) => {
    own("first", () => { order.push("first"); return { ok: true }; });
    own("second", () => { order.push("second"); return { ok: false, line: "still mounted" }; });
    own("third", () => { order.push("third"); throw new Error("boom"); });
    throw new Error("the row broke");
  }).catch((error) => error);
  assert.deepEqual(order, ["third", "second", "first"], "every cleanup ran, last registered first, though the body threw and one cleanup threw");
  assert.match(outcome.blocker, /^cleanup unproven: third: boom; second: still mounted \(the row also threw: the row broke\)$/);
  assert.equal(outcome.cleanupFailure, "third: boom; second: still mounted");
  const clean = await withOwnedResources(async (own) => { own("x", () => ({ ok: true })); return { documentId: "d", assertions: [] }; });
  assert.deepEqual(clean, { documentId: "d", assertions: [] });
  await assert.rejects(() => withOwnedResources(async (own) => { own("x", () => ({ ok: true })); throw new Error("only the body"); }), /only the body/);
});

test("R2-11: FL-02 an unmount that cannot be proven is BLOCKED with the line and a cleanupFailure, whatever the row measured", async () => {
  const { outcome } = await run("FL-02", (w) => { w.unmountFails = true; });
  assert.match(outcome.blocker, /^cleanup unproven: unmount of the tmpfs: umount -l .* is still a mount point$/);
  assert.match(outcome.cleanupFailure, /unmount of the tmpfs/);
  assert.ok(outcome.assertions.length > 10, "the row's own measurements are kept for inspection");
});

test("R2-11: FL-02 a filler whose removal cannot be read back is BLOCKED (and the row never retries on a still-full disk)", async () => {
  const { outcome } = await run("FL-02", (w) => { w.releaseFails = true; });
  assert.match(outcome.blocker, /the filler could not be removed before the retry|cleanup unproven: removal of the filler file/);
  assert.match(outcome.cleanupFailure ?? "", /removal of the filler file/);
});

test("R2-11: FL-02 a fill that throws AFTER its path was named is still released by the owner, and the row is BLOCKED with the fill's error", async () => {
  const { outcome, world } = await run("FL-02", (w) => { w.fillThrowsAfterPath = true; });
  assert.match(outcome.blocker, /^the tmpfs could not be filled: ENOSPC/);
  const release = world.vmCalls.find((call) => call[0] === "release");
  assert.ok(release, "the partial filler is released although fill never returned");
  assert.match(release[1], /\.fl02-filler$/);
  assert.equal(outcome.cleanupFailure, undefined, "a proven cleanup is not a failure");
});

test("R2-11: FL-02 a broken release of a partial filler on top of a failed fill is BLOCKED + cleanupFailure", async () => {
  const { outcome } = await run("FL-02", (w) => { w.fillThrowsAfterPath = true; w.releaseFails = true; });
  assert.match(outcome.blocker, /cleanup unproven: removal of the filler file/);
  assert.ok(outcome.cleanupFailure);
});

test("R2-11: FL-09 a final unlock that is refused is BLOCKED + cleanupFailure even though every assertion passed", async () => {
  const { outcome } = await run("FL-09", (w) => { w.finalUnlockFails = true; });
  assert.match(outcome.blocker, /^cleanup unproven: unlock of the keyring: the keyring wrapper answered unlock with: fail: the collection is still locked after unlock/);
  assert.ok(outcome.cleanupFailure);
  assert.equal(outcome.assertions.every((a) => a.ok), true, "the row itself passed: it is still not a PASS");
});

test("R2-11: FL-09 a lock whose reply was lost but that took effect is undone by the owned unlock", async () => {
  const { outcome, world } = await run("FL-09", (w) => { w.lockFailsButLocks = true; });
  assert.match(outcome.blocker, /did not answer lock \(exit 1\)/);
  assert.equal(world.keyringLocked, false, "the keyring is not left locked for the next row");
  assert.equal(world.vmCalls.filter((call) => call[0] === "keyring").at(-1)[1], "unlock");
  assert.equal(outcome.cleanupFailure, undefined);
});

test("R2-11: an unproven cleanup stops every later row through the shared guard, naming the reason", () => {
  const guard = createOfflineFlagGuard({ set: async () => {}, clear: async () => {}, read: async () => ({ override: null }) });
  assert.equal(guard.unclean(), null);
  guard.markUnclean("unmount of the tmpfs: busy");
  guard.markUnclean("a later reason does not replace the first");
  assert.equal(guard.unclean(), "unmount of the tmpfs: busy");
  assert.match(uncleanBlocker(guard.unclean()), /^not run: an earlier row could not prove its cleanup \(unmount of the tmpfs: busy\)/);
  assert.equal(guard.failure(), null, "the override lift is a separate failure");
});

// ---- R2-9 amendment: the regrant after a revoke is BY DESIGN and FL-06 asserts it ----------------

test("R2-9 amendment: FL-06 asserts the regrant - none without the live session, then one fresh grant under the NEW epoch from the CLI line", async () => {
  const { byName, failed, world } = await run("FL-06");
  assert.deepEqual(failed, []);
  assert.deepEqual(world.row.expect.offline.regrantStates, ["ready"]);
  assert.match(byName.regrant_needs_live_session.actual, /^0 grant\(s\), row revoked$/);
  assert.match(byName.regrant_records_new_epoch.actual, /^200 policy_epoch 2$/);
  assert.match(byName.regrant_records_new_epoch.expected, /policy_epoch 2 \(the CLI line's epoch\)/);
  assert.equal(byName.regrant_row_usable.actual, "ready");
});

test("R2-9 amendment: FL-06 a regrant stamped with the OLD epoch is not the new epoch - regrant_records_new_epoch fails", async () => {
  const { failed } = await run("FL-06", (w) => { w.grantEpochOverride = 1; });
  assert.ok(failed.includes("regrant_records_new_epoch"));
});

test("R2-9 amendment: FL-06 a product that cannot take the one fresh grant (no regrant) fails regrant_records_new_epoch and regrant_row_usable", async () => {
  const { failed } = await run("FL-06", (w) => { w.regrantsLeft = 0; });
  assert.ok(failed.includes("regrant_records_new_epoch"));
  assert.ok(failed.includes("regrant_row_usable"));
  assert.equal(failed.includes("renew_refused_after_revoke"), false, "the old-epoch renewal refusal is unchanged");
});

test("R2-9 amendment: FL-06 the renewal of the OLD-epoch lease is still refused with the exact code before the regrant", async () => {
  const { byName, world } = await run("FL-06");
  assert.match(byName.renew_refused_after_revoke.actual, /403 offline_lease_revoked/);
  const puts = world.log.filter((entry) => entry.method === "PUT");
  const refused = puts.findIndex((entry) => entry.status === 403);
  const regrant = puts.findIndex((entry, index) => index > refused && entry.status === 200);
  assert.ok(refused >= 0 && regrant > refused, "the refusal comes first, the regrant after it");
});
