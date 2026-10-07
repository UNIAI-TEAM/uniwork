#!/usr/bin/env node
// O03 (UNI-944) - CI gate for the xlsx engine assets inside a desktop build.
//
//   node apps/office-desktop/scripts/check-xlsx-assets.mjs [--require-sidecar true|false] <xlsx-assets directory>...
//
// Reads each directory's staged-assets.json (written by xlsx-assets.mjs) and
// fails when the gateway - or, with --require-sidecar true, the recalculation
// sidecar - is missing, absent from disk, or does not hash to the manifest.
// CI points it at dist/xlsx-assets and at the packaged resources/xlsx-assets,
// so the installer itself is checked, not only the staging step.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { XLSX_GATEWAY_FILE, xlsxSidecarFile } from "./xlsx-assets.mjs";

const MANIFEST_FILE = "staged-assets.json";

function problemsForEntry(directory, entry, name, label) {
  if (!entry) return [`${label} is not recorded in ${MANIFEST_FILE}`];
  const file = join(directory, name);
  if (!existsSync(file)) return [`${label} ${name} is missing from ${directory}`];
  // Fail closed: an entry without a sha256 cannot attest the file on disk.
  const recorded = typeof entry.sha256 === "string" ? entry.sha256.trim().toLowerCase() : "";
  if (!recorded) return [`${label} ${name} has no sha256 in ${MANIFEST_FILE}`];
  if (createHash("sha256").update(readFileSync(file)).digest("hex") !== recorded) return [`${label} ${name} does not match the sha256 in ${MANIFEST_FILE}`];
  return [];
}

/** `{ ok, problems }` for one xlsx-assets directory. */
export function checkStagedXlsxAssets({ directory, requireSidecar = true }) {
  const manifestPath = join(directory, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return { ok: false, problems: [`${MANIFEST_FILE} is missing from ${directory}`] };
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch (error) { return { ok: false, problems: [`${manifestPath} is not valid JSON: ${error.message}`] }; }
  const sidecarName = xlsxSidecarFile(manifest?.platform ?? process.platform);
  const problems = [
    ...problemsForEntry(directory, manifest?.gateway, XLSX_GATEWAY_FILE, "gateway"),
    ...(requireSidecar ? problemsForEntry(directory, manifest?.sidecar, sidecarName, "sidecar") : []),
  ];
  return { ok: problems.length === 0, problems };
}

export function parseCheckArguments(argv) {
  const options = { requireSidecar: true, directories: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--require-sidecar") {
      const value = argv[index + 1];
      if (value !== "true" && value !== "false") throw new Error("--require-sidecar needs true or false");
      options.requireSidecar = value === "true";
      index += 1;
    } else if (argv[index].startsWith("--")) {
      throw new Error(`unknown argument: ${argv[index]}`);
    } else {
      options.directories.push(resolve(argv[index]));
    }
  }
  if (options.directories.length === 0) throw new Error("usage: check-xlsx-assets.mjs [--require-sidecar true|false] <xlsx-assets directory>...");
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { requireSidecar, directories } = parseCheckArguments(process.argv.slice(2));
    let failed = false;
    for (const directory of directories) {
      const result = checkStagedXlsxAssets({ directory, requireSidecar });
      process.stdout.write(`${result.ok ? "ok  " : "FAIL"} ${directory} (sidecar ${requireSidecar ? "required" : "optional"})\n`);
      for (const problem of result.problems) process.stderr.write(`  - ${problem}\n`);
      failed ||= !result.ok;
    }
    if (failed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`check-xlsx-assets: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
