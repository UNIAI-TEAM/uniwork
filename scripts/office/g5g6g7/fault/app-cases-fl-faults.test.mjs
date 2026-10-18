// G7-03b (UNI-1382) W2: the REGISTERED drivers of FL-02 / FL-04a / FL-05 / FL-06 /
// FL-09 run on their REAL cases.json rows against the fake app, proxy, store and
// runner VM (app-cases-fl-fakes.mjs). A correct product passes every assertion; a
// test then changes ONE behavior (the product or the VM) and the driver must FAIL
// the right assertion - or return BLOCKED with the runner's exact line when the VM
// lacks the tool, or reject with AppBlocked when the app died. Not the Electron /
// OS boundary (tmpfs, libfaketime, gnome-keyring, uniwork-admin): that is the cloud run.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fl-faults.test.mjs
import "./app-cases-fl-fast.mjs";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { OFFLINE_FAULT_DRIVERS } from "./app-case-drivers-offline-faults.mjs";
import { AppBlocked } from "./app-session.mjs";
import { createWorld } from "./app-cases-fl-fakes.mjs";
import { renderCaseRules } from "./server-cases-lib.mjs";
import { loadFaultCases } from "./server-cases-lib.mjs";

const W2_ROWS = ["FL-02", "FL-04a", "FL-05", "FL-06", "FL-09"];
/** the fork's library layer budget: 2 GiB quota + one 256 MiB staging copy + 16 MiB of frames (offline-library/store.ts:36-47) */
const FORK_LAYER_BUDGET = 2 * 1024 ** 3 + 256 * 1024 ** 2 + 16 * 1024 ** 2;

/** Runs the registered driver of `rowId`; `tweak(world)` changes one behavior before it runs. */
async function run(rowId, tweak = () => {}) {
  const world = createWorld(rowId);
  try {
    tweak(world);
    const outcome = await OFFLINE_FAULT_DRIVERS[rowId](world.ctx);
    const byName = Object.fromEntries(outcome.assertions.map((a) => [a.name, a]));
    // read before the scratch run dir is removed
    const files = Object.fromEntries(readdirSync(world.runDir).map((name) => [name, readFileSync(join(world.runDir, name), "utf8")]));
    const artifacts = (name) => files[name] ?? null;
    return { world, outcome, byName, artifacts, failed: outcome.assertions.filter((a) => !a.ok).map((a) => a.name) };
  } finally {
    world.clean();
  }
}

test("the W2 drivers are exactly the rows cases.json ships as ready with dependency none", () => {
  const w2 = loadFaultCases().cases.filter((row) => W2_ROWS.includes(row.id));
  assert.deepEqual(w2.map((row) => `${row.id}:${row.status}:${row.dependency}`), W2_ROWS.map((id) => `${id}:ready:none`));
  assert.deepEqual(Object.keys(OFFLINE_FAULT_DRIVERS).sort(), [...W2_ROWS].sort());
});

for (const id of W2_ROWS) {
  test(`${id}: the registered driver runs on its real cases.json row and a correct product on a VM that has the tool passes every assertion`, async () => {
    const { outcome, failed } = await run(id);
    assert.equal(outcome.blocker, undefined, outcome.blocker);
    assert.ok(outcome.assertions.length >= 12, "the driver produced its assertions");
    assert.deepEqual(failed, [], `${id}: ${JSON.stringify(outcome.assertions.filter((a) => !a.ok))}`);
  });

  test(`${id}: the shots it asserts are exactly the shots cases.json declares`, async () => {
    const { outcome, world } = await run(id);
    const shots = outcome.assertions.filter((a) => /^s(3|11)_shot$/.test(a.name)).map((a) => a.expected).sort();
    assert.deepEqual(shots, world.row.artifacts.filter((name) => name.endsWith(".png")).sort());
  });

  test(`${id}: an app that dies during the run is BLOCKED, never a product FAIL`, async () => {
    const world = createWorld(id);
    try {
      const launch = world.ctx.launch;
      world.ctx.launch = async (options) => {
        const session = await launch(options);
        const pin = world.product.pin;
        world.product.pin = (input) => {
          const result = pin(input);
          world.alive = false;
          return result;
        };
        return session;
      };
      await assert.rejects(() => OFFLINE_FAULT_DRIVERS[id](world.ctx), (error) => error instanceof AppBlocked && /harness down|stopped/.test(error.message));
    } finally {
      world.clean();
    }
  });

  test(`${id}: an app that never comes up is BLOCKED, never a product FAIL`, async () => {
    const world = createWorld(id);
    try {
      world.launchFails = true;
      await assert.rejects(() => OFFLINE_FAULT_DRIVERS[id](world.ctx), (error) => error instanceof AppBlocked && /did not come up/.test(error.message));
    } finally {
      world.clean();
    }
  });

  test(`${id}: the organization capability that cannot be switched on is BLOCKED with the override's own line`, async () => {
    const { outcome } = await run(id, (world) => {
      world.ctx.setOfflineLibrary = async () => { throw new Error("PUT overrides answered 500"); };
    });
    assert.match(outcome.blocker, /office_offline_library override: PUT overrides answered 500/);
    assert.deepEqual(outcome.assertions, []);
  });
}

