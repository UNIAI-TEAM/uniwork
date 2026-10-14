// What every G7-06 case file shares: temp dirs that are always removed, the
// out dir of one run, a JSON reader and the CLI as a child process. Importing
// this module registers the cleanup hooks on the importing test file.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, afterEach } from "node:test";
import { fileURLToPath } from "node:url";
import { fixtureIds } from "../job-lib.mjs";

export const JOB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const JOB = join(JOB_DIR, "job.mjs");
export const CAPTURES = join(JOB_DIR, "test-fixtures", "captures");
export const FIXTURES = fixtureIds();
export const ONE = FIXTURES[0];

const TMP_DIRS = new Set();

export function tmpDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  TMP_DIRS.add(dir);
  return dir;
}

function removeTmpDirs() {
  for (const dir of TMP_DIRS) rmSync(dir, { recursive: true, force: true });
  TMP_DIRS.clear();
}
afterEach(removeTmpDirs);
after(removeTmpDirs);

export const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
export const outDir = (name) => tmpDir(`g7-06-out-${name}-`);

export function cli(args, env = {}) {
  const run = spawnSync(process.execPath, [JOB, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}
