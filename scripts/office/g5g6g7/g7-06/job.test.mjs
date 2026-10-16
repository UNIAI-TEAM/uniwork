// AC-1 tests for the G7-06 job (UNI-1378, contract section 4). Every rule is
// green on the unmutated input and red on a planted mutation with the reason
// the contract names. The four checks run as modules against fake dirs — a
// git-init'd fake fork, the checked-in fake captures, a temp goldens dir — so
// nothing here touches the checkout or needs a cloud VM.
//
// This file is the one entry the node --test lists of scripts/check.sh and
// ci.yml name; each check's cases live in test-cases/<check>.cases.mjs and
// register their tests on this file when imported.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { SKIP_EXIT_CODE, runEvidence } from "../evidence.mjs";
import { optionsFromEnv, parseArgs, runJob } from "./job.mjs";
import { DEFAULT_PIN_DIR, exitCodeFor } from "./job-lib.mjs";
import * as cx from "./test-fixtures/capture-fixtures.mjs";
import * as fx from "./test-fixtures/fork-fixtures.mjs";
import { CAPTURES, JOB, JOB_DIR, ONE, cli, outDir, readJson, tmpDir } from "./test-fixtures/test-env.mjs";
import "./test-cases/protocol.cases.mjs";
import "./test-cases/extractor.cases.mjs";
import "./test-cases/golden.cases.mjs";
import "./test-cases/brand.cases.mjs";

// ---- the CLI: flags, env forms, exit codes and result.json ------------------

/**
 * The pin of the checked-in fake captures, read from the fixture itself: the
 * CLI tests run against a fake pin dir that names this build, never against
 * apps/web's live pin, so a re-pin cannot turn them red. Only the tests marked
 * "live" below read the real pin.
 */
const FIXTURE_PIN = readJson(join(CAPTURES, "desktop", "meta.json"));

/** A six-pin dir at the fixture's pin; `overrides` reaches fx.writePins (gitSha, protocolSha256, ...). */
function fixturePinDir(overrides = {}) {
  return fx.writePins(tmpDir("g7-06-pins-"), { gitSha: FIXTURE_PIN.forkSha, version: FIXTURE_PIN.pinVersion, ...overrides });
}


test("job-lib carries no dead exports: mergeStatus/STATUSES/STATUS_RANK are gone", async () => {
  const lib = await import("./job-lib.mjs");
  for (const name of ["mergeStatus", "STATUSES", "STATUS_RANK"]) {
    assert.equal(name in lib, false, `${name} is dead code (F-09)`);
  }
});


test("the CLI runs the checked-in fake captures green through --checks brand", () => {
  const dir = outDir("cli-brand-ok");
  const run = cli(["--checks", "brand", "--captures", CAPTURES, "--pin-dir", fixturePinDir(), "--out", dir]);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /brand {2,}PASS/);
  const result = readJson(join(dir, "result.json"));
  assert.deepEqual(Object.keys(result.checks), ["brand"]);
  assert.equal(result.checks.brand.status, "PASS");
  assert.equal(result.pinVersion, FIXTURE_PIN.pinVersion);
  assert.equal(result.forkSha, FIXTURE_PIN.forkSha);
});

test("the CLI exits 1 on a brand hit and writes it into result.json", () => {
  const captures = cx.mkCaptures(tmpDir("g7-06-captures-"));
  writeFileSync(join(captures, "desktop", `${ONE}.txt`), "GenOffice — báo cáo doanh thu quý một của khu vực.\n");
  const dir = outDir("cli-brand-red");
  const run = cli(["--checks", "brand", "--captures", captures, "--pin-dir", fixturePinDir(), "--out", dir]);
  assert.equal(run.status, 1);
  assert.deepEqual(readJson(join(dir, "result.json")).checks.brand.reasons, [`brand_text:desktop/${ONE}/${ONE}.txt`]);
  assert.ok(run.stdout.includes(`brand_text:desktop/${ONE}/${ONE}.txt`), run.stdout);
});

