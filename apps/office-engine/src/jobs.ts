// Job lifecycle on the engine side: a bounded pool of workers, a bounded
// queue, and a state machine whose terminal outcome is decided exactly once
// (the first transition out of a live state wins; a later one is ignored).
// This ledger is in memory on purpose - Go's office_jobs row is the durable
// record, and after an engine restart Go reconciles from it and from the
// FileService provider-output intent. A completed job here means "the output
// object was written", never "a Document version exists".

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ENGINE_VERSION_TRUSTED,
  EngineBoundaryError,
  isTerminalJobState,
  type EngineErrorCode,
  type JobState,
} from "@uniwork/office-contracts";
import { createJobDir, INPUT_NAME, OPS_NAME, OUTPUT_NAME, removeJobDir } from "./cleanup.ts";
import type { EngineServiceConfig } from "./config.ts";
import { checkLive, GrantLedger, type ServiceGrant } from "./grants.ts";
import { LIMIT_OUTCOMES, resolveLimits, type EffectiveLimits } from "./limits.ts";
import type { Metrics } from "./metrics.ts";
import { measureOutput, putOutput } from "./output.ts";
import { WorkerSandbox } from "./sandbox.ts";
import { Supervisor } from "./supervisor.ts";

const WORKER_CODES: ReadonlySet<string> = new Set(["engine_result_invalid", "unsupported_operation", "engine_crashed"]);

export interface Job {
  jobId: string;
  grantId: string;
  actorId: string;
  requestId: string;
  operation: string;
  format: string;
  fingerprint: string;
  state: JobState;
  acceptedAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Public error shape: code + reason, plus public-safe extras (the measured
      usage that tripped a limit, a bound's max bytes) that land in jobView. */
  error?: { code: EngineErrorCode; reason: string; extra?: Record<string, unknown> };
  output?: { file_id: string; checksum: string; length: number };
  warnings: { code: string; detail?: string }[];
  limits: EffectiveLimits;
  grant: ServiceGrant;
  input: Uint8Array | null;
  /** Validated envelope payload extras (edits[] for edit/open); serialized
      into ops.json inside the job dir so the worker IPC carries only paths. */
  payload: Record<string, unknown> | null;
  controller: AbortController;
}

export interface SubmitRequest {
  grant: ServiceGrant;
  fingerprint: string;
  requestId: string;
  deadlineMs: number | null;
  input: Uint8Array | null;
  payload?: Record<string, unknown> | null;
}

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private readonly ledger: GrantLedger;
  private readonly supervisor = new Supervisor();
  private readonly inFlight = new Set<Promise<void>>();
  private active = 0;
  private draining = false;

  constructor(
    private readonly config: EngineServiceConfig,
    private readonly metrics: Metrics,
    private readonly now: () => number = Date.now,
    private readonly sandbox: WorkerSandbox = WorkerSandbox.create(config.sandbox, config.maxWorkers),
  ) {
    this.ledger = new GrantLedger(Math.max(1024, (config.maxQueue + config.maxWorkers) * 64));
  }

  get queueDepth(): number {
    return this.queue.length;
  }

  get runningCount(): number {
    return this.active;
  }

  get isDraining(): boolean {
    return this.draining;
  }

  /** Slot uids held by surviving processes — a nonzero count means the pool
      has permanently shrunk; health/readiness should notice. */
  get sandboxQuarantined(): number {
    return this.sandbox.quarantined;
  }

  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  /** Accept a job or replay the one this grant already started. */
  submit(req: SubmitRequest): { job: Job; replay: boolean } {
    const now = this.now();
    this.prune(now);
    const { grant } = req;
    const used = this.ledger.lookup(grant.grant_id);
    if (used) {
      if (used.fingerprint !== req.fingerprint) throw new EngineBoundaryError("payload_fingerprint_mismatch", { job_id: used.jobId });
      const earlier = this.jobs.get(used.jobId);
      if (!earlier) throw new EngineBoundaryError("grant_consumed", { reason: "job_forgotten" });
      return { job: earlier, replay: true };
    }
    if (this.jobs.has(grant.job_id)) throw new EngineBoundaryError("job_conflict", { reason: "job_id_taken" });
    checkLive(grant, now);
    if (this.draining) throw new EngineBoundaryError("engine_overloaded", { reason: "draining" });
    if (this.active >= this.config.maxWorkers && this.queue.length >= this.config.maxQueue) {
      throw new EngineBoundaryError("engine_overloaded", { reason: "queue_full", queue_depth: this.queue.length });
    }
    this.ledger.consume(grant, req.fingerprint, now);
    const job: Job = {
      jobId: grant.job_id,
      grantId: grant.grant_id,
      actorId: grant.actor_id,
      requestId: req.requestId,
      operation: grant.operation,
      format: grant.format,
      fingerprint: req.fingerprint,
      state: "accepted",
      acceptedAt: now,
      warnings: [],
      limits: resolveLimits(this.config.limits, grant, req.deadlineMs, now),
      grant,
      input: req.input,
      payload: req.payload ?? null,
      controller: new AbortController(),
    };
    this.jobs.set(job.jobId, job);
    this.queue.push(job);
    this.metrics.accepted(job.operation);
    this.pump();
    return { job, replay: false };
  }

