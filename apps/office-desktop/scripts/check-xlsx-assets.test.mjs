import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkStagedXlsxAssets, parseCheckArguments } from "./check-xlsx-assets.mjs";
import { XLSX_GATEWAY_FILE, xlsxSidecarFile } from "./xlsx-assets.mjs";

const platform = process.platform;
const sha = (text) => createHash("sha256").update(text).digest("hex");

function stage({ gateway = true, sidecar = true, manifestSidecar = sidecar, gatewayText = "gateway" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "xlsx-assets-check-"));
  if (gateway) writeFileSync(join(directory, XLSX_GATEWAY_FILE), "gateway");
  if (sidecar) writeFileSync(join(directory, xlsxSidecarFile(platform)), "sidecar");
  const manifest = {
    schemaVersion: 1,
    platform,
    gateway: gateway ? { bytes: 7, sha256: sha(gatewayText) } : null,
    sidecar: manifestSidecar ? { bytes: 7, sha256: sha("sidecar") } : null,
  };
  writeFileSync(join(directory, "staged-assets.json"), JSON.stringify(manifest));
  return directory;
}

test("passes when gateway and sidecar are staged", () => {
  const directory = stage();
  assert.deepEqual(checkStagedXlsxAssets({ directory }), { ok: true, problems: [] });
  rmSync(directory, { recursive: true });
});

test("fails when the sidecar is missing and required, passes when optional", () => {
  const directory = stage({ sidecar: false });
  const required = checkStagedXlsxAssets({ directory, requireSidecar: true });
  assert.equal(required.ok, false);
  assert.match(required.problems[0], /sidecar is not recorded/);
  assert.equal(checkStagedXlsxAssets({ directory, requireSidecar: false }).ok, true);
  rmSync(directory, { recursive: true });
});

test("fails when the gateway is missing even if the sidecar is optional", () => {
  const directory = stage({ gateway: false });
  const result = checkStagedXlsxAssets({ directory, requireSidecar: false });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /gateway is not recorded/);
  rmSync(directory, { recursive: true });
});

test("fails when a recorded file is gone from disk or altered", () => {
  const gone = stage({ sidecar: false, manifestSidecar: true });
  assert.match(checkStagedXlsxAssets({ directory: gone }).problems[0], /sidecar .* is missing/);
  const altered = stage({ gatewayText: "something else" });
  assert.match(checkStagedXlsxAssets({ directory: altered }).problems[0], /gateway .* does not match the sha256/);
  rmSync(gone, { recursive: true });
  rmSync(altered, { recursive: true });
});

test("fails without a manifest or with a broken one", () => {
  const empty = mkdtempSync(join(tmpdir(), "xlsx-assets-check-"));
  assert.match(checkStagedXlsxAssets({ directory: empty }).problems[0], /staged-assets.json is missing/);
  writeFileSync(join(empty, "staged-assets.json"), "{");
  assert.match(checkStagedXlsxAssets({ directory: empty }).problems[0], /not valid JSON/);
  rmSync(empty, { recursive: true });
});

test("argument parsing", () => {
  assert.equal(parseCheckArguments(["a"]).requireSidecar, true);
  assert.equal(parseCheckArguments(["--require-sidecar", "false", "a", "b"]).requireSidecar, false);
  assert.equal(parseCheckArguments(["--require-sidecar", "false", "a", "b"]).directories.length, 2);
  assert.throws(() => parseCheckArguments([]), /usage/);
  assert.throws(() => parseCheckArguments(["--require-sidecar", "maybe", "a"]), /true or false/);
  assert.throws(() => parseCheckArguments(["--nope", "a"]), /unknown argument/);
});