// ---- FL-02: disk full ---------------------------------------------------------------

test("FL-02: with sudo mount available the userData is a real tmpfs, filled to leave diskLeaveBytes, and the mechanism is reported", async () => {
  const { world, byName, artifacts, failed } = await run("FL-02");
  assert.deepEqual(failed, []);
  const mount = world.vmCalls.find((call) => call[0] === "mount");
  assert.equal(mount[2], 512, "diskMountMb of the row");
  assert.equal(world.vmCalls.find((call) => call[0] === "fill")[2], 1024, "diskLeaveBytes of the row");
  assert.ok(world.vmCalls.some((call) => call[0] === "unmount"), "the tmpfs is unmounted afterwards");
  assert.equal(world.vmCalls.some((call) => call[0] === "sparse"), false);
  assert.match(byName.mechanism_reported.actual, /^tmpfs/);
  const report = JSON.parse(artifacts("offline-disk-mechanism.json"));
  assert.equal(report.mechanism, "tmpfs");
  assert.equal(report.mountMb, 512);
});

test("FL-02: no sudo mount -> the sparse fallback crosses the layer budget of the row, and the report says sparse and why", async () => {
  const { world, byName, artifacts, failed } = await run("FL-02", (w) => { w.tmpfsMountable = false; });
  assert.deepEqual(failed, []);
  assert.equal(world.vmCalls.some((call) => call[0] === "mount"), false, "no mount was attempted");
  const sparse = world.vmCalls.find((call) => call[0] === "sparse");
  assert.equal(sparse[2], FORK_LAYER_BUDGET, "layerBudgetBytes of the row");
  assert.match(byName.mechanism_reported.actual, /^sparse - tmpfs not used: sudo -n true exited 1/);
  const report = JSON.parse(artifacts("offline-disk-mechanism.json"));
  assert.equal(report.mechanism, "sparse");
  assert.match(report.probe, /a password is required/);
  assert.equal(report.fill.budgetBytes, FORK_LAYER_BUDGET);
});

test("FL-02: a mount that fails after the probe falls back to sparse and names the mount line", async () => {
  const { byName, artifacts, failed } = await run("FL-02", (w) => { w.mountFails = true; });
  assert.deepEqual(failed, []);
  assert.match(byName.mechanism_reported.actual, /^sparse - tmpfs not used: mount -t tmpfs -o size=512m .* exited 32: permission denied/);
  assert.equal(JSON.parse(artifacts("offline-disk-mechanism.json")).mechanism, "sparse");
});

test("FL-02: no tmpfs and a sparse fallback that cannot be written is BLOCKED with both lines, never a FAIL", async () => {
  const { outcome, world } = await run("FL-02", (w) => { w.tmpfsMountable = false; w.sparseFails = true; });
  assert.ok(outcome.blocker.startsWith("no tmpfs (sudo -n true exited 1: a password is required) and the sparse fallback failed: EACCES"), outcome.blocker);
  assert.deepEqual(outcome.assertions, []);
  assert.ok(world.vmCalls.some((call) => call[0] === "sparse"));
});

