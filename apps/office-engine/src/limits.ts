// Per-job limits. The effective value is always the tightest of the service
// config, the grant Go issued and the envelope: nothing a request carries can
// raise a limit, and there is no "no timeout" value anywhere.

import type { EngineErrorCode, JobState } from "@uniwork/office-contracts";
import type { JobLimits } from "./config.ts";
import type { ServiceGrant } from "./grants.ts";

const MiB = 1024 * 1024;

export interface EffectiveLimits {
  deadlineAt: number;
  cpuMs: number;
  memoryBytes: number;
  heapMb: number;
  tempBytes: number;
  maxOutputBytes: number;
}

export function resolveLimits(limits: JobLimits, grant: ServiceGrant, deadlineMs: number | null, now: number): EffectiveLimits {
  const requested = deadlineMs ?? limits.maxJobMs;
  return {
    deadlineAt: Math.min(now + requested, now + limits.maxJobMs, grant.deadline_at),
    cpuMs: limits.cpuMs,
    memoryBytes: limits.memoryBytes,
    // The handler thread's V8 heap sits below the tree RSS cap so a JS
    // allocation spiral dies as a named out-of-memory, not a host OOM kill.
    heapMb: Math.max(16, Math.floor((limits.memoryBytes / MiB) * 0.75)),
    tempBytes: limits.tempBytes,
    maxOutputBytes: Math.min(limits.maxOutputBytes, grant.output?.max_bytes ?? limits.maxOutputBytes),
  };
}

export type LimitKind = "deadline" | "cpu" | "memory" | "temp" | "output";

export interface LimitOutcome {
  state: Extract<JobState, "timed_out" | "failed">;
  code: EngineErrorCode;
  reason: string;
}

export const LIMIT_OUTCOMES: Record<LimitKind, LimitOutcome> = {
  deadline: { state: "timed_out", code: "engine_timeout", reason: "deadline" },
  cpu: { state: "timed_out", code: "engine_timeout", reason: "cpu_limit" },
  memory: { state: "failed", code: "engine_crashed", reason: "memory_limit" },
  temp: { state: "failed", code: "engine_crashed", reason: "temp_limit" },
  output: { state: "failed", code: "upload_bounds", reason: "output_limit" },
};
