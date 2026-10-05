// UNI-926 R3-2 (DESKTOP-XLSX) - stage the bundled xlsx gateway (and the
// platform sidecar, when it has been built) into the desktop payload.
//
// The packaged win-unpacked build shipped no xlsx assets at all, so
// apps/office-desktop/main/xlsx-engine.ts resolved no gateway and every local
// .xlsx open failed with EngineBoundaryError: engine_incompatible. The
// artifacts staged here are the SAME ones the engine image ships - the patched
// gateway bundle and the Rust recalculation sidecar produced by
// scripts/office/build-upstream.mjs. Nothing is fabricated: a build that
// cannot find the gateway fails loudly with the exact command to produce it,
// and a missing sidecar is recorded rather than faked (the engine already
// fails closed on formula-bearing saves without it).
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

/** The staged directory name; matches the main-process resolution and the
 *  electron-builder extraResources entry (resources/<name>). */
export const XLSX_ASSETS_DIRECTORY = "xlsx-assets";
/** The gateway bundle filename the engine's xlsx-assets.ts looks for. */
export const XLSX_GATEWAY_FILE = "xlsx-gateway.mjs";
/** The default scratch dir scripts/office/build-upstream.mjs writes to. */
export const DEFAULT_XLSX_BUILD_DIRECTORY = join(".go-tmp", "office-upstream-build");
/** The build record the engine image ships beside the artifacts. */
export const XLSX_BUILD_RECORD_FILE = "build-record.json";

/** The sidecar binary name for a platform (the engine resolves the same name). */
export function xlsxSidecarFile(platform = process.platform) {
  return platform === "win32" ? "xlsx-sidecar.exe" : "xlsx-sidecar";
}

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

/**
 * Where the staging step reads from, and what it found.
 *
 * An explicit OFFICE_DESKTOP_XLSX_ASSETS directory wins (CI or a pre-staged
 * release dir); otherwise the standard build-upstream scratch tree is used.
 * `gateway` is the artifact every local open needs; `sidecar` is the optional
 * native recalculation binary; `buildRecord` carries the shipped checksums.
 * `gatewayCandidates` is the exact ordered list of paths probed, so the
 * missing-gateway error names what was actually searched.
 */
export function resolveXlsxAssetSources({ repositoryRoot, platform = process.platform, environment = process.env } = {}) {
  const explicit = environment.OFFICE_DESKTOP_XLSX_ASSETS?.trim();
  const buildDirectory = explicit ? resolve(explicit) : join(repositoryRoot, DEFAULT_XLSX_BUILD_DIRECTORY);
  // The scratch path can exceed the Windows MAX_PATH limit MSVC's link.exe
  // enforces (the worktree prefix plus the crate's deep target path is >260
  // chars), so a Windows build is normally run with CARGO_TARGET_DIR on a
  // short path. Cargo then writes the binary to <CARGO_TARGET_DIR>/release,
  // not under the scratch tree - look there too so staging needs no extra env.
  const cargoTargetSidecar = environment.CARGO_TARGET_DIR?.trim()
    ? join(resolve(environment.CARGO_TARGET_DIR), "release", xlsxSidecarFile(platform))
    : null;
  const gatewayCandidates = explicit
    ? [join(buildDirectory, XLSX_GATEWAY_FILE)]
    : [join(buildDirectory, "dist", XLSX_GATEWAY_FILE), join(repositoryRoot, "packages", "office-upstream", "dist", XLSX_GATEWAY_FILE)];
  const gateway = firstExisting(gatewayCandidates);
  const sidecar = firstExisting(explicit
    ? [join(buildDirectory, xlsxSidecarFile(platform))]
    : [join(buildDirectory, "upstream", "apps", "sheets", "native", "xlsx-engine", "target", "release", xlsxSidecarFile(platform)), cargoTargetSidecar]);
  const buildRecord = firstExisting([join(buildDirectory, XLSX_BUILD_RECORD_FILE)]);
  return { explicit: Boolean(explicit), buildDirectory, gatewayCandidates, gateway, sidecar, buildRecord };
}

