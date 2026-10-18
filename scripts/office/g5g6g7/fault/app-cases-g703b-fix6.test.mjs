// G7-03b (UNI-1382) fix6: cloud round 3 failures (CL3-n). Each test was RED on c6fcf6c6a and is GREEN after the fix.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-g703b-fix6.test.mjs
import "./app-cases-fl-fast.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { captureRowShots, dismissLockPanels } from "./app-case-drivers-offline.mjs";
import { OFFLINE_FAULT_DRIVERS } from "./app-case-drivers-offline-faults.mjs";
import { createWorld } from "./app-cases-fl-fakes.mjs";
import { keyringPrompts } from "./app-offline-env.mjs";

const FAULT_DIR = dirname(fileURLToPath(import.meta.url));
// shots that do capture land in a scratch dir, never in the repo
const SHOTS = mkdtempSync(join(tmpdir(), "fix6-shots-"));
const ctxOf = () => ({ appAlive: async () => true, artifactPath: (name) => join(SHOTS, name) });

/** A shell page that records its calls; `lockUp` is the S11 layer, gone only once the page was reloaded after a dismiss. */
function fakeSession({ locks = [{ path: "/docs/a.docx" }] } = {}) {
  const calls = [];
  const state = { lockUp: true, dismissed: false, selected: false };
  const shell = {
    evaluate: async (fn) => {
      const source = String(fn);
      if (source.includes("dismissUniworkLock")) {
        calls.push("dismiss");
        state.dismissed = locks.length > 0;
      } else {
        calls.push("settings-event");
      }
    },
    reload: async () => {
      calls.push("reload");
      if (state.dismissed) state.lockUp = false;
    },
    waitForSelector: async (selector, opts = {}) => {
      calls.push(`wait:${selector}${opts.state ? `:${opts.state}` : ""}`);
      if (selector === ".uw-lock-layer" && opts.state === "detached" && state.lockUp) throw new Error("the lock layer is still up");
    },
    screenshot: async () => Buffer.from("png"),
    waitForFunction: async () => {
      state.selected = true;
    },
    locator: () => ({
      first: () => ({
        waitFor: async () => {
          // inert Home: the tab is never actionable behind the lock layer
          if (state.lockUp) throw new Error("the tab is behind the inert lock layer");
        },
        getAttribute: async () => (state.selected ? "true" : "false"),
        click: async () => {
          calls.push("click-tab");
        },
        isVisible: async () => state.selected,
      }),
    }),
  };
  return { session: { shell }, calls, state };
}

test("CL3-2: a row that shoots S11 then S3 dismisses the lock layer in between, so the offline tab opens and is selected", async () => {
  const { session, calls } = fakeSession();
  const shots = await captureRowShots(ctxOf(), session, { s11: true, s3: true });
  const byName = Object.fromEntries(shots.map((shot) => [shot.name, shot]));
  assert.equal(byName.s11_shot.ok, true);
  assert.equal(byName.s3_tab_selected.ok, true, JSON.stringify(byName.s3_tab_selected));
  assert.equal(byName.s3_shot.ok, true);
  // the order: S11 captured first, then the dismiss, the re-mount, and only then the settings event
  const at = (what) => calls.findIndex((call) => call === what);
  assert.ok(at("wait:.uw-lock-layer .uw-lock-panel") < at("dismiss"), calls.join(" > "));
  assert.ok(at("dismiss") < at("reload"));
  assert.ok(at("reload") < at("settings-event"));
});

test("CL3-2: a row without S11 (FL-01/FL-02) never dismisses or reloads, and an S11-only shot leaves the panel up", async () => {
  for (const flags of [{ s3: true }, { s11: true }]) {
    const { session, calls, state } = fakeSession();
    if (flags.s3) state.lockUp = false;
    await captureRowShots(ctxOf(), session, flags);
    assert.equal(calls.includes("dismiss"), false, JSON.stringify(flags));
    assert.equal(calls.includes("reload"), false, JSON.stringify(flags));
  }
});

