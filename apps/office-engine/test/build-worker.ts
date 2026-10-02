// Test-only global setup: each Vitest invocation rebuilds the production fork
// and handler thread before any real-service fixture can start a worker.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export default async function buildWorker(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const startedAt = new Date().toISOString();
  const { stdout, stderr } = await exec(process.execPath, [resolve(app, "scripts/build.mjs")], { cwd: app });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  const { stdout: revision } = await exec("git", ["rev-parse", "HEAD"], { cwd: app });
  const artifacts = await Promise.all(["worker.mjs", "worker-run.mjs"].map(async (name) => {
    const path = resolve(app, "dist", name);
    const bytes = await readFile(path);
    if (!bytes.length) throw new Error(`empty compiled worker artifact: ${name}`);
    return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }));
  process.stdout.write(JSON.stringify({ fixture: "fresh-production-worker", revision: revision.trim(), startedAt,
    finishedAt: new Date().toISOString(), node: process.version, artifacts }) + "\n");
}
