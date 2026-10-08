// Worker supervisor: starts one worker process per job, enforces the job's
// limits while it runs and owns its whole process tree. Every way out -
// success, handler failure, limit, cancel, shutdown, crash - ends with the
// tree killed and the process reaped, so nothing a job started outlives it.

import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirBytes } from "./cleanup.ts";
import type { EffectiveLimits, LimitKind } from "./limits.ts";
import { JOB_TAG_ENV, killTree, treeUsage, type TreeUsage } from "./process-tree.ts";
import type { RunMessage, WorkerMessage } from "./worker/protocol.ts";

export interface WorkerRun {
  entry: string;
  operation: string;
  format: string;
  inputPath: string | null;
  payloadPath: string | null;
  outputPath: string;
  tempDir: string;
  /** Dir holding the xlsx gateway bundle + Rust sidecar (config.UNIWORK_XLSX_ASSETS). */
  xlsxAssetsDir?: string;
  /** Docs web bundle + Chromium for export:docx (config.UNIWORK_DOCS_PDF_ASSETS). */
  docsPdfAssetsDir?: string;
  limits: EffectiveLimits;
  sampleMs: number;
  faults: boolean;
  signal: AbortSignal;
  /** Per-slot uid/gid the worker drops to at spawn (sandbox.ts). Undefined on
   * hosts where the sandbox cannot engage - only POSIX fork honours it. */
  uid?: number;
  gid?: number;
}

export type WorkerResult =
  | { kind: "done"; warnings: { code: string; detail?: string }[]; result?: unknown }
  | { kind: "fail"; code: string; reason: string }
  // A limit outcome carries the measurement that tripped it (or the last
  // sample for the wall-clock deadline) so a masked fault outcome - a job
  // that reads timed_out though the handler meant otherwise - diagnoses
  // itself instead of looking like a flake.
  | { kind: "limit"; limit: LimitKind; usage?: TreeUsage & { tempBytes?: number } }
  | { kind: "aborted" }
  | { kind: "crashed"; reason: string };

/** A worker gets no service secret: only what Node needs to start, temp
 * variables pointing into its own job dir, and the job tag its descendants
 * inherit (process-tree.ts kills by it). */
function workerEnv(tempDir: string, tag: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { TMPDIR: tempDir, TEMP: tempDir, TMP: tempDir, HOME: tempDir, NODE_ENV: "production", [JOB_TAG_ENV]: tag };
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR"]) {
    // eslint-disable-next-line no-restricted-syntax -- the only env a worker inherits: how to find executables and the OS root.
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export class Supervisor {
  private readonly live = new Map<ChildProcess, { tag: string; uid?: number }>();

  get running(): number {
    return this.live.size;
  }

  /** Kill every live tree now (shutdown path). */
  killAll(): void {
    for (const [child, info] of this.live) killTree(child, info.tag, info.uid);
  }

  run(job: WorkerRun): Promise<WorkerResult> {
    return new Promise<WorkerResult>((resolve) => {
      const tag = randomUUID();
      const child = fork(job.entry, [], {
        execArgv: [],
        env: workerEnv(job.tempDir, tag),
        cwd: job.tempDir,
        detached: process.platform !== "win32",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        serialization: "json",
        // The uid/gid drop happens inside fork before Node loads: the handler
        // never runs as the service uid. Group leadership (detached) is set
        // before the drop, so killTree's process-group signal is unaffected.
        uid: job.uid,
        gid: job.gid,
      });
      this.live.set(child, { tag, uid: job.uid });
      let result: WorkerResult | null = null;
      let exited = false;
      let reported = { rssBytes: 0, cpuMs: 0 };
      let lastUsage: TreeUsage = reported;
      let sampling = false;

      const finish = () => {
        if (!exited || result === null) return;
        this.live.delete(child);
        resolve(result);
      };
      const settle = (next: WorkerResult) => {
        if (result !== null) return;
        result = next;
        clearInterval(sampler);
        clearTimeout(deadline);
        job.signal.removeEventListener("abort", onAbort);
        killTree(child, tag, job.uid);
        // Bounded wait for the exit event: a tree that ignores SIGKILL does
        // not hold the job forever.
        setTimeout(() => {
          exited = true;
          finish();
        }, 3000).unref();
        finish();
      };

      const check = (usage: TreeUsage) => {
        lastUsage = usage;
        if (usage.cpuMs > job.limits.cpuMs) settle({ kind: "limit", limit: "cpu", usage });
        else if (usage.rssBytes > job.limits.memoryBytes) settle({ kind: "limit", limit: "memory", usage });
      };
      const onAbort = () => settle({ kind: "aborted" });

      const deadline = setTimeout(() => settle({ kind: "limit", limit: "deadline", usage: lastUsage }), Math.max(0, job.limits.deadlineAt - Date.now()));
      const sampler = setInterval(() => {
        if (Date.now() >= job.limits.deadlineAt) {
          settle({ kind: "limit", limit: "deadline", usage: lastUsage });
          return;
        }
        const tree = child.pid === undefined ? null : treeUsage(child.pid, tag, job.uid);
        check({
          rssBytes: Math.max(reported.rssBytes, tree?.rssBytes ?? 0),
          cpuMs: Math.max(reported.cpuMs, tree?.cpuMs ?? 0),
        });
        if (sampling || result !== null) return;
        sampling = true;
        void dirBytes(job.tempDir, job.limits.tempBytes).then((bytes) => {
          sampling = false;
          if (bytes > job.limits.tempBytes) settle({ kind: "limit", limit: "temp", usage: { ...lastUsage, tempBytes: bytes } });
        });
      }, job.sampleMs);

      if (job.signal.aborted) {
        settle({ kind: "aborted" });
      } else {
        job.signal.addEventListener("abort", onAbort);
      }

      child.on("message", (raw: WorkerMessage) => {
        if (raw.type === "usage") {
          reported = { rssBytes: raw.rssBytes, cpuMs: raw.cpuMs };
          check(reported);
        } else if (raw.type === "done") {
          settle({ kind: "done", warnings: Array.isArray(raw.warnings) ? raw.warnings : [], ...(raw.result !== undefined ? { result: raw.result } : {}) });
        } else if (raw.type === "fail") {
          settle({ kind: "fail", code: String(raw.code), reason: String(raw.reason) });
        }
      });
      child.on("error", () => settle({ kind: "crashed", reason: "spawn_failed" }));
      child.on("exit", (code, signal) => {
        settle({ kind: "crashed", reason: signal ? "signal_" + signal : "exit_" + code });
        exited = true;
        finish();
      });

      const run: RunMessage = {
        type: "run",
        operation: job.operation,
        format: job.format,
        inputPath: job.inputPath,
        outputPath: job.outputPath,
        payloadPath: job.payloadPath,
        tempDir: job.tempDir,
        ...(job.xlsxAssetsDir ? { xlsxAssetsDir: job.xlsxAssetsDir } : {}),
        ...(job.docsPdfAssetsDir ? { docsPdfAssetsDir: job.docsPdfAssetsDir } : {}),
        sandboxed: job.uid !== undefined,
        sampleMs: job.sampleMs,
        heapMb: job.limits.heapMb,
        faults: job.faults,
      };
      child.send(run, (error) => {
        if (error) settle({ kind: "crashed", reason: "ipc_send_failed" });
      });
    });
  }
}
