// Service configuration. Every value is injected by the deployer: main.ts is
// the only file that reads the process environment, and it hands the map to
// loadConfig. Nothing here has an unbounded default - a missing secret refuses
// to start, and every limit is finite.
//
// PROVISIONAL LIMITS (G2-02, 2026-09-27). The defaults below are conservative
// values, not budgets: acceptance-thresholds.md T-2 needs n >= 5 on the target
// machine class before a value is a budget, and only worker spawn and the
// md/html serialize path were measured on this service (see the G2-02 report,
// reports/g2-02-engine-service/limits-measurement.md). CPU/RAM for the XLSX
// sidecar and the PDF adapter are unmeasured until G2-04/G2-05 land; revisit
// each default when those lanes record their envelopes.

import { ENGINE_LIMITS } from "@uniwork/office-contracts";

export interface JobLimits {
  /** Wall-clock ceiling for one job, whatever the grant or envelope asks. */
  maxJobMs: number;
  /** CPU time (user + system, whole process tree where measurable). */
  cpuMs: number;
  /** Resident memory of the worker tree, and the V8 heap cap of the worker. */
  memoryBytes: number;
  /** Bytes the job may leave in its private temp directory. */
  tempBytes: number;
  maxInputBytes: number;
  maxOutputBytes: number;
}

export interface EngineServiceConfig {
  host: string;
  port: number;
  /** Bearer credential Go presents on every request (service authentication). */
  serviceToken: string;
  /** HMAC key the per-job grant is signed with. Distinct from serviceToken so
   * that holding the service credential never lets a caller mint a grant. */
  grantKey: string;
  /** Origins a grant's output write target may point at (FileService storage). */
  outputOrigins: readonly string[];
  maxWorkers: number;
  maxQueue: number;
  limits: JobLimits;
  /** Root under which each job gets its own private temp directory. */
  tempRoot: string;
  /** Worker entry: src/worker/entry.ts (Node 22 strips types) or dist/worker.mjs. */
  workerEntry: string;
  /** How often the supervisor samples a worker's usage and temp directory. */
  sampleMs: number;
  /** Terminal jobs are kept this long for status/replay, then forgotten. */
  terminalRetentionMs: number;
  maxRetainedJobs: number;
  /** Test-only fault operations (see worker/faults.ts). Never on in an image. */
  faultOperations: boolean;
  /** Grace period for in-flight HTTP responses on shutdown. */
  shutdownGraceMs: number;
  /** Per-job uid sandbox; see SandboxConfig. */
  sandbox: SandboxConfig;
  /** Dir holding the patched xlsx-gateway bundle + Rust sidecar binary
   *  (UNIWORK_XLSX_ASSETS). Undefined when the lane is not staged. */
  xlsxAssetsDir?: string;
}

const MiB = 1024 * 1024;

export const PROVISIONAL_LIMITS: JobLimits = {
  maxJobMs: 120_000,
  cpuMs: 60_000,
  memoryBytes: 512 * MiB,
  tempBytes: 256 * MiB,
  // DocumentFile policy caps a Document version at 50 MiB (files/registry.go).
  maxInputBytes: 50 * MiB,
  maxOutputBytes: 50 * MiB,
};

/** Per-job uid sandbox (G2-05). Each worker slot owns one uid/gid; the pool
 * starts at uidBase and runs maxWorkers long, all inside the unprivileged
 * range. mode: "auto" engages only on Linux as uid 0, "required" refuses to
 * start anywhere else, "off" is for dev debugging. */
export interface SandboxConfig {
  mode: "auto" | "required" | "off";
  uidBase: number;
  gidBase: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function positiveInt(env: Record<string, string | undefined>, key: string, fallback: number, max?: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigError(key + " must be a positive integer");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new ConfigError(key + " must be a positive integer");
  if (max !== undefined && value > max) throw new ConfigError(key + " must be at most " + max);
  return value;
}

function secret(env: Record<string, string | undefined>, key: string): string {
  const value = env[key] ?? "";
  if (value.length < 32) throw new ConfigError(key + " must be set to at least 32 characters");
  return value;
}

function origins(raw: string | undefined): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  for (const origin of list) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new ConfigError("OFFICE_ENGINE_OUTPUT_ORIGINS entry is not a URL: " + origin);
    }
    if (parsed.origin !== origin || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      throw new ConfigError("OFFICE_ENGINE_OUTPUT_ORIGINS entries must be bare http(s) origins: " + origin);
    }
  }
  return list;
}

const SANDBOX_MODES = ["auto", "required", "off"] as const;
// The worker uid pool lives above the conventional system-uid ceiling and
// below "nobody" (65534): a worker must never land on a uid that exists.
const UID_MIN = 1000;
const UID_MAX = 65533;

