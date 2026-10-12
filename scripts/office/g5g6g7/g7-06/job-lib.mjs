// Shared pieces of the G7-06 regression job (UNI-1378, contract section 1/2).
//
// The job compares a fork pin with this checkout: the fork's protocol sources
// (raw bytes, read through git), the G6-01 extractor column, committed golden
// shots and the rendered text of the capture provider. Everything that more
// than one check needs lives here: the repo paths, the status vocabulary, the
// fixture ids and the pngjs loader (declared by packages/office-engine, which
// is where a root script may take it from — see scripts/lucide-aliases.mjs).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const JOB_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(JOB_DIR, "..", "..", "..", "..");

/** The four checks, in the order every summary and result.json lists them. */
export const CHECK_NAMES = Object.freeze(["protocol", "extractor", "golden", "brand"]);
/** The two hosts the capture provider shoots (contract section 3). */
export const HOSTS = Object.freeze(["desktop", "web"]);
export const STATUSES = Object.freeze(["PASS", "FAIL", "BLOCKED", "NOTE"]);
/** BLOCKED is the exit code the G7-01 harness already uses for "cannot run". */
export const BLOCKED_EXIT = 77;

export const DEFAULT_OUT = ".g7-06-run";
export const DEFAULT_PIN_DIR = join(REPO_ROOT, "apps", "web", "platform", "office-frame");
export const DEFAULT_GOLDENS_DIR = join(JOB_DIR, "goldens");
export const FIXTURES_MANIFEST = join(REPO_ROOT, "docs", "office", "g5g6g7", "fixtures", "manifest.json");
export const TOOLS_DOC = join(REPO_ROOT, "docs", "office", "g5g6g7", "genoffice-tools.md");

/** The fork paths whose raw bytes the `protocol` check hashes (contract 2.1). */
export const PROTOCOL_FILES = Object.freeze({
  protocol: "web/docs/protocol/types.ts",
  endpoint: "web/docs/protocol/endpoint.ts",
  host: "web/docs/protocol/host.ts",
});

/** FAIL is worse than BLOCKED, which is worse than NOTE, which is worse than PASS. */
const STATUS_RANK = { PASS: 0, NOTE: 1, BLOCKED: 2, FAIL: 3 };

/** @param {string[]} statuses @returns {"PASS" | "NOTE" | "BLOCKED" | "FAIL"} */
export function mergeStatus(statuses) {
  return statuses.reduce((worst, status) => (STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst), "PASS");
}

/** The exit code a run ends with: 1 any FAIL, else 77 any BLOCKED, else 0. */
export function exitCodeFor(checks) {
  const statuses = Object.values(checks).map((check) => check.status);
  if (statuses.includes("FAIL")) return 1;
  if (statuses.includes("BLOCKED")) return BLOCKED_EXIT;
  return 0;
}

/** @param {string} file @returns {unknown | null} the parsed file, null when absent */
export function readJsonIfPresent(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * The six fixture ids, read from the same manifest the acceptance matrix names
 * (`fixtureManifest` in docs/office/g5g6g7/acceptance-rows.json).
 * @param {string} [manifestPath]
 * @returns {string[]}
 */
export function fixtureIds(manifestPath = FIXTURES_MANIFEST) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return manifest.fixtures.map((fixture) => fixture.id);
}

/**
 * pngjs is a dependency of packages/office-engine (catalog pngjs), like
 * lucide-react for packages/ui: a root script resolves it through that
 * workspace's package.json instead of declaring it again (knip keeps the
 * engine's own use as the single source).
 */
export function loadPngjs() {
  const requireFromEngine = createRequire(join(REPO_ROOT, "packages", "office-engine", "package.json"));
  try {
    return requireFromEngine("pngjs");
  } catch (error) {
    throw new Error(`pngjs is not installed (packages/office-engine/node_modules/pngjs): ${error.message}`);
  }
}

/**
 * `git` in a directory; stdout stays a Buffer so raw bytes can be hashed.
 * @param {string[]} args
 * @param {{ cwd?: string, encoding?: "utf8" | undefined, maxBuffer?: number }} [options]
 */
export function runGit(args, { cwd, encoding, maxBuffer = 16 * 1024 * 1024 } = {}) {
  return spawnSync("git", args, { cwd, encoding, maxBuffer });
}

/** The last `n` non-empty lines of a command's output, for a failure reason. */
export function tail(text, n = 20) {
  const lines = String(text ?? "").split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.slice(-n).join("\n");
}

/** A path as it will be written into result.json: relative to the run's out dir. */
export function relativeToOut(outDir, file) {
  const abs = resolve(file);
  const rel = abs.startsWith(resolve(outDir) + "/") ? abs.slice(resolve(outDir).length + 1) : abs;
  return rel;
}

/**
 * The installed bundle directory for a pin version. `--installed` names what
 * `frame-install` wrote: the module's public root (public/office-frame/docs,
 * holding <version>/manifest.json) or, tolerantly, the whole public root or
 * the bundle directory itself.
 * @param {string | null} installedRoot
 * @param {string | null} version
 * @returns {{ dir: string } | { missing: string }}
 */
export function resolveInstalledBundle(installedRoot, version) {
  if (!installedRoot) return { missing: "no --installed root was given" };
  const candidates = [];
  if (version) {
    candidates.push(join(installedRoot, version), join(installedRoot, "docs", version));
  }
  candidates.push(installedRoot);
  for (const dir of candidates) {
    if (existsSync(join(dir, "manifest.json"))) return { dir };
  }
  return { missing: `no manifest.json under ${installedRoot}${version ? ` for version ${version}` : ""}` };
}

/** @param {string} value @returns {string} the path as given, resolved against cwd */
export function resolveFromCwd(value) {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}