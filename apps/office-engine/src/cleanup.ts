// Per-job temp directories. Every job gets its own directory under tempRoot,
// named by the service (a random suffix, never a user filename or a job id a
// caller chose), and the directory is removed when the job settles. On start
// the service sweeps directories a crashed predecessor left behind; it only
// ever touches names that carry its own prefix.

import { mkdtemp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const JOB_DIR_PREFIX = "uw-office-job-";

/** Fixed names inside a job dir: the handler never sees a caller's filename. */
export const INPUT_NAME = "input.bin";
export const OUTPUT_NAME = "output.bin";
export const OPS_NAME = "ops.json";

export async function createJobDir(tempRoot: string): Promise<string> {
  await mkdir(tempRoot, { recursive: true });
  return mkdtemp(join(tempRoot, JOB_DIR_PREFIX));
}

export async function removeJobDir(dir: string): Promise<void> {
  // Windows can hold a handle for a moment after the tree was killed.
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** Remove job dirs left by an earlier process. Returns how many went. */
export async function sweepStaleJobDirs(tempRoot: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(tempRoot);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.startsWith(JOB_DIR_PREFIX)) continue;
    await removeJobDir(join(tempRoot, name));
    removed++;
  }
  return removed;
}

/** Total bytes under dir. Stops early once `stopAbove` is exceeded, so a job
 * that floods its temp dir does not make the sampler itself expensive. */
export async function dirBytes(dir: string, stopAbove = Number.POSITIVE_INFINITY): Promise<number> {
  let total = 0;
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else {
        try {
          total += (await stat(path)).size;
        } catch {
          // The file went away between readdir and stat.
        }
        if (total > stopAbove) return total;
      }
    }
  }
  return total;
}