test("FL-02: a fill that leaves the disk free is not a fault - fault_really_happened fails", async () => {
  const { failed } = await run("FL-02", (w) => { w.fillLeavesBytes = 300 * 1024 * 1024; });
  assert.ok(failed.includes("fault_really_happened"));
});

test("FL-02: a product that reads B ready on a full disk fails b_row_faulted and b_never_ready_while_faulted", async () => {
  const { failed } = await run("FL-02", (w) => {
    const pin = w.product.pin;
    w.product.pin = async (input) => {
      const result = await pin(input);
      // the product ignores the full disk and commits B anyway
      if (w.rows.get(input.documentId)?.state === "disk-full") w.rows.set(input.documentId, { state: "ready", name: "doc" });
      return result;
    };
  });
  assert.ok(failed.includes("b_row_faulted"));
  assert.ok(failed.includes("b_never_ready_while_faulted"));
});

test("FL-02: a partial blob left in the store while the disk is full fails nothing_partial_in_the_store", async () => {
  const { failed } = await run("FL-02", (w) => {
    const pin = w.product.pin;
    w.product.pin = async (input) => {
      const result = await pin(input);
      if (w.rows.get(input.documentId)?.state === "disk-full") w.writeLibrary(input.documentId);
      return result;
    };
  });
  assert.ok(failed.includes("nothing_partial_in_the_store"));
});

test("FL-02: a full disk that destroys the older pinned copy fails kept_old_copy", async () => {
  const { failed } = await run("FL-02", (w) => {
    const pin = w.product.pin;
    w.product.pin = async (input) => {
      const result = await pin(input);
      if (w.rows.get(input.documentId)?.state === "disk-full") {
        for (const name of w.pristine.keys()) rmSync(join(w.libraryDir(), name), { force: true });
      }
      return result;
    };
  });
  assert.ok(failed.includes("kept_old_copy"));
});

test("FL-02: freeing the space does not heal a product whose retry stays disk-full (b_recovered_after_free_space fails)", async () => {
  const { failed } = await run("FL-02", (w) => {
    w.product.downloadNow = (documentId) => {
      w.download(documentId);
      w.rows.set(documentId, { state: "disk-full", name: "doc" });
      return { ok: true };
    };
  });
  assert.ok(failed.includes("b_recovered_after_free_space"));
});

test("FL-02: the tmpfs is unmounted and the filler released even when the run dies", async () => {
  const world = createWorld("FL-02");
  try {
    world.ctx.newDocument = async () => { throw new Error("seed exploded"); };
    await assert.rejects(() => OFFLINE_FAULT_DRIVERS["FL-02"](world.ctx), /seed exploded/);
    assert.ok(world.vmCalls.some((call) => call[0] === "unmount"));
  } finally {
    world.clean();
  }
});

test("renderCaseRules keeps a rewrite_json rule's patch, so the row's own short-lease rule validates", () => {
  const row = loadFaultCases().cases.find((r) => r.id === "FL-04a");
  const rules = renderCaseRules(row, {});
  const short = rules.find((rule) => rule.id === "short-lease");
  assert.equal(short.action.type, "rewrite_json");
  assert.deepEqual(short.action.patch, row.proxyRules[0].action.patch);
  assert.notEqual(short.action.patch, row.proxyRules[0].action.patch, "the rendered patch is a copy");
});

// ---- FL-04a: lease expiry -----------------------------------------------------------

test("FL-04a: the short lease comes from the row's own rewrite rule, and its log line is the evidence it was served", async () => {
  const { world, byName, failed } = await run("FL-04a");
  assert.deepEqual(failed, []);
  assert.equal(byName.lease_expiry_rewritten.ok, true);
  assert.equal(world.row.proxyRules.find((rule) => rule.id === "short-lease").action.type, "rewrite_json");
});

test("FL-04a: a rewrite rule the proxy never applied is not evidence - lease_expiry_rewritten fails", async () => {
  const { failed } = await run("FL-04a", (world) => {
    // quick unexpired wait (see the never-lapses test): the TTL is the rule's, read by the driver
    world.row.proxyRules.find((rule) => rule.id === "short-lease").action.patch.expires_at.now_plus_ms = 50;
    world.ctx.setRules = async (rules) => {
      world.rules = rules.filter((rule) => rule.id !== "short-lease");
      world.ruleCounters.clear();
    };
  });
  assert.ok(failed.includes("lease_expiry_rewritten"));
});

