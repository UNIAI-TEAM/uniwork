import type { OfficeEngineTransport } from "../src/shared/types";
import type { EngineOperation } from "@uniwork/office-contracts";

// Test-only fake transport. It is used ONLY by unit tests in this package -
// production adapters route through the real browser/node/desktop transports.
// The fake answers contract-shaped results so the facade's validation and
// projection can be exercised without an engine.

export interface FakeTransportOptions {
  boundOperations?: readonly EngineOperation[];
  /** Per-operation canned results; defaults answer valid contract shapes. */
  results?: Partial<Record<EngineOperation, Record<string, unknown>>>;
  /** Capture submitted envelopes for assertions. */
  submitted?: Record<string, unknown>[];
}

const DEFAULT_RESULTS: Record<string, Record<string, unknown>> = {
  capability: {
    job_id: "JOB0000000000000000000CAP",
    state: "completed",
    operation: "capability",
    format: "docx",
    capabilities: [
      { operation: "open", supported: true, runtime: "worker", evidence_level: "proven" },
      { operation: "serialize", supported: true, runtime: "worker", evidence_level: "pending" },
    ],
    limits: { max_input_bytes: 67108864, max_edit_ops: 20000 },
  },
  open: {
    job_id: "JOB0000000000000000000OPN",
    state: "completed",
    operation: "open",
    document_model_ref: "engine-session:JOB0000000000000000000OPN",
    document_model_kind: "docx-blocks",
    warnings: [],
  },
  serialize: {
    job_id: "JOB0000000000000000000SER",
    state: "completed",
    operation: "serialize",
    output_object_key: "office/jobs/JOB0000000000000000000SER/docx.out",
    output_checksum: "a".repeat(64),
    output_length: 16,
    warnings: [],
  },
};

export function createFakeEngineTransport(options: FakeTransportOptions = {}): OfficeEngineTransport {
  const bound = new Set<EngineOperation>(options.boundOperations ?? ["capability", "open", "edit", "serialize", "cancel"]);
  const submitted = options.submitted ?? [];
  return {
    supports: (operation) => bound.has(operation),
    async submit(envelope) {
      submitted.push(envelope);
      const op = envelope.operation as string;
      const canned = options.results?.[op as EngineOperation] ?? DEFAULT_RESULTS[op];
      if (!canned) {
        return {
          state: "failed",
          error: {
            code: "unsupported_operation",
            status: 501,
            error_class: "incompatible",
            kind: "unsupported_operation",
            retryable: false,
            fidelity_preserved: true,
          },
        };
      }
      return structuredClone(canned);
    },
    async cancel(jobId) {
      return { job_id: jobId, previous_state: "running", state: "cancelled" };
    },
  };
}
