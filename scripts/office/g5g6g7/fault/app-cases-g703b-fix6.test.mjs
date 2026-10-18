// G7-03b (UNI-1382) fix6: cloud round 3 failures (CL3-n). Each test was RED on c6fcf6c6a and is GREEN after the fix.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-g703b-fix6.test.mjs
import "./app-cases-fl-fast.mjs";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { captureRowShots, dismissLockPanels } from "./app-case-drivers-offline.mjs";

const FAULT_DIR = dirname(fileURLToPath(import.meta.url));
const ctxOf = () => ({ appAlive: async () => true, artifactPath: (name) => join(FAULT_DIR, "never-written", name) });

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