test("CL3-2: a lock layer that survives the dismiss is reported, and the S3 reading then fails honestly (never a faked selection)", async () => {
  const { session, state } = fakeSession({ locks: [] });
  assert.equal(await dismissLockPanels(session, { timeoutMs: 50 }), false);
  assert.equal(state.lockUp, true);
  const second = fakeSession({ locks: [] });
  const shots = await captureRowShots(ctxOf(), second.session, { s11: true, s3: true });
  const tab = shots.find((shot) => shot.name === "s3_tab_selected");
  assert.equal(tab.ok, false);
  assert.match(tab.actual, /aria-selected=false panelVisible=false/);
});

// ---- CL3-1: FL-09 launches on a locked collection and the unlock prompt is answered (INJECTED) ------

async function runFl09(tweak = () => {}) {
  const world = createWorld("FL-09");
  try {
    tweak(world);
    const outcome = await OFFLINE_FAULT_DRIVERS["FL-09"](world.ctx);
    const files = Object.fromEntries(readdirSync(world.runDir).map((name) => [name, readFileSync(join(world.runDir, name), "utf8")]));
    return { world, outcome, files, failed: (outcome.assertions ?? []).filter((a) => !a.ok).map((a) => a.name) };
  } finally {
    world.clean();
  }
}

test("CL3-1: the unlock prompt is answered on the SECOND launch only; the first launch (unlocked keyring) raised none", async () => {
  const { world, files, failed } = await runFl09();
  assert.deepEqual(failed, []);
  const fact = JSON.parse(files["keyring-prompt-injected.json"]);
  assert.deepEqual(
    { injected: fact.injected, answer: fact.answer, before: fact.promptsAnsweredBeforeSecondLaunch, after: fact.promptsAnsweredAfterSecondLaunch },
    { injected: true, answer: "cancel", before: 0, after: 1 },
  );
  assert.match(fact.by, /app-keyring-prompter.py/);
  // the keyring is still unlocked again at the end, whatever the stub did (cleanup is unchanged)
  const keyring = world.vmCalls.filter((call) => call[0] === "keyring").map((call) => call[1]);
  assert.equal(keyring.at(-1), "unlock");
});

test("CL3-1: the row claims nothing about the prompt UI - the prompt is a recorded fact, never an assertion", async () => {
  const { outcome } = await runFl09();
  assert.equal(outcome.assertions.some((a) => /prompt/i.test(`${a.name} ${a.expected}`)), false);
});

test("CL3-1: a wrapper without its prompt stub is BLOCKED with the exact line and nothing was launched (the launch would stall 90 s)", async () => {
  const { world, outcome } = await runFl09((w) => { w.keyringPrompter = false; });
  assert.match(outcome.blocker, /^APP_KEYRING_PROMPTER_LOG is not set: the keyring wrapper did not start its unlock-prompt stub/);
  assert.equal(world.launches.length, 0);
});

test("CL3-1: keyringPrompts counts only the prompts the stub answered, and reads no file as 'not available'", () => {
  const log = [
    JSON.stringify({ event: "ready" }),
    JSON.stringify({ event: "begin" }),
    JSON.stringify({ event: "prompt", type: "password", answered: "cancel" }),
    "not json",
    JSON.stringify({ event: "prompt", type: "password", answered: "cancel" }),
    JSON.stringify({ event: "stop" }),
    "",
  ].join("\n");
  assert.deepEqual(keyringPrompts({ env: { APP_KEYRING_PROMPTER_LOG: "/p" }, read: () => log }), { available: true, answered: 2 });
  assert.deepEqual(keyringPrompts({ env: {} }), { available: false, answered: 0 });
  assert.deepEqual(keyringPrompts({ env: { APP_KEYRING_PROMPTER_LOG: "/p" }, read: () => { throw new Error("ENOENT"); } }), { available: false, answered: 0 });
});

