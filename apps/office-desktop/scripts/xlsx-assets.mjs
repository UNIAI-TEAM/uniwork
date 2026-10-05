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
 */
export function resolveXlsxAssetSources({ repositoryRoot, platform = process.platform, environment = process.env } = {}) {
  const explicit = environment.OFFICE_DESKTOP_XLSX_ASSETS?.trim();
  const buildDirectory = explicit ? resolve(explicit) : join(repositoryRoot, DEFAULT_XLSX_BUILD_DIRECTORY);
  const gateway = firstExisting(explicit
    ? [join(buildDirectory, XLSX_GATEWAY_FILE)]
    : [join(buildDirectory, "dist", XLSX_GATEWAY_FILE), join(repositoryRoot, "packages", "office-upstream", "dist", XLSX_GATEWAY_FILE)]);
  const sidecar = firstExisting(explicit
    ? [join(buildDirectory, xlsxSidecarFile(platform))]
    : [join(buildDirectory, "upstream", "apps", "sheets", "native", "xlsx-engine", "target", "release", xlsxSidecarFile(platform))]);
  const buildRecord = firstExisting(explicit
    ? [join(buildDirectory, XLSX_BUILD_RECORD_FILE)]
    : [join(buildDirectory, XLSX_BUILD_RECORD_FILE)]);
  return { explicit: Boolean(explicit), buildDirectory, gateway, sidecar, buildRecord };
}

async function describe(file) {
  const bytes = await readFile(file);
  return { file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** The actionable failure for a missing gateway: name the artifact, the dir
 *  searched and the exact command that produces it. */
export function missingGatewayError({ buildDirectory }) {
  return new Error(
    `xlsx gateway artifact is not staged: expected ${XLSX_GATEWAY_FILE} under ${join(buildDirectory, "dist")}. ` +
      "Build it first with: node scripts/office/build-upstream.mjs --with-native --out " +
      DEFAULT_XLSX_BUILD_DIRECTORY.split("\\").join("/") +
      " (or point OFFICE_DESKTOP_XLSX_ASSETS at a directory that already holds it).",
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
 */
export async function stageXlsxAssets({ repositoryRoot, distDirectory, platform = process.platform, environment = process.env } = {}) {
  const sources = resolveXlsxAssetSources({ repositoryRoot, platform, environment });
  if (!sources.gateway) throw missingGatewayError(sources);
  const directory = join(distDirectory, XLSX_ASSETS_DIRECTORY);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await cp(sources.gateway, join(directory, XLSX_GATEWAY_FILE));
  if (sources.sidecar) await cp(sources.sidecar, join(directory, xlsxSidecarFile(platform)));
  if (sources.buildRecord) await cp(sources.buildRecord, join(directory, XLSX_BUILD_RECORD_FILE));
  const manifest = {
    schemaVersion: 1,
    platform,
    gateway: await describe(join(directory, XLSX_GATEWAY_FILE)),
    sidecar: sources.sidecar ? await describe(join(directory, xlsxSidecarFile(platform))) : null,
    buildRecord: sources.buildRecord ? await describe(join(directory, XLSX_BUILD_RECORD_FILE)) : null,
  };
  await writeFile(join(directory, "staged-assets.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { directory, ...manifest };
}
