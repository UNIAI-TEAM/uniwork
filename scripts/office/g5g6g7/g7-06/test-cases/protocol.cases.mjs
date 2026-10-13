// AC-1 cases of the `protocol` check (G7-06 contract 2.1, section 4, Amendment
// 1): green on fork = manifest = pins, red on each planted mutation with the
// reason the contract names, plus the real checkout's pins against a real fork.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { OFFICE_MODULES } from "../../../../../apps/web/platform/office-frame/frame-bundle.mjs";
import { DEFAULT_PIN_DIR } from "../job-lib.mjs";
import { readPins, runProtocolCheck } from "../protocol-check.mjs";
import * as fx from "../test-fixtures/fork-fixtures.mjs";
import { outDir, readJson, tmpDir } from "../test-fixtures/test-env.mjs";

// ---- protocol (contract 2.1) -------------------------------------------------

function protocolWorld() {
  const fork = fx.mkFakeFork(tmpDir("g7-06-fork-"));
  const pinDir = fx.writePins(tmpDir("g7-06-pins-"), { gitSha: fork.sha, protocolSha256: fork.digests });
  const installedRoot = fx.writeInstalled(tmpDir("g7-06-installed-"), { version: "0.1.0-fake", gitSha: fork.sha, protocolSha256: fork.digests });
  return { fork, pinDir, installedRoot };
}

function protocolRun({ fork, pinDir, installedRoot, forkSha = fork.sha, name = "protocol" }) {
  const dir = outDir(name);
  const check = runProtocolCheck({ forkDir: fork.dir, forkSha, installedRoot, pinDir, outDir: dir });
  return { check, artifact: readJson(join(dir, "protocol-hash.json")) };
}

test("protocol: fork = manifest = pins is a PASS", () => {
  const world = protocolWorld();
  const { check, artifact } = protocolRun(world);
  assert.equal(check.status, "PASS", JSON.stringify(check.reasons));
  assert.deepEqual(check.reasons, []);
  assert.deepEqual(artifact.recomputed, world.fork.digests);
  assert.ok(check.artifacts.includes("protocol-hash.json"));
});

test("protocol: nothing recording it is a NOTE, never a PASS", () => {
  const fork = fx.mkFakeFork(tmpDir("g7-06-fork-"));
  const pinDir = fx.writePins(tmpDir("g7-06-pins-"), { gitSha: fork.sha });
  const installedRoot = fx.writeInstalled(tmpDir("g7-06-installed-"), { version: "0.1.0-fake", gitSha: fork.sha });
  const { check, artifact } = protocolRun({ fork, pinDir, installedRoot, name: "protocol-note" });
  assert.equal(check.status, "NOTE");
  assert.deepEqual(check.reasons, ["protocol_sha256_not_recorded"]);
  assert.deepEqual(artifact.recomputed, fork.digests, "the recomputed hashes are said out loud");
});

test("protocol: one byte in fork host.ts is manifest_mismatch:host and pin_mismatch:*:host", () => {
  const world = protocolWorld();
  const forkSha = fx.commitProtocol(world.fork.dir, "host", "export const host = 2\n");
  const { check } = protocolRun({ ...world, forkSha, name: "protocol-byte" });
  assert.equal(check.status, "FAIL");
  assert.ok(check.reasons.includes("manifest_mismatch:host"), JSON.stringify(check.reasons));
  for (const module of OFFICE_MODULES) assert.ok(check.reasons.includes(`pin_mismatch:${module}:host`), module);
  assert.ok(!check.reasons.some((reason) => reason.includes(":protocol")), "only host changed");
});

test("protocol: recording on one side only is recorded_on_one_side", () => {
  const world = protocolWorld();
  const barePins = fx.writePins(tmpDir("g7-06-pins-"), { gitSha: world.fork.sha });
  const a = protocolRun({ ...world, pinDir: barePins, name: "protocol-side-manifest" });
  assert.equal(a.check.status, "FAIL");
  assert.ok(a.check.reasons.includes("recorded_on_one_side"));
  const bareInstalled = fx.writeInstalled(tmpDir("g7-06-installed-"), { version: "0.1.0-fake", gitSha: world.fork.sha });
  const b = protocolRun({ ...world, installedRoot: bareInstalled, name: "protocol-side-pins" });
  assert.equal(b.check.status, "FAIL");
  assert.ok(b.check.reasons.includes("recorded_on_one_side"));
});

test("protocol: a pin that differs from the others is pins_disagree", () => {
  const world = protocolWorld();
  const pinDir = fx.writePins(tmpDir("g7-06-pins-"), {
    gitSha: world.fork.sha,
    protocolSha256: world.fork.digests,
    perModule: { sheets: { ...world.fork.digests, host: "0".repeat(64) } },
  });
  const { check } = protocolRun({ ...world, pinDir, name: "protocol-disagree" });
  assert.equal(check.status, "FAIL");
  assert.ok(check.reasons.includes("pins_disagree"));
  assert.ok(check.reasons.includes("pin_mismatch:sheets:host"));
});

test("protocol: five of six pins recording it is pins_disagree too", () => {
  const world = protocolWorld();
  const pinDir = fx.writePins(tmpDir("g7-06-pins-"), { gitSha: world.fork.sha, protocolSha256: world.fork.digests, perModule: { docs: null } });
  const { check } = protocolRun({ ...world, pinDir, name: "protocol-partial" });
  assert.equal(check.status, "FAIL");
  assert.ok(check.reasons.includes("pins_disagree"));
});