  /** Cancel wins only against a live job; a settled job answers its outcome. */
  cancel(jobId: string): { previous: JobState; job: Job } {
    const job = this.jobs.get(jobId);
    if (!job) throw new EngineBoundaryError("not_found", { resource: "job" });
    const previous = job.state;
    if (this.transition(job, "cancelled", { code: "engine_cancelled", reason: "cancel_requested" })) {
      const queued = this.queue.indexOf(job);
      if (queued >= 0) this.queue.splice(queued, 1);
      job.controller.abort();
    }
    return { previous, job };
  }

  /** Stop accepting, settle every live job as crashed (reason shutdown), kill
   * every worker tree and wait for the per-job cleanup to finish. */
  async shutdown(graceMs: number): Promise<void> {
    this.draining = true;
    for (const job of [...this.queue, ...this.jobs.values()]) {
      if (this.transition(job, "crashed", { code: "engine_crashed", reason: "shutdown" })) job.controller.abort();
    }
    this.queue.length = 0;
    this.supervisor.killAll();
    await Promise.race([Promise.allSettled([...this.inFlight]), new Promise((r) => setTimeout(r, graceMs).unref())]);
  }

  private transition(job: Job, to: JobState, error?: { code: EngineErrorCode; reason: string; extra?: Record<string, unknown> }): boolean {
    if (isTerminalJobState(job.state)) return false;
    if (to === "running" && job.state !== "accepted") return false;
    job.state = to;
    if (to === "running") {
      job.startedAt = this.now();
      return true;
    }
    job.finishedAt = this.now();
    job.input = null;
    if (error) job.error = error;
    if (isTerminalJobState(to)) this.metrics.finished(job.operation, to, job.finishedAt - (job.startedAt ?? job.acceptedAt));
    return true;
  }

  private pump(): void {
    while (!this.draining && this.active < this.config.maxWorkers && this.queue.length > 0) {
      const job = this.queue.shift() as Job;
      if (!this.transition(job, "running")) continue;
      this.active++;
      const done = this.execute(job).finally(() => {
        this.active--;
        this.inFlight.delete(done);
        this.pump();
      });
      this.inFlight.add(done);
    }
  }