test("a corrupt capture meta blocks the pairs and still writes result.json", () => {
  const captures = cx.mkCaptures(tmpDir("g7-06-captures-"));
  writeFileSync(join(captures, "desktop", "meta.json"), "{ not json");
  const dir = outDir("cli-corrupt-meta");
  const run = cli(["--checks", "brand", "--captures", captures, "--pin-dir", fixturePinDir(), "--out", dir]);
  assert.equal(run.status, 77, `${run.stdout}\n${run.stderr}`);
  const result = readJson(join(dir, "result.json"));
  assert.equal(result.checks.brand.status, "BLOCKED");
  assert.deepEqual(result.checks.brand.reasons, ["capture_meta_unreadable"]);
});

test("a check that throws is BLOCKED with its reason and result.json still exists", () => {
  const captures = cx.mkCaptures(tmpDir("g7-06-captures-"));
  rmSync(join(captures, "desktop", `${ONE}.txt`), { force: true });
  mkdirSync(join(captures, "desktop", `${ONE}.txt`));
  const dir = outDir("cli-check-crash");
  const run = cli(["--checks", "brand", "--captures", captures, "--pin-dir", fixturePinDir(), "--out", dir]);
  assert.equal(run.status, 77, `${run.stdout}\n${run.stderr}`);
  const result = readJson(join(dir, "result.json"));
  assert.equal(result.checks.brand.status, "BLOCKED");
  assert.match(result.checks.brand.reasons[0], /^check_crashed \(/);
});

test("the CLI exits 77 when protocol has no installed bundle", () => {
  const dir = outDir("cli-protocol-blocked");
  const run = cli(["--checks", "protocol", "--pin-dir", fixturePinDir(), "--out", dir]);
  assert.equal(run.status, 77);
  const result = readJson(join(dir, "result.json"));
  assert.equal(result.checks.protocol.status, "BLOCKED");
  assert.equal(result.forkSha, FIXTURE_PIN.forkSha);
  assert.equal(result.pinVersion, FIXTURE_PIN.pinVersion);
});

test("the CLI exits 1 for a fork that is not the pinned one", () => {
  const fork = fx.mkFakeFork(tmpDir("g7-06-fork-"));
  // The pin records digests that are not this fork's: the fork is another build.
  const otherBuild = Object.fromEntries(Object.keys(fork.digests).map((key) => [key, "0".repeat(64)]));
  const pinDir = fixturePinDir({ protocolSha256: otherBuild });
  const installed = fx.writeInstalled(tmpDir("g7-06-installed-"), { version: FIXTURE_PIN.pinVersion, gitSha: fork.sha, protocolSha256: fork.digests });
  const dir = outDir("cli-protocol-fail");
  const run = cli(["--checks", "protocol", "--fork-dir", fork.dir, "--fork-sha", fork.sha, "--installed", installed, "--pin-dir", pinDir, "--out", dir]);
  assert.equal(run.status, 1);
  const reasons = readJson(join(dir, "result.json")).checks.protocol.reasons;
  assert.ok(reasons.includes("pin_mismatch:docs:protocol"), JSON.stringify(reasons));
});

test("the CLI reads the pin from --pin-dir / G706_PIN_DIR, and the live pin only without them", () => {
  const dir = outDir("cli-pin-dir");
  const other = fixturePinDir({ gitSha: "feedfac", version: "0.1.0-feedfac" });
  const viaFlag = cli(["--checks", "protocol", "--pin-dir", other, "--out", dir]);
  assert.equal(readJson(join(dir, "result.json")).pinVersion, "0.1.0-feedfac", viaFlag.stderr);
  const viaEnv = cli(["--checks", "protocol", "--out", dir], { G706_PIN_DIR: other });
  assert.equal(readJson(join(dir, "result.json")).forkSha, "feedfac", viaEnv.stderr);
  assert.equal(optionsFromEnv({}, {}).pinDir, DEFAULT_PIN_DIR);
  assert.equal(optionsFromEnv({ pinDir: "/a" }, { G706_PIN_DIR: "/b" }).pinDir, "/a");
});

test("live pin: the CLI without --pin-dir reports the pin apps/web ships", () => {
  const dir = outDir("cli-live-pin");
  cli(["--checks", "protocol", "--out", dir]);
  const live = readJson(join(DEFAULT_PIN_DIR, "docs.pin.json"));
  const result = readJson(join(dir, "result.json"));
  assert.equal(result.pinVersion, live.version);
  assert.equal(result.forkSha, live.gitSha);
});

test("the CLI refuses an unknown check name with the usage line", () => {
  const run = cli(["--checks", "golden,bogus"]);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--checks takes/);
  assert.match(run.stderr, /usage: node scripts\/office\/g5g6g7\/g7-06\/job\.mjs/);
});