async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function describe(file) {
  const bytes = await readFile(file);
  return { file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** The actionable failure for a missing gateway: name the artifact, the exact
 *  paths searched and the command that produces it. */
export function missingGatewayError({ buildDirectory, gatewayCandidates }) {
  const searched = (gatewayCandidates ?? [join(buildDirectory, "dist", XLSX_GATEWAY_FILE)])
    .map((candidate) => candidate.split("\\").join("/"))
    .join(", ");
  return new Error(
    `xlsx gateway artifact is not staged: expected ${XLSX_GATEWAY_FILE} at ${searched}. ` +
      "Build it first with: node scripts/office/build-upstream.mjs --with-native --out " +
      DEFAULT_XLSX_BUILD_DIRECTORY.split("\\").join("/") +
      " (or point OFFICE_DESKTOP_XLSX_ASSETS at a directory that already holds it).",
  );
}

/**
 * The sidecar sha256 a build record attests (its `native.binary.sha256`), or
 * null when the record was produced without --with-native - no native build
 * was attempted, so there is nothing to verify a staged binary against. A
 * record that cannot be read at all fails loudly: staging it as shipped
 * evidence while silently skipping the comparison is the drift this check
 * exists to stop.
 */
async function recordedSidecarSha256(buildRecord) {
  let record;
  try {
    record = JSON.parse(await readFile(buildRecord, "utf8"));
  } catch (error) {
    throw new Error(`xlsx build record ${buildRecord} could not be read: ${error.message}`);
  }
  const recorded = record?.native?.binary?.sha256;
  return typeof recorded === "string" && recorded.trim() ? recorded.trim().toLowerCase() : null;
}

/** The loud failure for a sidecar whose bytes contradict its build record. */
function sidecarProvenanceError({ buildRecord, sidecar, recorded, actual }) {
  return new Error(
    `xlsx sidecar sha256 mismatch: ${sidecar} hashes ${actual} but ${buildRecord} records ${recorded}. ` +
      "The candidate is stale - a shared CARGO_TARGET_DIR can hold another build's binary. " +
      "Rebuild with: node scripts/office/build-upstream.mjs --with-native, or point OFFICE_DESKTOP_XLSX_ASSETS at that build output.",
  );
}

/**
 * Copy the resolved artifacts into <distDirectory>/xlsx-assets and write a
 * staged-assets.json manifest (bytes + sha256 for every staged file).
 *
 * The gateway is required - a packaged desktop without it cannot open a local
 * .xlsx, which is the R3-2 defect. The sidecar is optional: without it the
 * engine still opens and edits formula-free workbooks, and a formula-bearing
 * save fails closed. Its absence is recorded in the manifest, never faked.
 * When a build record is staged it is the sidecar's provenance: the recorded
 * binary sha256 must equal the candidate's own hash, so a stale binary left in
 * a shared CARGO_TARGET_DIR cannot stage silently next to a record that
 * describes a different build.
 */
export async function stageXlsxAssets({ repositoryRoot, distDirectory, platform = process.platform, environment = process.env } = {}) {
  const sources = resolveXlsxAssetSources({ repositoryRoot, platform, environment });
  if (!sources.gateway) throw missingGatewayError(sources);
  const sidecarName = xlsxSidecarFile(platform);
  if (sources.sidecar && sources.buildRecord) {
    const recorded = await recordedSidecarSha256(sources.buildRecord);
    const actual = await sha256File(sources.sidecar);
    if (recorded && recorded !== actual) {
      throw sidecarProvenanceError({ buildRecord: sources.buildRecord, sidecar: sources.sidecar, recorded, actual });
    }
  }
  const directory = join(distDirectory, XLSX_ASSETS_DIRECTORY);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await cp(sources.gateway, join(directory, XLSX_GATEWAY_FILE));
  if (sources.sidecar) await cp(sources.sidecar, join(directory, sidecarName));
  if (sources.buildRecord) await cp(sources.buildRecord, join(directory, XLSX_BUILD_RECORD_FILE));
  const manifest = {
    schemaVersion: 1,
    platform,
    gateway: await describe(join(directory, XLSX_GATEWAY_FILE)),
    sidecar: sources.sidecar ? await describe(join(directory, sidecarName)) : null,
    buildRecord: sources.buildRecord ? await describe(join(directory, XLSX_BUILD_RECORD_FILE)) : null,
  };
  await writeFile(join(directory, "staged-assets.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { directory, ...manifest };
}
