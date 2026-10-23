// Worker process entry. One process per job, owned by the supervisor. Its main
// thread only reports usage and relays the outcome; the operation runs on a
// worker_thread with a V8 heap cap, so a handler that blocks its event loop
// (a CPU-bound parse, a synchronous native call) cannot silence the usage
// reports the supervisor enforces CPU and memory limits with.

import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { HandlerOutcome, RunMessage, WorkerMessage } from "./protocol.ts";

// Unbundled (Node strips types) the handler thread is ./run.ts; the bundle
// from scripts/build.mjs names it worker-run.mjs beside worker.mjs.
const runner = fileURLToPath(import.meta.url).endsWith(".ts")
  ? new URL("./run.ts", import.meta.url)
  : new URL("./worker-run.mjs", import.meta.url);

function send(message: WorkerMessage): void {
  if (process.send) process.send(message);
}

function usage(): void {
  const cpu = process.cpuUsage();
  send({ type: "usage", rssBytes: process.memoryUsage.rss(), cpuMs: Math.round((cpu.user + cpu.system) / 1000) });
}

function finish(message: WorkerMessage): void {
  usage();
  send(message);
  // Let the IPC channel flush, then leave; the supervisor kills the tree anyway.
  process.disconnect?.();
  setTimeout(() => process.exit(0), 50).unref();
}

process.once("message", (raw: unknown) => {
  const message = raw as RunMessage;
  if (message?.type !== "run") {
    finish({ type: "fail", code: "engine_result_invalid", reason: "bad_run_message" });
    return;
  }
  const timer = setInterval(usage, message.sampleMs);
  usage();
  const worker = new Worker(runner, {
    workerData: message,
    resourceLimits: { maxOldGenerationSizeMb: message.heapMb },
    stdout: false,
    stderr: false,
  });
  let settled = false;
  worker.once("message", (outcome: HandlerOutcome) => {
    settled = true;
    clearInterval(timer);
    finish(outcome.ok ? { type: "done", warnings: outcome.warnings, ...(outcome.result !== undefined ? { result: outcome.result } : {}) } : { type: "fail", code: outcome.code, reason: outcome.reason });
  });
  worker.once("error", (error: Error & { code?: string }) => {
    if (settled) return;
    settled = true;
    clearInterval(timer);
    const oom = error.code === "ERR_WORKER_OUT_OF_MEMORY";
    finish({ type: "fail", code: "engine_crashed", reason: oom ? "memory_limit" : "handler_error" });
  });
  worker.once("exit", (code) => {
    if (settled) return;
    settled = true;
    clearInterval(timer);
    finish({ type: "fail", code: "engine_crashed", reason: "handler_exit_" + code });
  });
});