test("protocol: a missing installed bundle is BLOCKED, never PASS", () => {
  const world = protocolWorld();
  const { check, artifact } = protocolRun({ ...world, installedRoot: null, name: "protocol-blocked" });
  assert.equal(check.status, "BLOCKED");
  assert.ok(check.reasons.some((reason) => reason.startsWith("installed_bundle_missing")));
  assert.equal(artifact.installed, null);
  assert.deepEqual(artifact.recomputed, world.fork.digests, "the fork half still ran");
});

test("protocol: an installed manifest of another commit is installed_manifest_mismatch:gitSha", () => {
  const world = protocolWorld();
  const other = fx.writeInstalled(tmpDir("g7-06-installed-"), { version: "0.1.0-fake", gitSha: "0".repeat(7), protocolSha256: world.fork.digests });
  const { check, artifact } = protocolRun({ ...world, installedRoot: other, name: "protocol-other-commit" });
  assert.equal(check.status, "FAIL");
  assert.ok(check.reasons.includes("installed_manifest_mismatch:gitSha"), JSON.stringify(check.reasons));
  assert.ok(!check.reasons.includes("installed_manifest_mismatch:version"), "the version is the pin's; the build is not");
  assert.deepEqual(artifact.recomputed, world.fork.digests, "the hashes agree — only the bundle identity does not");
});

test("protocol: a stale bundle at the installed root is installed_manifest_mismatch, never PASS", () => {
  const world = protocolWorld();
  const root = tmpDir("g7-06-stale-");
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify(
      {
        module: "docs",
        version: "0.0.1-old",
        gitSha: "0".repeat(7),
        entry: "index.html",
        dirty: false,
        files: [{ path: "index.html", bytes: 1, sha256: "2".repeat(64) }],
        protocolSha256: world.fork.digests,
      },
      null,
      2,
    ),
  );
  const { check } = protocolRun({ ...world, installedRoot: root, name: "protocol-stale" });
  assert.equal(check.status, "FAIL");
  assert.ok(check.reasons.includes("installed_manifest_mismatch:version"), JSON.stringify(check.reasons));
  assert.ok(check.reasons.includes("installed_manifest_mismatch:gitSha"));
});

test("protocol: a pin mismatch is a FAIL even without an installed bundle", () => {
  const world = protocolWorld();
  const pinDir = fx.writePins(tmpDir("g7-06-pins-"), { gitSha: world.fork.sha, protocolSha256: { ...world.fork.digests, host: "0".repeat(64) } });
  const { check } = protocolRun({ ...world, pinDir, installedRoot: null, name: "protocol-blocked-fail" });
  assert.equal(check.status, "FAIL");
  assert.ok(check.reasons.includes("pin_mismatch:docs:host"));
});

test("protocol: pins that disagree on gitSha fail the default fork sha", () => {
  const world = protocolWorld();
  const sheets = readJson(join(world.pinDir, "sheets.pin.json"));
  sheets.gitSha = "0".repeat(7);
  writeFileSync(join(world.pinDir, "sheets.pin.json"), `${JSON.stringify(sheets, null, 2)}\n`);
  const derived = protocolRun({ ...world, forkSha: null, name: "protocol-gitsha" });
  assert.equal(derived.check.status, "FAIL");
  assert.ok(derived.check.reasons.includes("pins_disagree"));
  // an explicit --fork-sha is the caller's override: the gitSha rule does not apply
  const explicit = protocolRun({ ...world, forkSha: world.fork.sha, name: "protocol-gitsha-explicit" });
  assert.equal(explicit.check.status, "PASS", JSON.stringify(explicit.check.reasons));
});

// ---- the real checkout's pins (contract 4, Amendment 1) ----------------------

test("live pin: real repo protocol PASSes at the current pin and FAILs on a planted pin edit", (t) => {
  const pins = readPins(DEFAULT_PIN_DIR);
  const docs = pins.find((pin) => pin.module === "docs");
  assert.ok(docs?.gitSha, "docs.pin.json carries no gitSha");
  const forkDir = fx.findRealFork(docs.gitSha);
  if (!forkDir) {
    console.log(`real-repo protocol test skipped: no fork checkout holds ${docs.gitSha} (pass G706_FORK_DIR)`);
    return t.skip(`no fork checkout holds ${docs.gitSha}`);
  }
  const installed = fx.writeInstalled(tmpDir("g7-06-installed-"), { version: docs.version, gitSha: docs.gitSha, protocolSha256: docs.recorded });
  const green = protocolRun({ fork: { dir: forkDir }, pinDir: DEFAULT_PIN_DIR, installedRoot: installed, forkSha: docs.gitSha, name: "real-green" });
  assert.equal(green.check.status, "PASS", `pins vs fork at ${docs.gitSha}: ${JSON.stringify(green.check.reasons)}`);
  // a planted edit in one pin is a FAIL, not a PASS
  const editedPins = fx.copyPins(tmpDir("g7-06-pins-"));
  const edited = readJson(join(editedPins, "docs.pin.json"));
  edited.protocolSha256.host = "0".repeat(64);
  writeFileSync(join(editedPins, "docs.pin.json"), `${JSON.stringify(edited, null, 2)}\n`);
  const red = protocolRun({ fork: { dir: forkDir }, pinDir: editedPins, installedRoot: installed, forkSha: docs.gitSha, name: "real-red" });
  assert.equal(red.check.status, "FAIL");
  assert.ok(red.check.reasons.includes("pin_mismatch:docs:host"), JSON.stringify(red.check.reasons));
});