test("CL3-1: the wrapper starts the stub in control mode only, stops it with the daemon, and the stub never unlocks or sees a password", () => {
  const script = readFileSync(join(FAULT_DIR, "app-keyring.sh"), "utf8");
  const stub = readFileSync(join(FAULT_DIR, "app-keyring-prompter.py"), "utf8");
  // started inside the control-mode branch, before the control loop can lock anything
  const branch = script.indexOf('if [ "${APP_KEYRING_CONTROL:-}" = 1 ]; then\n  start_prompter || exit 77\n');
  assert.ok(branch > 0, "start_prompter is the first thing of the control-mode branch");
  assert.ok(branch < script.indexOf("keyring_ctl_loop &"), "before the control loop can lock anything");
  assert.equal(script.split("\n").filter((line) => line.trim().startsWith("start_prompter ||")).length, 1, "the plain (non-control) mode never starts it");
  assert.ok(script.includes('export APP_KEYRING_PROMPTER_LOG="$WORK/prompter.log"'));
  assert.ok(script.includes('kill "$PROMPTER_PID"'), "it goes when the wrapper ends");
  // the stub answers cancel and takes no part in unlocking
  assert.ok(stub.includes('("no", {}, "")'));
  const code = stub.slice(stub.indexOf('"""', 3 + stub.indexOf('"""')) + 3);
  assert.equal(/unlock|password/i.test(code), false, "the code (docstring left out) never names an unlock or a password");
});


// ---- CL3-6: the settings event is lost while Home is not mounted yet (FL-08's freshly launched deployment B) ----

/** A shell whose Home mounts only after `lost` settings events went nowhere. */
function lateHomeShell(lost) {
  const state = { dispatches: 0, selected: false };
  const mounted = () => state.dispatches > lost;
  const shell = {
    evaluate: async (_fn, arg) => {
      if (Array.isArray(arg) && arg[0] === "uniwork:open-settings") {
        state.dispatches += 1;
        return undefined;
      }
      return { pane: true, offlineTabs: 0, namedHits: 0 };
    },
    waitForFunction: async (fn) => {
      if (!mounted()) throw new Error("the pane is not there");
      state.selected = true;
      return fn;
    },
    waitForSelector: async () => {},
    screenshot: async () => Buffer.from("png"),
    locator: () => ({
      first: () => ({
        waitFor: async () => { if (!mounted()) throw new Error("no tab yet"); },
        getAttribute: async () => (state.selected ? "true" : "false"),
        click: async () => { state.selected = true; },
        isVisible: async () => state.selected,
      }),
    }),
  };
  return { session: { shell }, state };
}

test("CL3-6: the signed-out sync center pane is read although the first settings events were lost (Home mounts late)", async () => {
  const { session, state } = lateHomeShell(2);
  const shots = await captureRowShots(ctxOf(), session, { s3Hidden: { name: "s3_tab_hidden_on_deployment_b", names: [] } });
  assert.deepEqual(shots.filter((shot) => !shot.ok).map((shot) => shot.name), []);
  assert.equal(shots[0].actual, "pane=showing offlineTabs=0");
  assert.equal(state.dispatches, 3, "the event was sent again until Home was there");
});

test("CL3-6: the offline tab is opened although the first settings events were lost", async () => {
  const { session, state } = lateHomeShell(2);
  const shots = await captureRowShots(ctxOf(), session, { s3: true });
  assert.deepEqual(shots.filter((shot) => !shot.ok).map((shot) => shot.name), []);
  assert.equal(state.dispatches, 3);
});

test("CL3-6: a pane that never shows is still read as 'not showing' once the wait ran out (the fault stays a FAIL)", async () => {
  const { session, state } = lateHomeShell(10_000);
  const shots = await captureRowShots(ctxOf(), session, { s3Hidden: { name: "s3_tab_hidden_on_deployment_b", names: [] } });
  assert.equal(shots[0].ok, false);
  assert.equal(shots[0].actual, "pane=not showing");
  assert.ok(state.dispatches >= 1);
});