test("--update-goldens refuses --checks: it is an explicit bootstrap step that runs alone", () => {
  assert.throws(() => parseArgs(["--update-goldens", "--checks", "protocol"]), /--update-goldens/);
  assert.throws(() => parseArgs(["--checks", "golden", "--update-goldens"]), /--update-goldens/);
  const goldens = tmpDir("g7-06-goldens-");
  assert.throws(
    () => runJob({ updateGoldens: true, checks: ["protocol"], capturesDir: CAPTURES, goldensDir: goldens, outDir: outDir("update-guard") }),
    /--update-goldens/,
  );
  assert.equal(existsSync(join(goldens, "manifest.json")), false, "the refused call wrote nothing");
  // Through the CLI the refusal is a usage error, and it never runs the update.
  const dir = outDir("cli-update-guard");
  const run = cli(["--update-goldens", "--checks", "protocol", "--out", dir]);
  assert.equal(run.status, 2, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stderr, /--update-goldens/);
  assert.ok(!/golden\s+PASS/.test(run.stdout));
});

test("--extractor points the check at another script and records its blob sha", () => {
  const stub = join(tmpDir("g7-06-extractor-"), "fixed-extractor.mjs");
  writeFileSync(stub, fx.stubExtractor(fx.committedExtractBlock()));
  const fork = fx.mkFakeFork(tmpDir("g7-06-fork-")); // the fork checkout has no extractor
  const dir = outDir("extractor-file");
  const run = cli(["--extractor", stub, "--checks", "extractor", "--fork-dir", fork.dir, "--fork-sha", fork.sha, "--out", dir]);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const artifact = readJson(join(dir, "extractor.json"));
  assert.equal(artifact.extractor.path, stub);
  assert.equal(artifact.extractor.blobSha, spawnSync("git", ["-C", fork.dir, "hash-object", stub], { encoding: "utf8" }).stdout.trim());
  assert.equal(optionsFromEnv({}, { G706_EXTRACTOR: stub }).extractor, stub);
});

test("every flag has its env form, and a flag wins over its env", () => {
  const env = { G706_FORK_DIR: "/f", G706_FORK_SHA: "abc1234", G706_INSTALLED: "/i", G706_CAPTURES: "/c", G706_EXTRACTOR: "/e.mjs", G706_OUT: "/o" };
  const fromEnv = optionsFromEnv({}, env);
  assert.deepEqual(
    { forkDir: fromEnv.forkDir, forkSha: fromEnv.forkSha, installedRoot: fromEnv.installedRoot, capturesDir: fromEnv.capturesDir, extractor: fromEnv.extractor, outDir: fromEnv.outDir },
    { forkDir: "/f", forkSha: "abc1234", installedRoot: "/i", capturesDir: "/c", extractor: "/e.mjs", outDir: "/o" },
  );
  assert.equal(optionsFromEnv({ forkSha: "def5678" }, env).forkSha, "def5678");
});

// ---- Amendment 3: a NOTE is 77, and the ledger never reads it as a PASS ------

/** The world where the `protocol` check has nothing to compare: nobody records. */
function noteWorld() {
  const fork = fx.mkFakeFork(tmpDir("g7-06-fork-"));
  const pinDir = fx.writePins(tmpDir("g7-06-pins-"), { gitSha: fork.sha });
  const installedRoot = fx.writeInstalled(tmpDir("g7-06-installed-"), { version: "0.1.0-fake", gitSha: fork.sha });
  return { fork, pinDir, installedRoot };
}

