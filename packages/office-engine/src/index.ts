// @uniwork/office-engine — facade. Environment-neutral like the contracts
// package: every runtime-specific transport lives in ./browser, ./node or
// ./desktop, and none of that code may be reached from this entry.

import {
  ENGINE_CONTRACT_VERSION,
  ENGINE_PROTOCOL_VERSION,
  EngineBoundaryError,
  HostCapabilityRefusal,
  capabilityResultSchema,
  cancelResultSchema,
  editResultSchema,
  errorEnvelopeSchema,
  openResultSchema,
  payloadFingerprint,
  serializeResultSchema,
  toProductCapabilities,
  toPublicJobResult,
  validateEnvelope,
  type CapabilityResult,
  type EngineOperation,
  type OfficeFormat,
  type Sha256HexFn,
  sha256Hex,
} from "@uniwork/office-contracts";

import type { OfficeEngineTransport, PublicJobResult, SubmitInput } from "./shared/types";

export type { OfficeEngineTransport, PublicJobResult, SubmitInput };
// Re-export the contract surface so app code imports one package.
export * from "@uniwork/office-contracts";

export interface OfficeEngineOptions {
  transport: OfficeEngineTransport;
  /** Injectable SHA-256 for callers with a synchronous hasher (Node). Defaults
   * to WebCrypto, which keeps this facade free of node: imports. */
  hash?: Sha256HexFn;
  /** Engine build the client presents. Defaults to the G0 trusted build. */
  client_engine_version?: string;
}

export interface OfficeEngine {
  submit(input: SubmitInput): Promise<PublicJobResult>;
  capability(format: OfficeFormat): Promise<CapabilityResult>;
  cancel(jobId: string, reason?: string): Promise<Record<string, unknown>>;
  fingerprint(input: SubmitInput): Promise<string>;
}

const RESULT_SCHEMAS = {
  open: openResultSchema,
  edit: editResultSchema,
  serialize: serializeResultSchema,
  capability: capabilityResultSchema,
} as const;

/**
 * The boundary client: validate the envelope BEFORE transport, fingerprint the
 * decisive inputs, submit, then validate + project the result to the public
 * shape. A result that fails its schema or would leak is a contract bug and
 * raises, never silently passes.
 */
export function createOfficeEngine(options: OfficeEngineOptions): OfficeEngine {
  const hash = options.hash ?? sha256Hex;
  const engineVersion = options.client_engine_version;

  function buildEnvelope(input: SubmitInput): Record<string, unknown> {
    return {
      request_id: input.request_id,
      contract_version: ENGINE_CONTRACT_VERSION,
      protocol_version: ENGINE_PROTOCOL_VERSION,
      operation: input.operation,
      format: input.format,
      ...(input.deadline_ms !== undefined ? { deadline_ms: input.deadline_ms } : {}),
      ...(input.idempotency_key ? { idempotency_key: input.idempotency_key } : {}),
      ...(engineVersion ?? input.client_engine_version
        ? { client_engine_version: engineVersion ?? input.client_engine_version }
        : {}),
      ...(input.grant_id ? { grant_id: input.grant_id } : {}),
      payload: input.payload,
    };
  }

  function checkSupported(operation: EngineOperation): void {
    if (options.transport.supports && !options.transport.supports(operation)) {
      throw new HostCapabilityRefusal(
        "engine:" + operation,
        "unsupported",
        "transport does not implement " + operation,
      );
    }
  }

  function projectResult(raw: Record<string, unknown>, operation: EngineOperation): PublicJobResult {
    if (raw.state === "failed" || raw.error !== undefined) {
      const parsed = errorEnvelopeSchema.parse(raw);
      // A failed result is still a valid public answer - the error body is
      // the contract's public shape. Project to strip any authority field an
      // engine-side error might have carried.
      const pub = toPublicJobResult(parsed as unknown as Record<string, unknown>);
      throw new EngineBoundaryError(parsed.error.code, { public_result: pub });
    }
    const schema = RESULT_SCHEMAS[operation as keyof typeof RESULT_SCHEMAS];
    const parsed = schema ? schema.parse(raw) : raw;
    if (operation === "capability") {
      const cap = parsed as CapabilityResult;
      cap.capabilities = toProductCapabilities(cap.capabilities) as typeof cap.capabilities;
    }
    return toPublicJobResult(parsed) as PublicJobResult;
  }

  return {
    async submit(input) {
      const envelope = buildEnvelope(input);
      const validated = await validateEnvelope(envelope, { hash });
      void validated; // validation is the side effect: measured inputs are hashed inside
      checkSupported(input.operation);
      const raw = await options.transport.submit(envelope);
      return projectResult(raw, input.operation);
    },

    async capability(format) {
      const result = await this.submit({
        request_id: "capability-" + format,
        operation: "capability",
        format,
        payload: {},
      });
      return capabilityResultSchema.parse(result);
    },

    async cancel(jobId, reason) {
      if (!options.transport.cancel) {
        throw new HostCapabilityRefusal(
          "engine:cancel",
          "unsupported",
          "transport does not implement cancel",
        );
      }
      const raw = await options.transport.cancel(jobId, reason);
      return toPublicJobResult(cancelResultSchema.parse(raw));
    },

    async fingerprint(input) {
      const envelope = buildEnvelope(input);
      return payloadFingerprint(envelope, { hash });
    },
  };
}