test("FL-04a: a lease that never lapses fails row_lease_expired (the wait is the row's TTL plus the state timeout)", async () => {
  const { failed, byName } = await run("FL-04a", (world) => {
    // 50 ms instead of 120 s so the unexpired wait is quick; the driver reads the TTL from the rule it renders
    world.row.proxyRules.find((rule) => rule.id === "short-lease").action.patch.expires_at.now_plus_ms = 50;
    world.expireAfterPolls = 1_000_000;
  });
  assert.ok(failed.includes("row_lease_expired"), JSON.stringify(byName.row_lease_expired));
});

test("FL-04a: an expired lease that still opens the content fails the refusal and content_not_served", async () => {
  const { failed } = await run("FL-04a", (world) => {
    const open = world.product.open;
    world.product.open = (documentId) => {
      open(documentId);
      return { ok: true };
    };
  });
  assert.ok(failed.includes("open_refused_lease_expired"));
  assert.ok(failed.includes("content_not_served"));
});

test("FL-04a: the wrong lock reason on an expired row fails row_names_the_lock_reason", async () => {
  const { failed } = await run("FL-04a", (world) => {
    const rowsFor = world.product.rowsFor;
    world.product.rowsFor = (dep) => rowsFor(dep).map((row) => (row.state === "lease-expired" ? { ...row, lockReason: "permission_revoked" } : row));
  });
  assert.ok(failed.includes("row_names_the_lock_reason"));
});

test("FL-04a: a copy that does not open BEFORE the expiry fails open_served_before_expiry", async () => {
  const { failed } = await run("FL-04a", (world) => {
    const open = world.product.open;
    let first = true;
    world.product.open = (documentId) => {
      if (first) {
        first = false;
        open(documentId);
        return { ok: false, code: "offline" };
      }
      return open(documentId);
    };
  });
  assert.ok(failed.includes("open_served_before_expiry"));
});

test("R2-7: FL-04a and FL-06 make no draft-retention claim (no checkpoint is seeded, so none is measured)", async () => {
  for (const [id, run_] of [["FL-04a", run], ["FL-06", run]]) {
    const { byName, world } = await run_(id);
    assert.equal(byName.draft_kept, undefined, `${id}: no draft_kept assertion`);
    assert.equal("draftKept" in world.row.expect.offline, false, `${id}: the row carries no draftKept`);
  }
});

// ---- FL-05: clock moved back --------------------------------------------------------

test("FL-05: the second launch carries the row's skew in the libfaketime env and the third runs on the real clock", async () => {
  const { world, byName, failed } = await run("FL-05");
  assert.deepEqual(failed, []);
  const [first, second, third] = world.launches;
  assert.equal(first.extraEnv, undefined);
  assert.equal(second.extraEnv.FAKETIME, "-10m", "clockSkewMinutes of the row");
  assert.match(second.extraEnv.LD_PRELOAD, /libfaketime\.so\.1$/);
  assert.equal(second.extraEnv.FAKETIME_DONT_FAKE_MONOTONIC, "1");
  assert.equal(third.extraEnv, undefined);
  assert.match(byName.wall_clock_moved_back.actual, /^10\.\d min$/);
});

test("FL-05: a VM without libfaketime is BLOCKED with the exact install line and nothing was launched", async () => {
  const { world, outcome } = await run("FL-05", (w) => { w.faketimeInstalled = false; });
  assert.equal(outcome.blocker, "libfaketime is not installed on the runner VM (apt-get install -y libfaketime)");
  assert.equal(world.launches.length, 0);
});

test("FL-05: a launch that ignored the faketime env is not a moved clock - wall_clock_moved_back fails", async () => {
  const { failed } = await run("FL-05", (world) => {
    const launch = world.ctx.launch;
    world.ctx.launch = (options) => launch({ ...options, extraEnv: undefined });
  });
  assert.ok(failed.includes("wall_clock_moved_back"));
});

