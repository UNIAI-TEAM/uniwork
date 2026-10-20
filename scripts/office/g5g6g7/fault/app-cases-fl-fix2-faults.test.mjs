// G7-03b (UNI-1382) fix2: reviewer_be r3 G703-R3-1 - FL-06 drives the fork's REAL renew + regrant path.
// The fake (app-cases-fl-fakes.mjs) now has the fork's branches: `downloadNow` of a same-head snapshot does not
// renew a usable lease, `pin` of an existing row is a no-op, the lease manager's ONLINE pass renews a due lease
// and a live 403 `offline_lease_revoked` auto-grants once in the same call (lease/manager.ts:653-674). Each test
// below was RED on f703b2049 (the fix1 sequence: downloadNow + a second pin) and is GREEN after the fix.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fl-fix2-faults.test.mjs
import "./app-cases-fl-fast.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { OFFLINE_FAULT_DRIVERS } from "./app-case-drivers-offline-faults.mjs";
import { createWorld } from "./app-cases-fl-fakes.mjs";

async function run(tweak = () => {}) {
  const world = createWorld("FL-06");
  try {
    tweak(world);
    const outcome = await OFFLINE_FAULT_DRIVERS["FL-06"](world.ctx);
    const byName = Object.fromEntries(outcome.assertions.map((a) => [a.name, a]));
    return { world, outcome, byName, failed: outcome.assertions.filter((a) => !a.ok).map((a) => a.name) };
  } finally {
    world.clean();
  }
}

const leasePuts = (world, from = 0) => world.log.slice(from).filter((entry) => entry.method === "PUT" && String(entry.path).endsWith("/office/offline-lease"));
const pin = (session, id) => session.shell.evaluate(async (documentId) => window.uniworkSyncCenter.offlinePin({ documentId }), id);

/** The fix1 sequence, as f703b2049's driver ran it: cut + revoke + wait, network back, downloadNow, then a second pin. */
async function fix1Sequence(world) {
  const { ctx } = world;
  const session = await ctx.launch();
  const doc = await ctx.newDocument();
  await ctx.setRules(ctx.caseRules(["short-lease"]));
  await pin(session, doc.id);
  await ctx.setRules(ctx.caseRules(["cut-network"]));
  await ctx.revokeOfflineLeases();
  await ctx.sleep(65_000);
  const boundary = world.log.length;
  await ctx.clearRules();
  const retry = await session.shell.evaluate(async (id) => window.uniworkSyncCenter.offlineDownloadNow(id), doc.id);
  const second = await pin(session, doc.id);
  return { doc, retry, second, window: leasePuts(world, boundary) };
}

test("G703-R3-1 fork-shaped double: the fix1 sequence (downloadNow + a second pin) causes NO lease PUT, so it cannot be the renewal", async () => {
  const world = createWorld("FL-06");
  try {
    const { window: puts, retry, second } = await fix1Sequence(world);
    assert.equal(retry.ok, true, "a same-head downloadNow just answers");
    assert.equal(second.ok, true, "pin of an existing row is the no-op `pinned`");
    assert.deepEqual(puts, [], "neither call put a lease request on the wire: fix1's renew_refused_after_revoke would FAIL on a correct product");
  } finally {
    world.clean();
  }
});

test("G703-R3-1 fork-shaped double: the online pass (the driver's wait) is what renews a due lease and meets the revoke, with the in-call regrant", async () => {
  const world = createWorld("FL-06");
  try {
    const { ctx } = world;
    const session = await ctx.launch();
    const doc = await ctx.newDocument();
    await ctx.setRules(ctx.caseRules(["short-lease"]));
    await pin(session, doc.id);
    await ctx.setRules(ctx.caseRules(["cut-network"]));
    const revoke = await ctx.revokeOfflineLeases();
    await ctx.sleep(65_000);
    assert.deepEqual(leasePuts(world).map((e) => e.status), [200], "the pass does nothing while the network is cut");
    await ctx.setRules(ctx.caseRules(["short-lease"]));
    const boundary = world.log.length;
    await ctx.sleep(2_000);
    assert.deepEqual(leasePuts(world, boundary).map((e) => `${e.status}${e.errorCode ? ` ${e.errorCode}` : ""}${e.policyEpoch ? ` e${e.policyEpoch}` : ""}`), ["403 offline_lease_revoked", `200 e${revoke.evidence.epoch}`]);
  } finally {
    world.clean();
  }
});