function sandboxConfig(env: Record<string, string | undefined>, maxWorkers: number): SandboxConfig {
  const mode = env.OFFICE_ENGINE_SANDBOX ?? "auto";
  if (!(SANDBOX_MODES as readonly string[]).includes(mode)) {
    throw new ConfigError("OFFICE_ENGINE_SANDBOX must be one of " + SANDBOX_MODES.join(", "));
  }
  const uidBase = positiveInt(env, "OFFICE_ENGINE_WORKER_UID_BASE", 60100);
  const gidBase = positiveInt(env, "OFFICE_ENGINE_WORKER_GID_BASE", uidBase);
  for (const [key, base] of [
    ["OFFICE_ENGINE_WORKER_UID_BASE", uidBase],
    ["OFFICE_ENGINE_WORKER_GID_BASE", gidBase],
  ] as const) {
    if (base < UID_MIN || base + maxWorkers - 1 > UID_MAX) {
      throw new ConfigError(key + " must keep the " + maxWorkers + "-slot pool inside " + UID_MIN + ".." + UID_MAX);
    }
  }
  return { mode: mode as SandboxConfig["mode"], uidBase, gidBase };
}

/** Build the config from an injected environment map. */
export function loadConfig(env: Record<string, string | undefined>, defaults: { tempRoot: string; workerEntry: string }): EngineServiceConfig {
  const serviceToken = secret(env, "OFFICE_ENGINE_SERVICE_TOKEN");
  const grantKey = secret(env, "OFFICE_ENGINE_GRANT_KEY");
  if (serviceToken === grantKey) {
    throw new ConfigError("OFFICE_ENGINE_GRANT_KEY must differ from OFFICE_ENGINE_SERVICE_TOKEN");
  }
  const maxWorkers = positiveInt(env, "OFFICE_ENGINE_MAX_WORKERS", 2, 64);
  return {
    host: env.OFFICE_ENGINE_HOST ?? "0.0.0.0",
    port: positiveInt(env, "OFFICE_ENGINE_PORT", 8090, 65535),
    serviceToken,
    grantKey,
    outputOrigins: origins(env.OFFICE_ENGINE_OUTPUT_ORIGINS),
    maxWorkers,
    maxQueue: positiveInt(env, "OFFICE_ENGINE_MAX_QUEUE", 16, 4096),
    limits: {
      maxJobMs: positiveInt(env, "OFFICE_ENGINE_MAX_JOB_MS", PROVISIONAL_LIMITS.maxJobMs, ENGINE_LIMITS.max_deadline_ms),
      cpuMs: positiveInt(env, "OFFICE_ENGINE_CPU_MS", PROVISIONAL_LIMITS.cpuMs, ENGINE_LIMITS.max_deadline_ms),
      memoryBytes: positiveInt(env, "OFFICE_ENGINE_MEMORY_MB", PROVISIONAL_LIMITS.memoryBytes / MiB, 16384) * MiB,
      tempBytes: positiveInt(env, "OFFICE_ENGINE_TEMP_MB", PROVISIONAL_LIMITS.tempBytes / MiB, 65536) * MiB,
      maxInputBytes: positiveInt(env, "OFFICE_ENGINE_MAX_INPUT_BYTES", PROVISIONAL_LIMITS.maxInputBytes, ENGINE_LIMITS.max_input_bytes),
      maxOutputBytes: positiveInt(env, "OFFICE_ENGINE_MAX_OUTPUT_BYTES", PROVISIONAL_LIMITS.maxOutputBytes, ENGINE_LIMITS.max_output_bytes),
    },
    tempRoot: env.OFFICE_ENGINE_TEMP_DIR || defaults.tempRoot,
    workerEntry: defaults.workerEntry,
    sampleMs: positiveInt(env, "OFFICE_ENGINE_SAMPLE_MS", 100, 10_000),
    terminalRetentionMs: positiveInt(env, "OFFICE_ENGINE_RETENTION_MS", 15 * 60_000, 24 * 3_600_000),
    maxRetainedJobs: positiveInt(env, "OFFICE_ENGINE_MAX_RETAINED_JOBS", 1024, 100_000),
    faultOperations: env.OFFICE_ENGINE_FAULT_OPERATIONS === "1",
    shutdownGraceMs: positiveInt(env, "OFFICE_ENGINE_SHUTDOWN_GRACE_MS", 10_000, 120_000),
    sandbox: sandboxConfig(env, maxWorkers),
    ...(env.UNIWORK_XLSX_ASSETS ? { xlsxAssetsDir: env.UNIWORK_XLSX_ASSETS } : {}),
  };
}
