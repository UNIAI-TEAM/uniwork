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
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";
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

/** The path flavour of a target platform: a win32 build computed on a POSIX host (or the reverse) splits and joins like the target. */
function pathFor(platform) {
  return platform === "win32" ? win32 : posix;
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
    ? join(resolve(repositoryRoot, environment.CARGO_TARGET_DIR.trim()), "release", xlsxSidecarFile(platform))
    : null;
  const gatewayCandidates = explicit
    ? [join(buildDirectory, XLSX_GATEWAY_FILE)]
    : [join(buildDirectory, "dist", XLSX_GATEWAY_FILE), join(repositoryRoot, "packages", "office-upstream", "dist", XLSX_GATEWAY_FILE)];
  const gateway = firstExisting(gatewayCandidates);
  const sidecar = firstExisting(explicit
    ? [join(buildDirectory, xlsxSidecarFile(platform))]
    : [join(buildDirectory, "native", xlsxSidecarFile(platform)), join(buildDirectory, "upstream", "apps", "sheets", "native", "xlsx-engine", "target", "release", xlsxSidecarFile(platform)), cargoTargetSidecar]);
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
async function recordedSidecar(buildRecord) {
  let record;
  try {
    record = JSON.parse(await readFile(buildRecord, "utf8"));
  } catch (error) {
    throw new Error(`xlsx build record ${buildRecord} could not be read: ${error.message}`);
  }
  const recorded = record?.native?.binary?.sha256;
  const arch = record?.native?.arch;
  return {
    sha256: typeof recorded === "string" && recorded.trim() ? recorded.trim().toLowerCase() : null,
    // Absent in records written before the arch was recorded: nothing to compare.
    arch: typeof arch === "string" && arch.trim() ? arch.trim() : null,
  };
}

/** The loud failure for a sidecar built for another CPU architecture than an artifact being packaged. */
function sidecarArchitectureError({ sidecar, recordedArch, targetArches }) {
  return new Error(
    `the xlsx sidecar ${sidecar} was built for ${recordedArch} but the package targets ${targetArches.join(", ")}: a binary of the wrong architecture would ship and every formula save would fail. ` +
      "The native build only produces the architecture of the host that ran it - build on a host of the target architecture (node scripts/office/build-upstream.mjs --with-native) " +
      "and package one architecture at a time (--arch), or point OFFICE_DESKTOP_XLSX_ASSETS at a directory holding that architecture's sidecar.",
  );
}

/** The loud failure for a sidecar no successful native build step of the record attests. */
function sidecarUnattestedError({ buildRecord, sidecar }) {
  return new Error(
    `${REQUIRE_SIDECAR_ENV}=1 but the xlsx sidecar ${sidecar} has no provenance: ${buildRecord ? `${buildRecord} records no successful native build step for it` : "there is no build record"}. ` +
      "A binary left in a shared CARGO_TARGET_DIR by an earlier build (or a failed native build) must not ship. " +
      "Rebuild with: node scripts/office/build-upstream.mjs --with-native, or point OFFICE_DESKTOP_XLSX_ASSETS at that build output.",
  );
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
 * The build record is the sidecar's provenance: the recorded native binary
 * sha256 must equal the candidate's own hash, so a stale binary left in a
 * shared CARGO_TARGET_DIR cannot stage silently next to a record that
 * describes a different build. A candidate the record does not attest at all
 * (no record, or a failed/absent native step) is refused under
 * OFFICE_DESKTOP_REQUIRE_XLSX_SIDECAR=1 and warned about otherwise. The record
 * also names the architecture the native step ran on (`native.arch`); staging
 * for any other `arches` entry gets the same refuse/warn treatment.
 */
export async function stageXlsxAssets({ repositoryRoot, distDirectory, platform = process.platform, arches = [process.arch], environment = process.env, log = (line) => process.stderr.write(`${line}\n`) } = {}) {
  const sources = resolveXlsxAssetSources({ repositoryRoot, platform, environment });
  if (!sources.gateway) throw missingGatewayError(sources);
  const sidecarName = xlsxSidecarFile(platform);
  if (sources.sidecar) {
    const { sha256: recorded, arch: recordedArch } = sources.buildRecord ? await recordedSidecar(sources.buildRecord) : { sha256: null, arch: null };
    // The native step builds for the architecture of the host that ran it; a
    // package for another one would ship a binary its CPU cannot run.
    if (recordedArch && arches.some((arch) => arch !== recordedArch)) {
      const error = sidecarArchitectureError({ sidecar: sources.sidecar, recordedArch, targetArches: arches });
      if (sidecarRequired(environment)) throw error;
      log(`office-desktop: ${error.message}`);
    }
    // The sidecar's provenance is the build record's successful native step.
    // Required: no attestation, no staging. Otherwise staging stays legal
    // (a dev build may use a hand-built binary) but the operator is told.
    if (!recorded) {
      if (sidecarRequired(environment)) throw sidecarUnattestedError({ buildRecord: sources.buildRecord, sidecar: sources.sidecar });
      log(`office-desktop: the staged xlsx sidecar ${sources.sidecar} is not attested - the build record shows no successful native build step for it.`);
    } else {
      const actual = await sha256File(sources.sidecar);
      if (recorded !== actual) {
        throw sidecarProvenanceError({ buildRecord: sources.buildRecord, sidecar: sources.sidecar, recorded, actual });
      }
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

/** Set to 1 (the installer CI job does) to fail a build that would ship no recalc sidecar. */
export const REQUIRE_SIDECAR_ENV = "OFFICE_DESKTOP_REQUIRE_XLSX_SIDECAR";

/** Set to 1 to skip the automatic cargo build (CI that only bundles, a dev who does not want a multi-minute build). */
export const SKIP_NATIVE_BUILD_ENV = "OFFICE_DESKTOP_SKIP_NATIVE_BUILD";

function sidecarRequired(environment) {
  return environment?.[REQUIRE_SIDECAR_ENV]?.trim() === "1";
}

function pathKey(environment) {
  return Object.keys(environment).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
}

/**
 * The cargo executable a build can use: the first one on PATH, else the
 * rustup default home (CARGO_HOME or ~/.cargo)/bin, which a per-user rustup
 * install leaves off PATH (--no-modify-path). Null when there is none.
 */
export function locateCargo({ environment = process.env, platform = process.platform, exists = existsSync } = {}) {
  const flavour = pathFor(platform);
  const executable = platform === "win32" ? "cargo.exe" : "cargo";
  const directories = (environment[pathKey(environment)] ?? "").split(flavour.delimiter).filter(Boolean);
  const home = environment.USERPROFILE || environment.HOME || homedir();
  directories.push(flavour.join(environment.CARGO_HOME?.trim() || flavour.join(home, ".cargo"), "bin"));
  return directories.map((directory) => flavour.join(directory, executable)).find((candidate) => exists(candidate)) ?? null;
}

/** The nearest ancestor directory named .uniwork-dev (the workspace scratch root), or null. */
function uniworkDevRoot(directory, flavour) {
  for (let current = directory; ; current = flavour.dirname(current)) {
    if (flavour.basename(current) === ".uniwork-dev") return current;
    if (flavour.dirname(current) === current) return null;
  }
}

/**
 * CARGO_TARGET_DIR for the native build. An explicit one wins (a relative one
 * resolves against the repo root; build-upstream resolves it the same way). On
 * Windows the crate's build-script path under a worktree passes MAX_PATH and
 * MSVC's link.exe fails (LNK1104), so the default is a short per-checkout dir
 * inside the workspace: <.uniwork-dev>/ct-<hash of the checkout path>, or
 * <checkout>/.go-tmp/ct outside such a workspace - never a drive-root dir.
 * Elsewhere cargo's own <crate>/target is fine (null).
 */
export function nativeTargetDirectory({ repositoryRoot, platform = process.platform, environment = process.env } = {}) {
  const flavour = pathFor(platform);
  const configured = environment.CARGO_TARGET_DIR?.trim();
  if (configured) return flavour.resolve(repositoryRoot, configured);
  if (platform !== "win32") return null;
  const root = flavour.resolve(repositoryRoot);
  const workspace = uniworkDevRoot(root, flavour);
  if (!workspace) return flavour.join(root, ".go-tmp", "ct");
  return flavour.join(workspace, `ct-${createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 8)}`);
}

/**
 * Build whatever xlsx asset is missing, when the host can. With the gateway
 * and the sidecar both present, an explicit OFFICE_DESKTOP_XLSX_ASSETS dir,
 * OFFICE_DESKTOP_SKIP_NATIVE_BUILD=1, a foreign target platform or no cargo, nothing runs and today's behaviour
 * stands. Otherwise scripts/office/build-upstream.mjs --with-native runs into
 * the default scratch tree (reusing its npm install), which copies the
 * sidecar to <out>/native so staging finds it without CARGO_TARGET_DIR.
 */
export function ensureXlsxAssets({
  repositoryRoot,
  platform = process.platform,
  hostPlatform = process.platform,
  environment = process.env,
  locate = locateCargo,
  spawn = spawnSync,
  log = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  const before = resolveXlsxAssetSources({ repositoryRoot, platform, environment });
  if (before.explicit) return { attempted: false, reason: "explicit", sources: before };
  if (before.gateway && before.sidecar) return { attempted: false, reason: "present", sources: before };
  if (environment[SKIP_NATIVE_BUILD_ENV]?.trim() === "1") return { attempted: false, reason: "skipped", sources: before };
  if (platform !== hostPlatform) return { attempted: false, reason: "cross-platform", sources: before };
  const cargo = locate({ environment, platform });
  if (!cargo) return { attempted: false, reason: "no-cargo", sources: before };
  const args = [join(repositoryRoot, "scripts", "office", "build-upstream.mjs"), "--with-native", "--out", before.buildDirectory];
  if (existsSync(join(before.buildDirectory, "upstream", "node_modules"))) args.push("--skip-install");
  const key = pathKey(environment);
  const childEnvironment = { ...environment, [key]: [pathFor(platform).dirname(cargo), environment[key] ?? ""].join(pathFor(platform).delimiter) };
  const targetDirectory = nativeTargetDirectory({ repositoryRoot, platform, environment });
  if (targetDirectory) childEnvironment.CARGO_TARGET_DIR = targetDirectory;
  log(`office-desktop: building the xlsx gateway + recalc sidecar with ${cargo}${targetDirectory ? ` (CARGO_TARGET_DIR=${targetDirectory})` : ""}`);
  const result = spawn(process.execPath, args, { cwd: repositoryRoot, env: childEnvironment, stdio: "inherit", windowsHide: true });
  // A failed build can leave a stale binary in a shared CARGO_TARGET_DIR that
  // the sources still resolve; prepareXlsxAssets refuses it under REQUIRE and
  // the record provenance check warns about it otherwise.
  const sources = resolveXlsxAssetSources({ repositoryRoot, platform, environment });
  const ok = result.status === 0;
  return { attempted: true, ok, reason: ok ? "built" : `build-upstream failed (${result.error?.message ?? `exit ${result.status}`})`, sources };
}

const sidecarMissingReasons = {
  explicit: "OFFICE_DESKTOP_XLSX_ASSETS names a directory without it",
  "cross-platform": "it can only be built on a host of the target platform",
  "no-cargo": "cargo was found neither on PATH nor in CARGO_HOME/~/.cargo/bin",
  "not-attempted": "the desktop build step did not produce it",
  skipped: `${SKIP_NATIVE_BUILD_ENV}=1 disabled the automatic native build`,
  built: "the native build finished but did not produce it (see the native step of the build-upstream record)",
};

/** The actionable failure when OFFICE_DESKTOP_REQUIRE_XLSX_SIDECAR=1 and the build would ship no sidecar. */
export function missingRequiredSidecarError({ platform = process.platform, attempt }) {
  const why = sidecarMissingReasons[attempt?.reason] ?? attempt?.reason ?? "it was not found";
  return new Error(
    `${REQUIRE_SIDECAR_ENV}=1 but no ${xlsxSidecarFile(platform)} xlsx recalc sidecar is available for ${platform}: ${why}. ` +
      "Without it every save of a local .xlsx with formulas is refused (xlsx_recalc_unavailable). " +
      "Fix that and rerun - with the Rust toolchain (rustup, toolchain 1.88.0) the build runs node scripts/office/build-upstream.mjs --with-native itself " +
      `(Windows: into a short per-checkout CARGO_TARGET_DIR; ${SKIP_NATIVE_BUILD_ENV}=1 turns that off) - or point OFFICE_DESKTOP_XLSX_ASSETS at a directory holding xlsx-gateway.mjs and the sidecar.`,
  );
}

/** The advisory a dev build prints when it stages no sidecar; the hint follows the real reason. */
export function missingSidecarWarning({ platform = process.platform, attempt }) {
  const reason = attempt?.reason ?? "not-attempted";
  const hint = reason === "no-cargo"
    ? "Install the Rust toolchain (rustup 1.88.0) so the build can run node scripts/office/build-upstream.mjs --with-native, or point OFFICE_DESKTOP_XLSX_ASSETS at a dir holding xlsx-gateway.mjs + the sidecar."
    : reason === "skipped"
      ? `Unset ${SKIP_NATIVE_BUILD_ENV} to let the build run node scripts/office/build-upstream.mjs --with-native, or point OFFICE_DESKTOP_XLSX_ASSETS at a dir holding xlsx-gateway.mjs + the sidecar.`
      : reason.startsWith("build-upstream failed") || reason === "built"
        ? "Read the build-upstream output above (and the native step of its build-record.json), fix the toolchain, and rebuild."
        : "Point OFFICE_DESKTOP_XLSX_ASSETS at a dir holding xlsx-gateway.mjs + the sidecar, or build it with node scripts/office/build-upstream.mjs --with-native.";
  return `office-desktop: no ${xlsxSidecarFile(platform)} xlsx recalc sidecar staged (${sidecarMissingReasons[reason] ?? reason}) - saving a local .xlsx that contains formulas will be refused. ${hint}`;
}

/**
 * Build what is missing (unless `build` is false), apply the
 * OFFICE_DESKTOP_REQUIRE_XLSX_SIDECAR gate, then stage. `requireGateway`
 * false (the dev build) skips staging without a gateway instead of failing;
 * the sidecar gate still fails first when it is set.
 */
export async function prepareXlsxAssets({
  repositoryRoot,
  distDirectory,
  platform = process.platform,
  arches = [process.arch],
  environment = process.env,
  build = true,
  requireGateway = true,
  ensure = ensureXlsxAssets,
} = {}) {
  const attempt = build
    ? ensure({ repositoryRoot, platform, environment })
    : { attempted: false, reason: "not-attempted", sources: resolveXlsxAssetSources({ repositoryRoot, platform, environment }) };
  // A failed native build fails a required build even when a stale sidecar from
  // a shared CARGO_TARGET_DIR still resolves.
  if (sidecarRequired(environment) && ((attempt.attempted && !attempt.ok) || !attempt.sources.sidecar)) throw missingRequiredSidecarError({ platform, attempt });
  if (!attempt.sources.gateway && !requireGateway && !sidecarRequired(environment)) return { attempt, staged: null };
  return { attempt, staged: await stageXlsxAssets({ repositoryRoot, distDirectory, platform, arches, environment }) };
}
