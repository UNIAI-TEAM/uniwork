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

