// AC-1 cases of the `golden` check (G7-06 contract 2.3): the checked-in fake
// captures against goldens built from them (green), and each planted pixel,
// size or byte mutation (red, with the reason the contract names).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { sha256Hex } from "../../../../../apps/web/platform/office-frame/frame-bundle.mjs";
import { runGoldenCheck, updateGoldens } from "../golden-check.mjs";
import { HOSTS, REPO_ROOT } from "../job-lib.mjs";
import * as fx from "../test-fixtures/capture-fixtures.mjs";
import { FAKE_CAPTURE } from "../test-fixtures/fake-capture.mjs";
import { FIXTURES, JOB_DIR, ONE, outDir, readJson, tmpDir } from "../test-fixtures/test-env.mjs";


/** Rewrite (or remove) each host's meta.json in a captures copy. */
function patchMeta(captures, patch) {
  for (const host of HOSTS) {
    const file = join(captures, host, "meta.json");
    const meta = readJson(file);
    const next = typeof patch === "function" ? patch(meta, host) : { ...meta, ...patch };
    if (next === null) rmSync(file, { force: true });
    else writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  }
}

function goldenWorld({ fixtures = [ONE], mutateCapture = null, transform = null, masks = {}, tolerance = null, maskLimits = null, removeGolden = null, metaStatus = null, meta = null } = {}) {
  const captures = fx.mkCaptures(tmpDir("g7-06-captures-"));
  const goldens = fx.writeGoldens(tmpDir("g7-06-goldens-"), { capturesDir: captures, fixtures, hosts: HOSTS, masks, tolerance, maskLimits, transform: transform ?? undefined });
  if (mutateCapture) mutateCapture(captures);
  if (removeGolden) rmSync(join(goldens, removeGolden), { force: true });
  if (metaStatus) {
    for (const host of HOSTS) {
      const meta = readJson(join(captures, host, "meta.json"));
      meta.fixtures[metaStatus.fixture].status = metaStatus.status;
      writeFileSync(join(captures, host, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    }
  }
  if (meta) patchMeta(captures, meta);
  return { captures, goldens };
}

function goldenRun(
  { captures, goldens },
  { name = "golden", fixtures = [ONE], forkSha = FAKE_CAPTURE.forkSha, pinVersion = FAKE_CAPTURE.pinVersion } = {},
) {
  const dir = outDir(name);
  const check = runGoldenCheck({ capturesDir: captures, goldensDir: goldens, fixtures, outDir: dir, forkSha, pinVersion });
  return { check, summary: readJson(join(dir, "golden", "summary.json")) };
}

test("golden: identical captures pass on both hosts", () => {
  const world = goldenWorld({ fixtures: FIXTURES });
  const { check, summary } = goldenRun(world, { fixtures: FIXTURES });
  assert.equal(check.status, "PASS", JSON.stringify(check.reasons));
  assert.deepEqual(check.reasons, []);
  assert.equal(summary.pairs.length, FIXTURES.length * HOSTS.length);
  assert.ok(check.artifacts.includes("golden/summary.json"));
});

test("golden: a block outside the masks drifts", () => {
  const world = goldenWorld({ mutateCapture: (captures) => fx.recolorBlock(join(captures, "desktop", `${ONE}.png`), { x: 20, y: 20, w: 8, h: 8 }) });
  const { check } = goldenRun(world, { name: "golden-drift" });
  assert.equal(check.status, "FAIL");
  assert.deepEqual(check.reasons, ["golden_drift"]);
});

test("golden: the same block inside a mask is still a PASS", () => {
  const world = goldenWorld({
    masks: { [`desktop/${ONE}`]: [{ x: 20, y: 20, w: 8, h: 8, reason: "fake caret" }] },
    mutateCapture: (captures) => fx.recolorBlock(join(captures, "desktop", `${ONE}.png`), { x: 20, y: 20, w: 8, h: 8 }),
  });
  const { check } = goldenRun(world, { name: "golden-mask" });
  assert.equal(check.status, "PASS", JSON.stringify(check.reasons));
});

test("golden: one changed pixel stays under the ratio tolerance", () => {
  const world = goldenWorld({ mutateCapture: (captures) => fx.recolorBlock(join(captures, "desktop", `${ONE}.png`), { x: 20, y: 20, w: 1, h: 1 }) });
  const { check, summary } = goldenRun(world, { name: "golden-pixel" });
  assert.equal(check.status, "PASS");
  assert.equal(summary.pairs[0].pixels.changed, 1);
});

test("golden: a mask without a reason is invalid_mask, never a silent blank", () => {
  const world = goldenWorld({ masks: { [`desktop/${ONE}`]: [{ x: 20, y: 20, w: 8, h: 8 }] } });
  const { check } = goldenRun(world, { name: "golden-mask-noreason" });
  assert.equal(check.status, "FAIL");
  assert.match(check.reasons[0], /^invalid_mask \(desktop\/.*: mask 1: no reason\)$/);
});

test("golden: a mask outside the frame is invalid_mask, never clamped", () => {
  for (const [label, mask] of [
    ["over the edge", { x: 60, y: 20, w: 8, h: 8, reason: "stray" }],
    ["entirely outside", { x: -40, y: -40, w: 8, h: 8, reason: "stray" }],
    ["empty", { x: 4, y: 4, w: 0, h: 0, reason: "stray" }],
  ]) {
    const world = goldenWorld({ masks: { [`desktop/${ONE}`]: [mask] } });
    const { check } = goldenRun(world, { name: "golden-mask-bounds" });
    assert.equal(check.status, "FAIL", label);
    assert.match(check.reasons[0], /^invalid_mask \(desktop\//, label);
  }
});

test("golden: a mask over the per-mask area cap is invalid_mask, a smaller one passes", () => {
  const over = goldenWorld({ masks: { [`desktop/${ONE}`]: [{ x: 0, y: 0, w: 16, h: 10, reason: "too big" }] } }); // 160 px of 3072 = 5.2%
  const overCheck = goldenRun(over, { name: "golden-mask-oversize" }).check;
  assert.equal(overCheck.status, "FAIL");
  assert.match(overCheck.reasons[0], /^invalid_mask \(desktop\/.*: 5\.2% of the frame, over 5\.0%\)$/);
  const under = goldenWorld({ masks: { [`desktop/${ONE}`]: [{ x: 0, y: 0, w: 8, h: 16, reason: "caret" }] } }); // 128 px = 4.2%
  const underCheck = goldenRun(under, { name: "golden-mask-undersize" }).check;
  assert.equal(underCheck.status, "PASS", JSON.stringify(underCheck.reasons));
});

test("golden: masks whose total passes the entry cap are invalid_mask", () => {
  const masks = (count) =>
    Array.from({ length: count }, (_, index) => ({ x: index * 16, y: 0, w: 8, h: 12, reason: "clock" })); // 96 px = 3.125% each
  const three = goldenWorld({ masks: { [`desktop/${ONE}`]: masks(3) } }); // 9.375% <= 10%
  const threeCheck = goldenRun(three, { name: "golden-mask-total-ok" }).check;
  assert.equal(threeCheck.status, "PASS", JSON.stringify(threeCheck.reasons));
  const four = goldenWorld({ masks: { [`desktop/${ONE}`]: masks(4) } }); // 12.5% > 10%
  const fourCheck = goldenRun(four, { name: "golden-mask-total-over" }).check;
  assert.equal(fourCheck.status, "FAIL");
  assert.match(fourCheck.reasons[0], /^invalid_mask \(desktop\/.*: the masks cover 12\.5% of the frame, over 10\.0%\)$/);
});

test("golden: the mask limits come from manifest.json, not from code", () => {
  const world = goldenWorld({
    masks: { [`desktop/${ONE}`]: [{ x: 4, y: 4, w: 8, h: 8, reason: "caret" }] }, // 2.1%, valid by default
    maskLimits: { maxAreaSharePerMask: 0.01, maxAreaSharePerEntry: 0.1 },
  });
  const { check } = goldenRun(world, { name: "golden-mask-limits" });
  assert.equal(check.status, "FAIL");
  assert.match(check.reasons[0], /^invalid_mask \(desktop\//);
});

test("golden: the tolerance comes from manifest.json, not from code", () => {
  const world = goldenWorld({
    tolerance: { channel: 16, ratio: 0 },
    mutateCapture: (captures) => fx.recolorBlock(join(captures, "desktop", `${ONE}.png`), { x: 20, y: 20, w: 1, h: 1 }),
  });
  const { check, summary } = goldenRun(world, { name: "golden-tolerance" });
  assert.equal(check.status, "FAIL");
  assert.deepEqual(check.reasons, ["golden_drift"]);
  assert.deepEqual(summary.tolerances, { channel: 16, ratio: 0 });
});

test("golden: another size is size_mismatch", () => {
  const world = goldenWorld({ transform: (key, bytes) => (key === `desktop/${ONE}` ? fx.otherSizePng() : bytes) });
  const { check } = goldenRun(world, { name: "golden-size" });
  assert.equal(check.status, "FAIL");
  assert.deepEqual(check.reasons, ["size_mismatch"]);
});

test("golden: edited golden bytes are golden_tampered", () => {
  const world = goldenWorld();
  writeFileSync(join(world.goldens, "desktop", `${ONE}.png`), fx.otherSizePng());
  const { check } = goldenRun(world, { name: "golden-tampered" });
  assert.equal(check.status, "FAIL");
  assert.deepEqual(check.reasons, ["golden_tampered"]);
});

test("golden: a missing golden is golden_missing, never auto-created", () => {
  const world = goldenWorld({ removeGolden: join("desktop", `${ONE}.png`) });
  const { check } = goldenRun(world, { name: "golden-missing" });
  assert.equal(check.status, "FAIL");
  assert.deepEqual(check.reasons, ["golden_missing"]);
  assert.ok(!existsSync(join(world.goldens, "desktop", `${ONE}.png`)));
});

test("golden: a missing capture is BLOCKED", () => {
  const world = goldenWorld({ mutateCapture: (captures) => rmSync(join(captures, "desktop", `${ONE}.png`)) });
  const { check } = goldenRun(world, { name: "golden-nocapture" });
  assert.equal(check.status, "BLOCKED");
  assert.deepEqual(check.reasons, ["capture_missing"]);
});

test("golden: a capture the provider marked failed is BLOCKED", () => {
  const world = goldenWorld({ metaStatus: { fixture: ONE, status: "failed" } });
  const { check } = goldenRun(world, { name: "golden-failed" });
  assert.equal(check.status, "BLOCKED");
  assert.deepEqual(check.reasons, ["capture_failed"]);
});

test("golden: a meta.json that is not valid JSON is BLOCKED, never a crash", () => {
  const world = goldenWorld();
  writeFileSync(join(world.captures, "desktop", "meta.json"), "{ not json");
  const { check } = goldenRun(world, { name: "golden-corrupt-meta" });
  assert.equal(check.status, "BLOCKED");
  assert.deepEqual(check.reasons, ["capture_meta_unreadable"]);
});

test("golden: captures from another build are BLOCKED, never compared", () => {
  for (const [label, patch] of [["pin", { pinVersion: "0.1.0-other" }], ["sha", { forkSha: "a".repeat(40) }]]) {
    const world = goldenWorld({ meta: patch });
    const { check } = goldenRun(world, { name: `golden-other-${label}` });
    assert.equal(check.status, "BLOCKED", label);
    assert.deepEqual(check.reasons, ["captures_from_another_pin"], label);
  }
});

test("golden: a host without meta.json is BLOCKED, not treated as ok", () => {
  const world = goldenWorld({ meta: () => null });
  const { check } = goldenRun(world, { name: "golden-no-meta" });
  assert.equal(check.status, "BLOCKED");
  assert.deepEqual(check.reasons, ["capture_meta_missing"]);
});

test("golden: a pair status the provider does not write is BLOCKED, not ok", () => {
  const world = goldenWorld({
    meta: (meta) => {
      delete meta.fixtures;
      return meta;
    },
  });
  const { check } = goldenRun(world, { name: "golden-unknown-status" });
  assert.equal(check.status, "BLOCKED");
  assert.deepEqual(check.reasons, ["capture_status_unknown"]);
});

test("golden: a meta with the full fork SHA matches the pin's short one", () => {
  const world = goldenWorld({ meta: { forkSha: `cb76dde${"0".repeat(33)}` } });
  const { check } = goldenRun(world, { name: "golden-full-sha", forkSha: "cb76dde" });
  assert.equal(check.status, "PASS", JSON.stringify(check.reasons));
});

test("golden: no captures at all is BLOCKED, not a pass", () => {
  const missing = join(tmpDir("g7-06-nocaptures-"), "captures");
  const dir = outDir("golden-none");
  const check = runGoldenCheck({ capturesDir: missing, goldensDir: tmpDir("g7-06-goldens-"), fixtures: [ONE], outDir: dir });
  assert.equal(check.status, "BLOCKED");
  assert.deepEqual(check.reasons, ["captures_missing"]);
});

test("--update-goldens copies the captures, keeps the masks and passes afterwards", () => {
  const captures = fx.mkCaptures(tmpDir("g7-06-captures-"));
  const goldens = tmpDir("g7-06-goldens-");
  mkdirSync(join(goldens, "desktop"), { recursive: true });
  writeFileSync(join(goldens, "manifest.json"), JSON.stringify({ schema: 1, entries: { [`desktop/${ONE}`]: { sha256: "0".repeat(64), masks: [{ x: 1, y: 1, w: 2, h: 2, reason: "old mask" }] } } }));
  const updated = updateGoldens({ capturesDir: captures, goldensDir: goldens, fixtures: [ONE], hosts: HOSTS, pinVersion: "0.1.0-fake", forkSha: "f".repeat(7), outDir: outDir("golden-update") });
  assert.equal(updated.status, "PASS", JSON.stringify(updated.reasons));
  const manifest = readJson(join(goldens, "manifest.json"));
  assert.deepEqual(manifest.entries[`desktop/${ONE}`].masks, [{ x: 1, y: 1, w: 2, h: 2, reason: "old mask" }]);
  assert.equal(manifest.entries[`desktop/${ONE}`].sha256, sha256Hex(readFileSync(join(goldens, "desktop", `${ONE}.png`))));
  assert.deepEqual(manifest.tolerance, { channel: 16, ratio: 0.001 });
  const { check } = goldenRun({ captures, goldens });
  assert.equal(check.status, "PASS", JSON.stringify(check.reasons));
});

test("--update-goldens with a missing capture blocks instead of inventing it", () => {
  const captures = fx.mkCaptures(tmpDir("g7-06-captures-"));
  rmSync(join(captures, "desktop", `${ONE}.png`));
  const updated = updateGoldens({ capturesDir: captures, goldensDir: tmpDir("g7-06-goldens-"), fixtures: [ONE], hosts: HOSTS, outDir: outDir("golden-update-blocked") });
  assert.equal(updated.status, "BLOCKED");
  assert.deepEqual(updated.reasons, [`capture_missing:desktop/${ONE}`]);
});

test("the job's fixtures are the six the G7-A04 row names", () => {
  const matrix = readJson(join(REPO_ROOT, "docs", "office", "g5g6g7", "acceptance-rows.json"));
  const row = matrix.rows.find((candidate) => candidate.id === "G7-A04");
  assert.deepEqual(FIXTURES, row.fixtures.map((fixture) => fixture.id));
  assert.equal(FIXTURES.length, 6);
});

test("the committed goldens manifest is the schema, with no entries yet", () => {
  const manifest = readJson(join(JOB_DIR, "goldens", "manifest.json"));
  assert.equal(manifest.schema, 1);
  assert.deepEqual(manifest.entries, {});
  assert.deepEqual(manifest.tolerance, { channel: 16, ratio: 0.001 });
  assert.deepEqual(manifest.maskLimits, { maxAreaSharePerMask: 0.05, maxAreaSharePerEntry: 0.1 });
  assert.deepEqual(manifest.viewport, { w: 1440, h: 900 });
});