// ---- CL3-5: FL-02's store comparison starts at the reservation, B's lease is written before the content ----

test("CL3-5: B's lease record (granted before the content download, manager.ts:918-937) is not a partial write while faulted", async () => {
  const world = createWorld("FL-02");
  try {
    const outcome = await OFFLINE_FAULT_DRIVERS["FL-02"](world.ctx);
    const byName = Object.fromEntries(outcome.assertions.map((a) => [a.name, a]));
    const faulted = JSON.parse(readFileSync(join(world.runDir, "offline-store-faulted.json"), "utf8"));
    const before = JSON.parse(readFileSync(join(world.runDir, "offline-store-before.json"), "utf8"));
    const had = new Set(before.records.map((record) => `${record.store}/${record.name}`));
    const added = faulted.records.map((record) => `${record.store}/${record.name}`).filter((key) => !had.has(key));
    assert.ok(added.some((key) => key.startsWith("offline-leases/")), `the faulted store holds B's lease: ${added.join(", ")}`);
    assert.equal(byName.nothing_partial_in_the_store.ok, true, JSON.stringify(byName.nothing_partial_in_the_store));
    assert.match(byName.nothing_partial_in_the_store.expected, /no record added after B's reservation and lease/);
  } finally {
    world.clean();
  }
});

// ---- CL3-4: FL-05 reads the lease at the cut; the startup renewal the server granted is not the clock extending it ----

async function runFl05(tweak = () => {}) {
  const world = createWorld("FL-05");
  try {
    tweak(world);
    const outcome = await OFFLINE_FAULT_DRIVERS["FL-05"](world.ctx);
    return { world, byName: Object.fromEntries(outcome.assertions.map((a) => [a.name, a])), failed: outcome.assertions.filter((a) => !a.ok).map((a) => a.name) };
  } finally {
    world.clean();
  }
}

test("CL3-4: the startup pass's online renewal under the rolled-back clock (a lease PUT 200 before the cut, fork lease/clock.ts:100-111) does not fail never_extends_lease", async () => {
  const { world, byName, failed } = await runFl05((w) => { w.renewAtRollbackLaunch = true; });
  assert.deepEqual(failed, []);
  assert.equal(byName.never_extends_lease.ok, true);
  const puts = world.log.filter((entry) => entry.method === "PUT" && String(entry.path).endsWith("/office/offline-lease") && entry.status === 200);
  assert.ok(puts.length >= 2, "the pin's grant and the startup renewal were both on the wire");
});

test("CL3-4: an expiry that moves later with NO lease PUT on the wire (the rolled-back clock extending it) still fails", async () => {
  const { byName } = await runFl05((w) => { w.extendOnRollback = true; });
  assert.equal(byName.never_extends_lease.ok, false);
});

test("CL3-4: a lease PUT answered 200 after the cut still fails (nothing may get through once the rule is set)", async () => {
  const { byName } = await runFl05((world) => {
    const rowsFor = world.product.rowsFor;
    world.product.rowsFor = (dep) => {
      if (world.rollbackLatched) {
        world.rules = [];
        world.leasePut([...world.rows.keys()][0]);
      }
      return rowsFor(dep);
    };
  });
  assert.equal(byName.never_extends_lease.ok, false);
});

test("G703-R6-1 / G703-R6-6: a startup renewal followed by a local post-cut extension fails never_extends_lease", async () => {
  const { byName } = await runFl05((world) => {
    world.renewAtRollbackLaunch = true;
    const origSetRules = world.ctx.setRules;
    let cutDone = false;
    world.ctx.setRules = async (rules) => {
      await origSetRules(rules);
      if (!cutDone && rules.some((r) => r.id === "cut-lease")) {
        cutDone = true;
        for (const lease of world.leases.values()) lease.grantedAt += 3_600_000;
      }
    };
  });
  assert.equal(byName.never_extends_lease.ok, false);
});
