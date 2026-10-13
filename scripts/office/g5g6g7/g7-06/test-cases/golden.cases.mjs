// AC-1 cases of the `golden` check (G7-06 contract 2.3): the checked-in fake
// captures against goldens built from them (green), and each planted pixel,
// size or byte mutation (red, with the reason the contract names).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { sha256Hex } from "../../../../../apps/web/platform/office-frame/frame-bundle.mjs";
import { runBrandCheck } from "../brand-check.mjs";
import { runGoldenCheck, updateGoldens } from "../golden-check.mjs";
import { DEFAULT_PIN_DIR, HOSTS, REPO_ROOT, sameRevision } from "../job-lib.mjs";
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

/** The build the fake captures come from: what --update-goldens is told it is blessing. */
const UPDATE_ID = { pinVersion: FAKE_CAPTURE.pinVersion, forkSha: FAKE_CAPTURE.forkSha };

function goldenWorld({ fixtures = [ONE], mutateCapture = null, transform = null, masks = {}, tolerance = null, maskLimits = null, viewport = undefined, removeGolden = null, metaStatus = null, meta = null } = {}) {
  const captures = fx.mkCaptures(tmpDir("g7-06-captures-"));
  const goldens = fx.writeGoldens(tmpDir("g7-06-goldens-"), { capturesDir: captures, fixtures, hosts: HOSTS, masks, tolerance, maskLimits, viewport, transform: transform ?? undefined });
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
  // a run blocked before any pair (manifest problems) writes no summary
  const summaryPath = join(dir, "golden", "summary.json");
  return { check, summary: existsSync(summaryPath) ? readJson(summaryPath) : null };
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

test("golden: a goldens dir without manifest.json is BLOCKED, not a golden_missing", () => {
  const captures = fx.mkCaptures(tmpDir("g7-06-captures-"));
  const dir = outDir("golden-no-manifest");
  const check = runGoldenCheck({
    capturesDir: captures,
    goldensDir: tmpDir("g7-06-goldens-"),
    fixtures: [ONE],
    outDir: dir,
    forkSha: FAKE_CAPTURE.forkSha,
    pinVersion: FAKE_CAPTURE.pinVersion,
  });
  assert.equal(check.status, "BLOCKED");
  assert.deepEqual(check.reasons, ["goldens_manifest_missing"]);
});

test("--update-goldens copies the captures, keeps the masks and passes afterwards", () => {
  const captures = fx.mkCaptures(tmpDir("g7-06-captures-"));
  const goldens = tmpDir("g7-06-goldens-");
  mkdirSync(join(goldens, "desktop"), { recursive: true });
  writeFileSync(join(goldens, "manifest.json"), JSON.stringify({ schema: 1, entries: { [`desktop/${ONE}`]: { sha256: "0".repeat(64), masks: [{ x: 1, y: 1, w: 2, h: 2, reason: "old mask" }] } } }));
  const updated = updateGoldens({ capturesDir: captures, goldensDir: goldens, fixtures: [ONE], hosts: HOSTS, ...UPDATE_ID, outDir: outDir("golden-update") });
  assert.equal(updated.status, "PASS", JSON.stringify(updated.reasons));
  const manifest = readJson(join(goldens, "manifest.json"));
  assert.deepEqual(manifest.entries[`desktop/${ONE}`].masks, [{ x: 1, y: 1, w: 2, h: 2, reason: "old mask" }]);
  assert.equal(manifest.entries[`desktop/${ONE}`].sha256, sha256Hex(readFileSync(join(goldens, "desktop", `${ONE}.png`))));
  assert.deepEqual(manifest.tolerance, { channel: 16, ratio: 0.001 });
  // one viewport per host, each from that host's capture meta
  assert.deepEqual(manifest.viewport, { desktop: { w: 64, h: 48 }, web: { w: 64, h: 48 } });
  const { check } = goldenRun({ captures, goldens });
  assert.equal(check.status, "PASS", JSON.stringify(check.reasons));
});

test("--update-goldens with a missing capture blocks instead of inventing it", () => {
  const captures = fx.mkCaptures(tmpDir("g7-06-captures-"));
  rmSync(join(captures, "desktop", `${ONE}.png`));
  const updated = updateGoldens({ capturesDir: captures, goldensDir: tmpDir("g7-06-goldens-"), fixtures: [ONE], hosts: HOSTS, ...UPDATE_ID, outDir: outDir("golden-update-blocked") });
  assert.equal(updated.status, "BLOCKED");
  assert.deepEqual(updated.reasons, [`capture_missing:desktop/${ONE}`]);
});

test("--update-goldens refuses a pair the brand check fails", () => {
  const captures = fx.mkCaptures(tmpDir("g7-06-captures-"));
  writeFileSync(join(captures, "desktop", `${ONE}.txt`), "GenOffice — báo cáo doanh thu quý một của khu vực.\n");
  const updated = updateGoldens({ capturesDir: captures, goldensDir: tmpDir("g7-06-goldens-"), fixtures: [ONE], hosts: HOSTS, ...UPDATE_ID, outDir: outDir("golden-update-brand") });
  assert.equal(updated.status, "BLOCKED");
  assert.deepEqual(updated.reasons, [`brand_text:desktop/${ONE}/${ONE}.txt`]);
});

for (const [name, file] of [["host page", "host.txt"], ["desktop shell", "shell.txt"]]) {
  test(`--update-goldens refuses a pair whose brand text sits only in the ${name} text (${file}), as the brand check does (R2-1)`, () => {
    const captures = fx.mkCaptures(tmpDir("g7-06-captures-"));
    for (const host of HOSTS) writeFileSync(join(captures, host, `${ONE}.${file}`), "Tài liệu mở trong GenOffice\n");
    const goldens = tmpDir("g7-06-goldens-");
    const updated = updateGoldens({ capturesDir: captures, goldensDir: goldens, fixtures: [ONE], hosts: HOSTS, ...UPDATE_ID, outDir: outDir(`golden-update-brand-${file}`) });
    assert.equal(updated.status, "BLOCKED");
    assert.deepEqual(updated.reasons, [`brand_text:desktop/${ONE}/${ONE}.${file}`, `brand_text:web/${ONE}/${ONE}.${file}`]);
    assert.equal(existsSync(join(goldens, "desktop", `${ONE}.png`)), false, "nothing was blessed");
    // the same captures fail the brand check, so the bootstrap and the check can never disagree
    const brand = runBrandCheck({ capturesDir: captures, outDir: outDir("golden-update-brand-check"), fixtures: [ONE], ...UPDATE_ID });
    assert.equal(brand.status, "FAIL");
  });
}

test("--update-goldens refuses a pair under the no_rendered_text threshold", () => {
  const captures = fx.mkCaptures(tmpDir("g7-06-captures-"));
  writeFileSync(join(captures, "desktop", `${ONE}.txt`), "quá ngắn");
  const updated = updateGoldens({ capturesDir: captures, goldensDir: tmpDir("g7-06-goldens-"), fixtures: [ONE], hosts: HOSTS, ...UPDATE_ID, outDir: outDir("golden-update-short") });
  assert.equal(updated.status, "BLOCKED");
  assert.deepEqual(updated.reasons, [`no_rendered_text:desktop/${ONE}`]);
});

test("--update-goldens refuses a pair without rendered text or with a failed capture", () => {
  const noText = fx.mkCaptures(tmpDir("g7-06-captures-"));
  rmSync(join(noText, "desktop", `${ONE}.txt`));
  const missing = updateGoldens({ capturesDir: noText, goldensDir: tmpDir("g7-06-goldens-"), fixtures: [ONE], hosts: HOSTS, ...UPDATE_ID, outDir: outDir("golden-update-notext") });
  assert.equal(missing.status, "BLOCKED");
  assert.deepEqual(missing.reasons, [`rendered_text_missing:desktop/${ONE}`]);
  const failedWorld = goldenWorld({ metaStatus: { fixture: ONE, status: "failed" } });
  const failed = updateGoldens({ capturesDir: failedWorld.captures, goldensDir: tmpDir("g7-06-goldens-"), fixtures: [ONE], hosts: HOSTS, ...UPDATE_ID, outDir: outDir("golden-update-failed") });
  assert.equal(failed.status, "BLOCKED");
  assert.ok(failed.reasons.includes(`capture_failed:desktop/${ONE}`), JSON.stringify(failed.reasons));
});

test("the job's fixtures are the six the G7-A04 row names", () => {
  const matrix = readJson(join(REPO_ROOT, "docs", "office", "g5g6g7", "acceptance-rows.json"));
  const row = matrix.rows.find((candidate) => candidate.id === "G7-A04");
  assert.deepEqual(FIXTURES, row.fixtures.map((fixture) => fixture.id));
  assert.equal(FIXTURES.length, 6);
});

test("the committed goldens manifest matches its PNG files", () => {
  const manifest = readJson(join(JOB_DIR, "goldens", "manifest.json"));
  assert.equal(manifest.schema, 1);
  assert.deepEqual(manifest.viewport, { desktop: { w: 1440, h: 900 }, web: { w: 1720, h: 980 } });
  // Which build the goldens were blessed at is the live test below; here the
  // manifest only has to name one, whatever the checkout pins today.
  assert.match(manifest.pinVersion, /^\d+\.\d+\.\d+-[0-9a-f]{7,}$/);
  assert.match(manifest.forkSha, /^[0-9a-f]{7,40}$/);
  assert.ok(manifest.pinVersion.endsWith(`-${manifest.forkSha.slice(0, 7)}`), `${manifest.pinVersion} vs ${manifest.forkSha}`);
  assert.deepEqual(manifest.tolerance, { channel: 16, ratio: 0.001 });
  assert.deepEqual(manifest.maskLimits, { maxAreaSharePerMask: 0.05, maxAreaSharePerEntry: 0.1 });
  const expected = HOSTS.flatMap((host) => FIXTURES.map((fixture) => `${host}/${fixture}`));
  assert.equal(expected.length, 12);
  assert.deepEqual(Object.keys(manifest.entries).sort(), [...expected].sort());
  for (const [key, entry] of Object.entries(manifest.entries)) {
    const file = join(JOB_DIR, "goldens", `${key}.png`);
    assert.ok(existsSync(file), `${key}: PNG missing`);
    assert.equal(entry.sha256, sha256Hex(readFileSync(file)), `${key}: sha256 differs from the PNG on disk`);
    assert.ok(Array.isArray(entry.masks), `${key}: masks is not an array`);
  }
  for (const host of HOSTS) {
    const onDisk = readdirSync(join(JOB_DIR, "goldens", host)).filter((name) => name.endsWith(".png"));
    for (const name of onDisk) {
      assert.ok(`${host}/${name.slice(0, -4)}` in manifest.entries, `${host}/${name}: PNG without a manifest entry`);
    }
  }
});

test("live pin: the committed goldens were blessed at the pin apps/web ships (docs.pin.json)", () => {
  // Compares two live sources with each other, no constant: after a re-pin this
  // is red until the goldens are re-blessed (job.mjs --update-goldens).
  const manifest = readJson(join(JOB_DIR, "goldens", "manifest.json"));
  const pin = readJson(join(DEFAULT_PIN_DIR, "docs.pin.json"));
  assert.equal(manifest.pinVersion, pin.version);
  assert.ok(sameRevision(manifest.forkSha, pin.gitSha), `${manifest.forkSha} vs ${pin.gitSha}`);
});

test("golden: the old flat viewport shape in manifest.json is BLOCKED invalid_manifest, never read as one for both hosts", () => {
  for (const [label, viewport] of [
    ["flat", { w: 1440, h: 900 }],
    ["one host", { desktop: { w: 64, h: 48 } }],
    ["not whole pixels", { desktop: { w: 64, h: 48 }, web: { w: "wide", h: 48 } }],
    ["absent", null],
  ]) {
    const world = goldenWorld({ viewport });
    if (viewport === null) {
      const manifest = readJson(join(world.goldens, "manifest.json"));
      delete manifest.viewport;
      writeFileSync(join(world.goldens, "manifest.json"), JSON.stringify(manifest));
    }
    const { check } = goldenRun(world, { name: "golden-invalid-manifest" });
    assert.equal(check.status, "BLOCKED", label);
    assert.match(check.reasons[0], /^invalid_manifest \(viewport/, label);
  }
});

test("golden: each pair is compared at its host's viewport; a capture taken at another one is BLOCKED, the other host still passes", () => {
  const world = goldenWorld({ viewport: { desktop: { w: 64, h: 48 }, web: { w: 128, h: 96 } } });
  const { check, summary } = goldenRun(world, { name: "golden-viewport" });
  assert.equal(check.status, "BLOCKED");
  assert.deepEqual(check.reasons, ["captures_at_another_viewport"]);
  const byHost = Object.fromEntries(summary.pairs.map((pair) => [pair.host, pair.status]));
  assert.deepEqual(byHost, { desktop: "PASS", web: "BLOCKED" });
});

test("golden: a capture meta without a viewport cannot prove its host's viewport and is BLOCKED", () => {
  const world = goldenWorld({ meta: (meta) => { delete meta.viewport; return meta; } });
  const { check } = goldenRun(world, { name: "golden-no-viewport" });
  assert.equal(check.status, "BLOCKED");
  assert.deepEqual(check.reasons, ["captures_at_another_viewport"]);
});

test("--update-goldens runs the same capture/pin identity check as the compare path: captures of another build are BLOCKED, never blessed (N-2)", () => {
  for (const [label, patch] of [["pin", { pinVersion: "0.1.0-other" }], ["sha", { forkSha: "a".repeat(40) }]]) {
    const world = goldenWorld({ meta: patch });
    const goldens = tmpDir("g7-06-goldens-");
    const updated = updateGoldens({ capturesDir: world.captures, goldensDir: goldens, fixtures: [ONE], hosts: HOSTS, ...UPDATE_ID, outDir: outDir(`golden-update-other-${label}`) });
    assert.equal(updated.status, "BLOCKED", label);
    assert.deepEqual(updated.reasons, [`captures_from_another_pin:desktop/${ONE}`, `captures_from_another_pin:web/${ONE}`], label);
    assert.equal(existsSync(join(goldens, "desktop", `${ONE}.png`)), false, `${label}: nothing was copied`);
    assert.deepEqual(readJson(join(goldens, "manifest.json")).entries, {}, label);
  }
  // no identity to bless against is the same block, not a free pass
  const captures = fx.mkCaptures(tmpDir("g7-06-captures-"));
  const anonymous = updateGoldens({ capturesDir: captures, goldensDir: tmpDir("g7-06-goldens-"), fixtures: [ONE], hosts: HOSTS, outDir: outDir("golden-update-anonymous") });
  assert.equal(anonymous.status, "BLOCKED");
  assert.deepEqual(anonymous.reasons, [`captures_from_another_pin:desktop/${ONE}`, `captures_from_another_pin:web/${ONE}`]);
});

test("--update-goldens carries maskLimits and tolerance of the previous manifest instead of resetting them to the defaults (N-3)", () => {
  const captures = fx.mkCaptures(tmpDir("g7-06-captures-"));
  const goldens = tmpDir("g7-06-goldens-");
  const limits = { maxAreaSharePerMask: 0.02, maxAreaSharePerEntry: 0.04 };
  const tolerance = { channel: 8, ratio: 0.0005 };
  writeFileSync(join(goldens, "manifest.json"), JSON.stringify({ schema: 1, tolerance, maskLimits: limits, entries: {} }));
  const updated = updateGoldens({ capturesDir: captures, goldensDir: goldens, fixtures: [ONE], hosts: HOSTS, ...UPDATE_ID, outDir: outDir("golden-update-limits") });
  assert.equal(updated.status, "PASS", JSON.stringify(updated.reasons));
  const manifest = readJson(join(goldens, "manifest.json"));
  assert.deepEqual(manifest.maskLimits, limits);
  assert.deepEqual(manifest.tolerance, tolerance);
  // a manifest that never had them gets the documented defaults, written out so they live in the file
  const fresh = tmpDir("g7-06-goldens-");
  updateGoldens({ capturesDir: captures, goldensDir: fresh, fixtures: [ONE], hosts: HOSTS, ...UPDATE_ID, outDir: outDir("golden-update-limits-fresh") });
  assert.deepEqual(readJson(join(fresh, "manifest.json")).maskLimits, { maxAreaSharePerMask: 0.05, maxAreaSharePerEntry: 0.1 });
});

for (const [label, patchViewport, host] of [
  ["no viewport", (meta) => { delete meta.viewport; return meta; }, "desktop"],
  ["a negative viewport size", (meta) => ({ ...meta, viewport: { w: -1, h: 48 } }), "desktop"],
  ["a fractional viewport size", (meta) => ({ ...meta, viewport: { w: 64.5, h: 48 } }), "web"],
  ["another viewport than the manifest's for that host", (meta) => ({ ...meta, viewport: { w: 128, h: 96 } }), "web"],
]) {
  test(`--update-goldens blocks a pair whose meta carries ${label}, as the compare path does (R3-1)`, () => {
    const world = goldenWorld();
    const before = readJson(join(world.goldens, "manifest.json"));
    const bytesBefore = readFileSync(join(world.goldens, host, `${ONE}.png`));
    patchMeta(world.captures, (meta, metaHost) => (metaHost === host ? patchViewport(meta) : meta));
    const compare = goldenRun(world, { name: "golden-update-viewport-compare" }).check;
    assert.equal(compare.status, "BLOCKED");
    assert.deepEqual(compare.reasons, ["captures_at_another_viewport"]);
    const updated = updateGoldens({ capturesDir: world.captures, goldensDir: world.goldens, fixtures: [ONE], hosts: HOSTS, ...UPDATE_ID, outDir: outDir("golden-update-viewport") });
    assert.equal(updated.status, "BLOCKED");
    assert.deepEqual(updated.reasons, [`captures_at_another_viewport:${host}/${ONE}`]);
    assert.deepEqual(readFileSync(join(world.goldens, host, `${ONE}.png`)), bytesBefore, "nothing was copied");
    assert.deepEqual(readJson(join(world.goldens, "manifest.json")).entries[`${host}/${ONE}`], before.entries[`${host}/${ONE}`]);
  });
}

test("--update-goldens takes a host's viewport from its meta only when that host was blessed; a blocked host keeps its prior one (R3-2)", () => {
  const world = goldenWorld({ viewport: { desktop: { w: 64, h: 48 }, web: { w: 128, h: 96 } } });
  patchMeta(world.captures, (meta, host) => (host === "web" ? { ...meta, forkSha: "e".repeat(7), viewport: { w: 999, h: 888 } } : meta));
  const updated = updateGoldens({ capturesDir: world.captures, goldensDir: world.goldens, fixtures: [ONE], hosts: HOSTS, ...UPDATE_ID, outDir: outDir("golden-update-blocked-viewport") });
  assert.equal(updated.status, "BLOCKED");
  assert.deepEqual(updated.reasons, [`captures_from_another_pin:web/${ONE}`]);
  assert.deepEqual(readJson(join(world.goldens, "manifest.json")).viewport, { desktop: { w: 64, h: 48 }, web: { w: 128, h: 96 } });
});
