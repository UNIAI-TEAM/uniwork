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
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { optionsFromEnv } from "./job.mjs";
import { DEFAULT_PIN_DIR } from "./job-lib.mjs";
import * as cx from "./test-fixtures/capture-fixtures.mjs";
import * as fx from "./test-fixtures/fork-fixtures.mjs";
import { CAPTURES, ONE, cli, outDir, readJson, tmpDir } from "./test-fixtures/test-env.mjs";
import "./test-cases/protocol.cases.mjs";
import "./test-cases/extractor.cases.mjs";
import "./test-cases/golden.cases.mjs";
import "./test-cases/brand.cases.mjs";

// ---- the CLI: flags, env forms, exit codes and result.json ------------------


test("the CLI runs the checked-in fake captures green through --checks brand", () => {
  const dir = outDir("cli-brand-ok");
  const run = cli(["--checks", "brand", "--captures", CAPTURES, "--out", dir]);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /brand {2,}PASS/);
  const result = readJson(join(dir, "result.json"));
  assert.deepEqual(Object.keys(result.checks), ["brand"]);
  assert.equal(result.checks.brand.status, "PASS");
  assert.equal(result.pinVersion, readJson(join(DEFAULT_PIN_DIR, "docs.pin.json")).version);
});

test("the CLI exits 1 on a brand hit and writes it into result.json", () => {
  const captures = cx.mkCaptures(tmpDir("g7-06-captures-"));
  writeFileSync(join(captures, "desktop", `${ONE}.txt`), "GenOffice — báo cáo doanh thu quý một của khu vực.\n");
  const dir = outDir("cli-brand-red");
  const run = cli(["--checks", "brand", "--captures", captures, "--out", dir]);
  assert.equal(run.status, 1);
  assert.deepEqual(readJson(join(dir, "result.json")).checks.brand.reasons, ["brand_text"]);
});

test("the CLI exits 77 when protocol has no installed bundle", () => {
  const dir = outDir("cli-protocol-blocked");
  const run = cli(["--checks", "protocol", "--out", dir]);
  assert.equal(run.status, 77);
  const result = readJson(join(dir, "result.json"));
  assert.equal(result.checks.protocol.status, "BLOCKED");
  assert.match(result.forkSha, /^[0-9a-f]{7,}$/);
  assert.ok(result.pinVersion);
});

test("the CLI exits 1 for a fork that is not the pinned one", () => {
  const docs = readJson(join(DEFAULT_PIN_DIR, "docs.pin.json"));
  const fork = fx.mkFakeFork(tmpDir("g7-06-fork-"));
  const installed = fx.writeInstalled(tmpDir("g7-06-installed-"), { version: docs.version, gitSha: fork.sha, protocolSha256: fork.digests });
  const dir = outDir("cli-protocol-fail");
  const run = cli(["--checks", "protocol", "--fork-dir", fork.dir, "--fork-sha", fork.sha, "--installed", installed, "--out", dir]);
  assert.equal(run.status, 1);
  const reasons = readJson(join(dir, "result.json")).checks.protocol.reasons;
  assert.ok(reasons.includes("pin_mismatch:docs:protocol"), JSON.stringify(reasons));
});

test("the CLI refuses an unknown check name with the usage line", () => {
  const run = cli(["--checks", "golden,bogus"]);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--checks takes/);
  assert.match(run.stderr, /usage: node scripts\/office\/g5g6g7\/g7-06\/job\.mjs/);
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