test("FL-05: a product that opens with the clock back fails the refusal, the lock reason and content_not_served", async () => {
  const { failed } = await run("FL-05", (world) => {
    world.product.open = (documentId) => {
      world.download(documentId);
      return { ok: true };
    };
    world.rollbackLatched = false;
    const rowsFor = world.product.rowsFor;
    world.product.rowsFor = (dep) => rowsFor(dep).map((row) => ({ ...row, state: "ready", lockReason: undefined }));
  });
  assert.ok(failed.includes("open_refused_clock_rollback"));
  assert.ok(failed.includes("content_not_served"));
  assert.ok(failed.includes("row_locked"));
});

test("FL-05: a product that extends the lease while the clock is back fails never_extends_lease", async () => {
  const { failed } = await run("FL-05", (world) => {
    const rowsFor = world.product.rowsFor;
    world.product.rowsFor = (dep) => {
      // a renewal slips through the cut and rewrites the lease record
      if (world.rollbackLatched) {
        world.rules = [];
        world.leasePut([...world.rows.keys()][0]);
      }
      return rowsFor(dep);
    };
  });
  assert.ok(failed.includes("never_extends_lease"));
});

test("FL-05: a plaintext copy materialized while the clock is back fails no_plaintext_copy_materialized", async () => {
  const { failed } = await run("FL-05", (world) => {
    const open = world.product.open;
    world.product.open = (documentId) => {
      world.writeRecord(join(world.userData, "uniwork-documents", "default", "01JACCOUNTAAAAAAAAAAAAAAAA", "abc@offline"), "doc.docx", Buffer.from("PLAINTEXT"));
      return open(documentId);
    };
  });
  assert.ok(failed.includes("no_plaintext_copy_materialized"));
});

test("FL-05: a rollback lock that never lifts after the real clock returns fails row_recovered_after_real_clock", async () => {
  const { failed } = await run("FL-05", (world) => {
    world.product.downloadNow = (documentId) => {
      world.download(documentId);
      return { ok: true };
    };
  });
  assert.ok(failed.includes("row_recovered_after_real_clock"));
});

// ---- FL-06: revoke while offline ----------------------------------------------------

test("FL-06: the org revoke runs while the network is cut and the next renewal is refused with the row's status", async () => {
  const { world, byName, failed } = await run("FL-06");
  assert.deepEqual(failed, []);
  assert.deepEqual(world.vmCalls.filter((call) => call[0] === "revoke"), [["revoke"], ["revoke"]], "one revoke per window (the by-design regrant window, then the refused-regrant window)");
  assert.equal(byName.renew_refused_after_revoke.expected, "first PUT offline-lease answered 403 offline_lease_revoked");
  assert.match(byName.renew_refused_after_revoke.actual, /403 offline_lease_revoked/);
});

test("FL-06: a revoke CLI that fails is BLOCKED with its line, not a FAIL", async () => {
  const { outcome } = await run("FL-06", (world) => { world.revokeFails = true; });
  assert.match(outcome.blocker, /uniwork-admin revoke-offline-leases exited 1/);
  assert.deepEqual(outcome.assertions, []);
});

test("FL-06: a revoke that never took effect (renewal still 200) fails renew_refused_after_revoke", async () => {
  const { failed } = await run("FL-06", (world) => {
    world.ctx.revokeOfflineLeases = async () => ({ failure: null, evidence: { line: "x", orgId: "01JORGANIZATION000000000", epoch: 2, revoked: 1 } });
  });
  assert.ok(failed.includes("renew_refused_after_revoke"));
  assert.ok(failed.includes("row_revoked"));
});

test("FL-06: a product that still opens a revoked copy fails the refusal", async () => {
  const { failed } = await run("FL-06", (world) => {
    world.product.open = (documentId) => {
      world.download(documentId);
      return { ok: true };
    };
  });
  assert.ok(failed.includes("open_refused_permission_revoked"));
});

