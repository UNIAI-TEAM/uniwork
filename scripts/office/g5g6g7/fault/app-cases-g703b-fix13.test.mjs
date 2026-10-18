// G7-03b (UNI-1382) fix13: cloud round 6 failure. FL-09 expects the hidden offline tab after the keystore S11 lock,
// like FL-07/08 (the pin index cannot be decrypted, so the fork shows no tablist). Each test was RED on 72f142673.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-g703b-fix13.test.mjs
import "./app-cases-fl-fast.mjs";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureRowShots } from "./app-case-drivers-offline.mjs";
import { OFFLINE_FAULT_DRIVERS } from "./app-case-drivers-offline-faults.mjs";
import { createWorld } from "./app-cases-fl-fakes.mjs";

const HIDDEN = "s3_tab_hidden_keystore_locked";
const SHOTS = mkdtempSync(join(tmpdir(), "fix13-shots-"));

async function runFl09(tweak = () => {}) {
  const world = createWorld("FL-09");
  try {
    tweak(world);
    const outcome = await OFFLINE_FAULT_DRIVERS["FL-09"](world.ctx);
    const byName = Object.fromEntries(outcome.assertions.map((a) => [a.name, a]));
    return { world, outcome, byName, failed: outcome.assertions.filter((a) => !a.ok).map((a) => a.name), artifacts: [...world.row.artifacts] };
  } finally {
    world.clean();
  }
}

test("fix13: FL-09 with no tablist after the S11 lock passes, S11 then the keystore-locked pane shot", async () => {
  const { byName, failed, artifacts } = await runFl09();
  assert.deepEqual(failed, []);
  assert.equal(byName.s11_shot.ok, true);
  assert.equal(byName[HIDDEN].ok, true);
  assert.match(byName[HIDDEN].actual, /offlineTabs=0/);
  assert.equal(byName.s3_pane_names_no_document.ok, true);
  assert.equal(byName.s3_shot.expected, "s3-keystore-locked-pane.png");
  assert.equal(byName.s3_tab_selected, undefined, "a tab the product does not show is never required selected");
  assert.deepEqual(artifacts.filter((a) => a.endsWith(".png")), ["s3-keystore-locked-pane.png", "s11-lock-panel.png"]);
});

test("fix13: FL-09 fails when a selectable offline tab is shown with the keystore locked", async () => {
  const { failed, byName } = await runFl09((world) => { world.signedOutTab = true; });
  assert.ok(failed.includes(HIDDEN), JSON.stringify(byName[HIDDEN]));
});

test("fix13: FL-09 fails when the locked pane names the document", async () => {
  const { failed } = await runFl09((world) => { world.paneText = "Thư viện khóa. FL-09 run 1"; });
  assert.ok(failed.includes("s3_pane_names_no_document"));
  assert.ok(!failed.includes(HIDDEN), "the tab is still absent");
});

test("fix13: FL-09 fails (not passes) when the pane never shows", async () => {
  const { failed } = await runFl09((world) => { world.paneMissing = true; });
  assert.ok(failed.includes(HIDDEN));
  assert.ok(failed.includes("s3_shot"));
});

/** A shell recording the order of its calls; the lock layer is gone only after a dismiss and a reload. */
function recordingSession() {
  const calls = [];
  const state = { lockUp: true, dismissed: false };
  const shell = {
    evaluate: async (fn, arg) => {
      if (String(fn).includes("dismissUniworkLock")) {
        calls.push("dismiss");
        state.dismissed = true;
        return undefined;
      }
      if (Array.isArray(arg) && arg[0] === "uniwork:open-settings") {
        calls.push("settings-event");
        return undefined;
      }
      calls.push("read-pane");
      return { pane: true, offlineTabs: 0, namedHits: 0 };
    },
    reload: async () => {
      calls.push("reload");
      if (state.dismissed) state.lockUp = false;
    },
    waitForSelector: async (selector, opts = {}) => {
      calls.push(`wait:${selector}${opts.state ? `:${opts.state}` : ""}`);
      if (selector === ".uw-lock-layer" && opts.state === "detached" && state.lockUp) throw new Error("the lock layer is still up");
    },
    waitForFunction: async () => {
      if (state.lockUp) throw new Error("the pane is behind the inert lock layer");
    },
    screenshot: async () => {
      calls.push("shot");
      return Buffer.from("png");
    },
  };
  return { session: { shell }, calls };
}

test("fix13: s11 + s3Hidden shoots S11 first, dismisses the lock panels, and only then reads and shoots the pane", async () => {
  const { session, calls } = recordingSession();
  const ctx = { appAlive: async () => true, artifactPath: (name) => join(SHOTS, name) };
  const shots = await captureRowShots(ctx, session, { s11: true, s3Hidden: { name: HIDDEN, artifact: "s3-keystore-locked-pane.png", names: [] } });
  assert.deepEqual(shots.map((shot) => shot.name), ["s11_shot", HIDDEN, "s3_pane_names_no_document", "s3_shot"]);
  assert.deepEqual(shots.filter((shot) => !shot.ok).map((shot) => shot.name), []);
  const at = (what) => calls.findIndex((call) => call === what);
  assert.ok(at("shot") >= 0 && at("shot") < at("dismiss"), calls.join(" > "));
  assert.ok(at("dismiss") < at("reload"));
  assert.ok(at("reload") < at("settings-event"));
  assert.ok(at("settings-event") < at("read-pane"));
});

test("fix13: s3Hidden without s11 (FL-07/08) never dismisses or reloads", async () => {
  const { session, calls } = recordingSession();
  session.shell.evaluate = async (fn, arg) => {
    if (Array.isArray(arg) && arg[0] === "uniwork:open-settings") calls.push("settings-event");
    else calls.push("read-pane");
    return Array.isArray(arg) && arg[0] === "uniwork:open-settings" ? undefined : { pane: true, offlineTabs: 0, namedHits: 0 };
  };
  const ctx = { appAlive: async () => true, artifactPath: (name) => join(SHOTS, name) };
  // no lock layer in this page: the wait for the pane must not be gated on a reload
  const state = {};
  session.shell.waitForFunction = async () => state;
  await captureRowShots(ctx, session, { s3Hidden: { name: "s3_tab_hidden_while_signed_out", names: [] } });
  assert.equal(calls.includes("reload"), false);
  assert.equal(calls.includes("dismiss"), false);
});
