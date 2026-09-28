// Messages between the supervisor (service process) and one worker process.
// The worker side imports only node: builtins and sibling .ts files so Node 22
// can run it with type stripping, and so the worker never loads the service's
// secrets, grant code or HTTP stack.

export interface RunMessage {
  type: "run";
  operation: string;
  format: string;
  /** Inside the job's private temp dir; names chosen by the service, never by a user. */
  inputPath: string | null;
  outputPath: string;
  /** Validated operation payload (edits[]) serialized by the service into the
      job dir; null for ops that carry none. Names are service-chosen. */
  payloadPath: string | null;
  tempDir: string;
  sampleMs: number;
  /** V8 old-generation cap for the handler thread, in MiB. */
  heapMb: number;
  faults: boolean;
}

interface UsageMessage {
  type: "usage";
  rssBytes: number;
  cpuMs: number;
}

interface DoneMessage {
  type: "done";
  warnings: { code: string; detail?: string }[];
}

interface FailMessage {
  type: "fail";
  /** An ENGINE_ERROR_CODES code; the service re-checks it against the table. */
  code: string;
  reason: string;
}

export type WorkerMessage = UsageMessage | DoneMessage | FailMessage;

/** Handler-thread result posted to the worker's main thread. */
export type HandlerOutcome =
  | { ok: true; warnings: { code: string; detail?: string }[] }
  | { ok: false; code: string; reason: string };