test("a NOTE verdict is exit 77, never 0 (contract Amendment 3)", () => {
  const { fork, pinDir, installedRoot } = noteWorld();
  const result = runJob({ checks: ["protocol"], forkDir: fork.dir, forkSha: fork.sha, installedRoot, pinDir, outDir: outDir("note-exit") });
  assert.equal(result.checks.protocol.status, "NOTE");
  assert.deepEqual(result.checks.protocol.reasons, ["protocol_sha256_not_recorded"]);
  assert.equal(exitCodeFor(result.checks), 77);
});

test("a NOTE run through the evidence runner can never log a PASS", () => {
  const { fork, pinDir, installedRoot } = noteWorld();
  const runDir = outDir("note-run");
  const evidenceDir = outDir("note-evidence");
  // The job CLI reads the checkout's own pins, which all record protocolSha256,
  // so a NOTE world is driven through runJob + exitCodeFor — the same pair
  // main() uses — by a tiny wrapper command.
  const wrapper = join(tmpDir("g7-06-note-"), "note-run.mjs");
  writeFileSync(
    wrapper,
    [
      `import { runJob } from ${JSON.stringify(pathToFileURL(JOB).href)};`,
      `import { exitCodeFor } from ${JSON.stringify(pathToFileURL(join(JOB_DIR, "job-lib.mjs")).href)};`,
      `const result = runJob({ checks: ["protocol"], forkDir: ${JSON.stringify(fork.dir)}, forkSha: ${JSON.stringify(fork.sha)}, installedRoot: ${JSON.stringify(installedRoot)}, pinDir: ${JSON.stringify(pinDir)}, outDir: ${JSON.stringify(runDir)} });`,
      `process.stdout.write(JSON.stringify(result.checks.protocol));`,
      `process.exitCode = exitCodeFor(result.checks);`,
    ].join("\n"),
  );
  const record = runEvidence({
    requirementId: "G7-A04",
    fixtureId: "fx-xlsx-revenue-xyz",
    checker: "tester-cloud",
    outDir: evidenceDir,
    command: [process.execPath, wrapper],
  });
  assert.equal(record.result, "BLOCKED", record.blocker ?? "");
  assert.match(record.blocker, new RegExp(`exit ${SKIP_EXIT_CODE}`));
  const ledger = readFileSync(join(evidenceDir, "evidence.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(ledger[0].result, "BLOCKED", "the ledger line a NOTE run writes is not a PASS");
  assert.equal(ledger[0].exitCode, SKIP_EXIT_CODE);
});

test("runJob FAILS (exit 1, never a bless) a web capture whose frame token granted no AI (RFE5-202)", () => {
  const captures = cx.mkCaptures(tmpDir("g7-06-captures-"));
  const goldens = cx.writeGoldens(tmpDir("g7-06-goldens-"), { capturesDir: captures, fixtures: [ONE], hosts: ["desktop", "web"] });
  const metaFile = join(captures, "web", "meta.json");
  const meta = readJson(metaFile);
  meta.fixtures[ONE].ai = false;
  meta.fixtures[ONE].uniworkAi = false;
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  const pinDir = fixturePinDir();
  const compare = runJob({ capturesDir: captures, goldensDir: goldens, pinDir, fixtures: [ONE], checks: ["golden"], outDir: outDir("job-ai-off-compare") });
  assert.equal(compare.checks.golden.status, "FAIL");
  assert.deepEqual(compare.checks.golden.reasons, ["capture_ai_off"]);
  assert.equal(exitCodeFor(compare.checks), 1);
  const update = runJob({ capturesDir: captures, goldensDir: tmpDir("g7-06-goldens-"), pinDir, fixtures: [ONE], updateGoldens: true, outDir: outDir("job-ai-off-update") });
  assert.equal(update.checks.golden.status, "FAIL");
  assert.deepEqual(update.checks.golden.reasons, [`capture_ai_off:web/${ONE}`]);
  assert.equal(exitCodeFor(update.checks), 1);
});