  private async execute(job: Job): Promise<void> {
    let dir: string | null = null;
    // One uid per worker slot: reserved before the dir exists so two jobs can
    // never share a uid, and held until the tree is dead and the dir is gone.
    const identity = this.sandbox.acquire();
    try {
      dir = await createJobDir(this.config.tempRoot);
      const inputPath = job.input ? join(dir, INPUT_NAME) : null;
      if (inputPath && job.input) await writeFile(inputPath, job.input);
      const payloadPath = job.payload ? join(dir, OPS_NAME) : null;
      if (payloadPath) await writeFile(payloadPath, JSON.stringify(job.payload));
      job.input = null;
      job.payload = null;
      // Hand the dir to the slot uid before the worker spawns; from then on the
      // worker owns exactly this 0700 dir and nothing else on the filesystem.
      if (identity) await this.sandbox.adopt(dir, identity);
      const outputPath = join(dir, OUTPUT_NAME);
      const result = await this.supervisor.run({
        entry: this.config.workerEntry,
        operation: job.operation,
        format: job.format,
        inputPath,
        outputPath,
        payloadPath,
        tempDir: dir,
        limits: job.limits,
        sampleMs: this.config.sampleMs,
        faults: this.config.faultOperations,
        signal: job.controller.signal,
        uid: identity?.uid,
        gid: identity?.gid,
      });
      switch (result.kind) {
        case "done":
          job.warnings = result.warnings;
          await this.deliver(job, outputPath, identity?.uid);
          return;
        case "fail": {
          // A worker may only report the few codes a handler can mean; it can
          // never claim a grant, conflict or storage outcome.
          const code = WORKER_CODES.has(result.code) ? (result.code as EngineErrorCode) : "engine_result_invalid";
          this.transition(job, "failed", { code, reason: result.reason });
          return;
        }
        case "limit": {
          const outcome = LIMIT_OUTCOMES[result.limit];
          // The measurement that tripped the limit rides on the error: a job
          // that dies timed_out while a fault meant otherwise (UNI-688) shows
          // the cpu/rss it actually consumed instead of looking like a flake.
          const extra: Record<string, unknown> = {};
          if (result.usage) {
            if (result.usage.cpuMs > 0) extra.measured_cpu_ms = result.usage.cpuMs;
            if (result.usage.rssBytes > 0) extra.measured_rss_bytes = result.usage.rssBytes;
            if (result.usage.tempBytes !== undefined) extra.measured_temp_bytes = result.usage.tempBytes;
          }
          this.transition(job, outcome.state, { code: outcome.code, reason: outcome.reason, extra });
          return;
        }
        case "crashed":
          this.transition(job, "crashed", { code: "engine_crashed", reason: result.reason });
          return;
        case "aborted":
          // The canceller or shutdown already settled the state.
          return;
      }
    } catch (error) {
      if (error instanceof EngineBoundaryError) {
        const state: JobState = error.code === "engine_timeout" ? "timed_out" : "failed";
        this.transition(job, state, { code: error.code, reason: String(error.fields.reason ?? error.code), extra: error.fields });
      } else {
        this.transition(job, "crashed", { code: "engine_crashed", reason: "internal_error" });
      }
    } finally {
      if (dir) await removeJobDir(dir).catch(() => undefined);
      // The uid only goes back to the pool once nothing runs under it; a
      // descendant that outlives the sweep quarantines the slot instead.
      await this.sandbox.release(identity);
    }
  }

  /** Measure and upload the output within what is left of the deadline. */
  private async deliver(job: Job, outputPath: string, expectedUid?: number): Promise<void> {
    const target = job.grant.output;
    if (!target) {
      this.transition(job, "completed");
      return;
    }
    const measured = await measureOutput(outputPath, job.limits.maxOutputBytes, expectedUid);
    const remaining = job.limits.deadlineAt - this.now();
    if (remaining <= 0) throw new EngineBoundaryError("engine_timeout", { reason: "deadline" });
    const timeout = AbortSignal.timeout(remaining);
    try {
      await putOutput(measured, target, AbortSignal.any([job.controller.signal, timeout]));
    } catch (error) {
      if (job.controller.signal.aborted) return;
      if (timeout.aborted) throw new EngineBoundaryError("engine_timeout", { reason: "deadline" });
      throw error;
    }
    job.output = { file_id: target.file_id, checksum: measured.checksum, length: measured.length };
    if (!this.transition(job, "completed")) job.output = undefined;
  }

  private prune(now: number): void {
    this.ledger.prune(now);
    const settled = [...this.jobs.values()].filter((j) => isTerminalJobState(j.state));
    const excess = settled.length - this.config.maxRetainedJobs;
    settled.forEach((job, index) => {
      if (index < excess || (job.finishedAt ?? now) + this.config.terminalRetentionMs <= now) this.jobs.delete(job.jobId);
    });
  }
}

/** Status view. Carries ids, digests and codes only - no path, no target URL. */
export function jobView(job: Job): Record<string, unknown> {
  return {
    job_id: job.jobId,
    request_id: job.requestId,
    state: job.state,
    operation: job.operation,
    format: job.format,
    engine_version: ENGINE_VERSION_TRUSTED,
    accepted_at: job.acceptedAt,
    ...(job.startedAt !== undefined ? { started_at: job.startedAt } : {}),
    ...(job.finishedAt !== undefined ? { finished_at: job.finishedAt } : {}),
    ...(job.output
      ? { output_file_id: job.output.file_id, output_checksum: job.output.checksum, output_length: job.output.length }
      : {}),
    warnings: job.warnings,
    ...(job.error ? { error: new EngineBoundaryError(job.error.code, { reason: job.error.reason, ...job.error.extra }).toJSON() } : {}),
  };
}