test("FL-06: a revoked row that leaves a plaintext copy fails no_plaintext_copy_left", async () => {
  const { failed } = await run("FL-06", (world) => {
    const open = world.product.open;
    world.product.open = (documentId) => {
      world.writeRecord(join(world.userData, "uniwork-documents", "default", "01JACCOUNTAAAAAAAAAAAAAAAA", "abc@offline"), "doc.docx", Buffer.from("PLAINTEXT"));
      return open(documentId);
    };
  });
  assert.ok(failed.includes("no_plaintext_copy_left"));
});

// ---- FL-09: keystore locked ---------------------------------------------------------

test("FL-09: the keyring is locked after the first launch, unlocked afterwards, and the recovery is in-app when the process can retry", async () => {
  const { world, byName, failed } = await run("FL-09");
  assert.deepEqual(failed, []);
  const keyring = world.vmCalls.filter((call) => call[0] === "keyring").map((call) => call[1]);
  assert.deepEqual(keyring.slice(0, 2), ["lock", "unlock"]);
  assert.equal(keyring.at(-1), "unlock", "the shared keyring is never left locked");
  assert.match(byName.row_recovered_after_unlock.expected, /in-app retry/);
});

test("FL-09: a process that keeps its failed keyring state is recovered by a relaunch, and the path is named", async () => {
  const { world, byName, failed } = await run("FL-09", (w) => { w.keyringSticky = true; });
  assert.deepEqual(failed, []);
  assert.match(byName.row_recovered_after_unlock.expected, /after relaunch/);
  assert.equal(world.launches.length, 3);
});

test("FL-09: a VM whose runner was not started in keyring control mode is BLOCKED with the exact line and nothing was launched", async () => {
  const { world, outcome } = await run("FL-09", (w) => { w.keyringControl = false; });
  assert.match(outcome.blocker, /^APP_KEYRING_CTL is not set: run the runner as `APP_KEYRING_CONTROL=1 /);
  assert.equal(world.launches.length, 0);
});

test("FL-09: a lock the wrapper refuses is BLOCKED with the wrapper's answer", async () => {
  const { outcome } = await run("FL-09", (w) => { w.keyringLockFails = true; });
  assert.match(outcome.blocker, /answered lock with: fail: the collection is still unlocked/);
});

test("FL-09: a product that opens content with the keystore locked fails the refusal", async () => {
  const { failed } = await run("FL-09", (world) => {
    world.product.open = (documentId) => {
      world.download(documentId);
      return { ok: true };
    };
  });
  assert.ok(failed.includes("open_refused_keystore_locked"));
});

test("FL-09: a store write while the keystore is locked fails nothing_decrypted", async () => {
  const { failed } = await run("FL-09", (world) => {
    const open = world.product.open;
    world.product.open = (documentId) => {
      world.writeRecord(world.libraryDir(), `blob/${documentId}/g2/main`, Buffer.from("rewritten"));
      return open(documentId);
    };
  });
  assert.ok(failed.includes("nothing_decrypted"));
});

test("FL-09: a content download that REACHED the server while locked fails nothing_decrypted (a reset attempt does not)", async () => {
  const { failed, byName } = await run("FL-09", (world) => {
    const open = world.product.open;
    world.product.open = (documentId) => {
      // the first attempt is the cut (reset); a second one slips through to the server
      world.log.push({ method: "GET", path: `/api/v1/documents/${documentId}/download`, status: 200, ruleId: null });
      return open(documentId);
    };
  });
  assert.ok(failed.includes("nothing_decrypted"), JSON.stringify(byName.nothing_decrypted));
});

test("FL-09: the keyring is unlocked again even when the run throws while it is locked", async () => {
  const world = createWorld("FL-09");
  try {
    // the relaunch under the locked keyring never comes up: the driver ends while the keystore is still locked
    const launch = world.ctx.launch;
    world.ctx.launch = async (options) => {
      if (world.keyringLocked) throw new Error("electron did not start");
      return launch(options);
    };
    await assert.rejects(() => OFFLINE_FAULT_DRIVERS["FL-09"](world.ctx), (error) => error instanceof AppBlocked);
    assert.equal(world.keyringLocked, false);
    assert.equal(world.vmCalls.filter((call) => call[0] === "keyring").at(-1)[1], "unlock");
  } finally {
    world.clean();
  }
});