test("G703-R3-1: FL-06 causes the renewal with the online pass only - one pin, no downloadNow, and the window is [403 offline_lease_revoked, 200 policy_epoch = the CLI epoch]", async () => {
  let pins = 0;
  let downloads = 0;
  const { world, byName, failed } = await run((w) => {
    const pin = w.product.pin;
    const downloadNow = w.product.downloadNow;
    w.product.pin = async (input) => { pins += 1; return pin(input); };
    w.product.downloadNow = async (id) => { downloads += 1; return downloadNow(id); };
  });
  assert.deepEqual(failed, []);
  assert.equal(pins, 1, "the pin is only the first grant");
  assert.equal(downloads, 0, "downloadNow is never the cause");
  assert.equal(byName.renew_refused_after_revoke.actual, "403 offline_lease_revoked, 200 policy_epoch 2");
  assert.equal(byName.regrant_records_new_epoch.actual, "403 offline_lease_revoked, 200 policy_epoch 2");
  assert.equal(world.policyEpoch, 3, "window B revoked once more");
});

test("G703-R3-1: no lease PUT in the window is BLOCKED \"fork did not renew\" (the online pass never ran), never a product FAIL", async () => {
  const { outcome } = await run((w) => { w.onlinePass = () => {}; });
  assert.match(outcome.blocker, /^fork did not renew: no lease PUT reached the proxy within 90 s of the network coming back/);
  assert.deepEqual(outcome.assertions, []);
});

test("G703-R3-1: the second window with no lease PUT is BLOCKED too, naming the window", async () => {
  const { outcome } = await run((w) => {
    const pass = w.onlinePass;
    let passes = 0;
    // the first renewal comes, the second window's never does
    w.onlinePass = () => { if (w.policyEpoch === 2 || passes === 0) { passes += 1; pass(); } };
  });
  assert.match(outcome.blocker, /second window/);
});

test("G703-R3-1: a 200 with the OLD epoch where the new one is owed is a FAIL (regrant_records_new_epoch)", async () => {
  const { failed } = await run((w) => { w.grantEpochOverride = 1; });
  assert.ok(failed.includes("regrant_records_new_epoch"));
});

test("G703-R3-1: a first answer that is a 200 (the renewal was not refused) fails renew_refused_after_revoke", async () => {
  const { failed, byName } = await run((w) => {
    w.ctx.revokeOfflineLeases = async () => ({ failure: null, evidence: { line: "x", orgId: "01JORGANIZATION000000000", epoch: 2, revoked: 1 } });
  });
  assert.ok(failed.includes("renew_refused_after_revoke"), JSON.stringify(byName.renew_refused_after_revoke));
  assert.match(byName.renew_refused_after_revoke.actual, /^200 /);
});

test("G703-R3-1: a 403 with any other code is a FAIL, and the window-A FAIL is reported even when window B cannot run", async () => {
  const { failed, outcome } = await run((w) => { w.revokeErrorCode = "access_denied"; });
  assert.ok(failed.includes("renew_refused_after_revoke"));
  assert.ok(failed.includes("regrant_records_new_epoch"));
  assert.equal(outcome.blocker, undefined);
});

test("G703-R3-1: a 200 while the network was cut (a grant without the live session) fails regrant_needs_live_session", async () => {
  const { failed, byName } = await run((w) => {
    const sleep = w.ctx.sleep;
    let planted = false;
    w.ctx.sleep = async (ms) => {
      if (!planted && w.rules.some((rule) => rule.id === "cut-network")) {
        planted = true;
        w.log.push({ method: "PUT", path: "/api/v1/documents/x/office/offline-lease", status: 200, policyEpoch: 2 });
      }
      return sleep(ms);
    };
  });
  assert.ok(failed.includes("regrant_needs_live_session"), JSON.stringify(byName.regrant_needs_live_session));
});

test("G703-R3-1: the regrant needs the live session - a refused regrant (the person's access is gone) leaves regrant_records_new_epoch and regrant_row_usable FAILing", async () => {
  const { failed } = await run((w) => { w.regrantRefused = true; });
  assert.ok(failed.includes("regrant_records_new_epoch"));
  assert.ok(failed.includes("regrant_row_usable"));
});

test("G703-R3-1: S11 permission_revoked is observed only in the window where grant() cannot run - the second PUT is the proxy's refusal, no 200, row revoked", async () => {
  const { world, byName, failed } = await run();
  assert.deepEqual(failed, []);
  assert.equal(byName.s11_window_renew_refused.actual, "403 offline_lease_revoked, synthetic");
  assert.equal(byName.row_revoked.actual, "revoked");
  assert.equal(byName.open_refused_permission_revoked.actual, "revoked / permission_revoked");
  const refusal = world.log.filter((entry) => entry.ruleId === "refuse-regrant");
  assert.equal(refusal.length, 1, "the refuse-regrant rule fired exactly once, on the regrant PUT");
});

test("G703-R3-1: a window B whose regrant was NOT refused by the rule (a 200 grant) fails s11_window_renew_refused", async () => {
  const { failed } = await run((w) => {
    const rules = w.ctx.setRules;
    w.ctx.setRules = async (list) => rules(list.filter((rule) => rule.id !== "refuse-regrant"));
  });
  assert.ok(failed.includes("s11_window_renew_refused"));
});
