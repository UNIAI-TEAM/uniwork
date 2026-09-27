import { z } from "zod";
import type { OfficeFormat } from "./formats";
import type { EngineErrorCode } from "./error-codes";
import type { OpenOutcome } from "./failure-classes";

// Host adapter contract (ADR 0021, engine-contract.md §9/§10): the host owns
// read, write, asset resolution, worker hosting and IPC transport; the engine
// owns parse/serialize/render. Engine code must never call these ports
// directly - the adapter injects them, so a browser engine build cannot reach
// Node or native facilities.
//
// Bytes cross as Uint8Array (service) or base64 strings (IPC wire); paths
// belong to the HOST side of a port and never appear in a browser-facing
// result (see scanForLeaks / toPublicJobResult).

// ---------------------------------------------------------------------------
// Typed refusal
// ---------------------------------------------------------------------------

/** Channels/capabilities a host does not implement refuse by name - never a
 * silent fallback, never a fabricated success (ADR 0021 "Test giữ luật"). */
export const hostRefusalReasons = [
  // The host has no implementation for this channel.
  "unsupported",
  // The channel exists but its backing engine feature is not bound.
  "unbound",
  // The host refused by policy (e.g. encrypted save without re-encryption).
  "policy",
  // The underlying call failed; error carries the boundary code when known.
  "failed",
] as const;
export const hostRefusalReasonSchema = z.enum(hostRefusalReasons);
export type HostRefusalReason = (typeof hostRefusalReasons)[number];

export class HostCapabilityRefusal extends Error {
  readonly channel: string;
  readonly reason: HostRefusalReason;
  readonly engine_error?: EngineErrorCode;

  constructor(channel: string, reason: HostRefusalReason, message?: string, engine_error?: EngineErrorCode) {
    super(message ?? channel + " refused: " + reason);
    this.name = "HostCapabilityRefusal";
    this.channel = channel;
    this.reason = reason;
    this.engine_error = engine_error;
  }

  toJSON() {
    return {
      kind: "host_refusal" as const,
      channel: this.channel,
      reason: this.reason,
      message: this.message,
      engine_error: this.engine_error ?? null,
    };
  }
}

// ---------------------------------------------------------------------------
// Host ports: read / write / asset-resolve / worker / IPC
// ---------------------------------------------------------------------------

/** Read port: fetch bytes the host has granted this job. `document_id` is a
 * Workspace id, NOT a filesystem path - path resolution lives behind the port
 * on the host side. */
export interface HostReadPort {
  readDocument(documentId: string): Promise<Uint8Array>;
  /** Open-through-a-path exists only on hosts that own a filesystem
   * (desktop). Browser adapters implement this as a typed refusal. */
  readPath?(path: string): Promise<Uint8Array>;
  /** Failures surface as OpenOutcome "failed" with a named class, never a
   * blank substitute (P3). */
  openDocument(documentId: string, format: OfficeFormat): Promise<OpenOutcome>;
}

/** Write port: persist output bytes. The host decides WHERE (Documents object
 * key, desktop path); the caller only supplies bytes plus the destination id. */
export interface HostWritePort {
  writeOutput(documentId: string, bytes: Uint8Array, options?: { auto?: boolean }): Promise<{ version_id?: string }>;
  /** Desktop-only: write to a host path the user chose. Browser: refusal. */
  writePath?(path: string, bytes: Uint8Array): Promise<void>;
}

/** Asset resolution: fonts, images, templates the engine references by name.
 * Resolvers return bytes or null; they never leak the resolved location. */
export interface HostAssetPort {
  resolveFont(family: string, options?: { bold?: boolean; italic?: boolean }): Promise<Uint8Array | null>;
  resolveImage(src: string): Promise<Uint8Array | null>;
  resolveAsset(name: string): Promise<Uint8Array | null>;
}

/** Worker port: run engine work off the UI thread. The host owns the worker's
 * lifetime and messaging; the contract only requires submit/cancel semantics. */
export interface HostWorkerPort {
  submit(jobId: string, envelope: Record<string, unknown>): Promise<Record<string, unknown>>;
  cancel(jobId: string): Promise<void>;
  /** Worker availability for a given runtime kind; honest pending rows are
   * legal (capability honesty), pretending is not. */
  supports(workload: "parse" | "serialize" | "render" | "convert"): boolean;
}

/** IPC port: the lab-bridge-shaped request/response + event channel set. `call`
 * is request/response; `send` is fire-and-forget; `subscribe` feeds host
 * events. Channel names and payload/result types are typed in
 * HostChannelMap. */
export interface HostIpcPort {
  call<C extends keyof HostChannelMap & string>(
    channel: C,
    body: HostChannelMap[C]["request"],
  ): Promise<HostChannelMap[C]["response"]>;
  send(channel: string, body?: unknown): void;
  subscribe(channel: string, handler: (body: unknown) => void): () => void;
}

/** The full host adapter surface. Engine functions consume these ports; the
 * engine itself is the OTHER side (OfficeEngineAdapter in office-engine). */
export interface OfficeHostAdapter {
  read: HostReadPort;
  write: HostWritePort;
  assets: HostAssetPort;
  worker?: HostWorkerPort;
  ipc: HostIpcPort;
}

// ---------------------------------------------------------------------------
// Channel map (uniwork-office-lab-bridge@1 subset under contract)
// ---------------------------------------------------------------------------

interface Channel<Req, Res> {
  request: Req;
  response: Res;
}

export const slidesEditTransformRequestSchema = z.object({
  slideIndex: z.number().int().min(0),
  sourceId: z.string().nullable().optional(),
  xPx: z.number(),
  yPx: z.number(),
  wPx: z.number(),
  hPx: z.number(),
  rotationDeg: z.number().optional(),
  fitWidthPx: z.number().nullable().optional(),
  groupId: z.string().nullable().optional(),
});
export type SlidesEditTransformRequest = z.infer<typeof slidesEditTransformRequestSchema>;

/** The updated slide the engine returns. Kept deliberately open - the slide
 * model is the renderer's, the contract only requires an object. */
export const renderSlideSchema = z.looseObject({});
export type RenderSlide = z.infer<typeof renderSlideSchema>;

/**
 * The host channels the contract owns. Every channel has a request and a
 * response type; a host that does not implement a channel answers
 * HostCapabilityRefusal, never 404-shaped silence.
 *
 * host:slides-edit-transform is the renderer-owned shape gesture (drag /
 * resize / rotate) channel added for ADR 0021: it forwards to the engine's
 * pptx-edit-transform operation and answers the updated RenderSlide.
 */
export interface HostChannelMap {
  "host:slides-edit-transform": Channel<SlidesEditTransformRequest, RenderSlide>;
  "host:slides-edit-text": Channel<
    { slideIndex: number; sourceId?: string | null; paragraphs: unknown[]; groupId?: string | null },
    RenderSlide
  >;
  "host:docs-save": Channel<
    { path?: string; dataBase64: string; auto?: boolean },
    { ok: boolean; path?: string }
  >;
  "host:pdf-save": Channel<Record<string, unknown>, { ok: boolean; path?: string }>;
  "host:text-read": Channel<{ path: string }, string>;
  "host:text-save": Channel<{ ext?: string; path?: string; content: string }, { ok: boolean }>;
  "host:image-read": Channel<{ src: string }, { base64: string }>;
  "host:image-save": Channel<Record<string, unknown>, { ok: boolean }>;
}

/** Channel names that are part of the contract (for boundary checks/tests). */
export const HOST_CONTRACT_CHANNELS = [
  "host:slides-edit-transform",
  "host:slides-edit-text",
  "host:docs-save",
  "host:pdf-save",
  "host:text-read",
  "host:text-save",
  "host:image-read",
  "host:image-save",
] as const;
export type HostContractChannel = (typeof HOST_CONTRACT_CHANNELS)[number];

// ---------------------------------------------------------------------------
// Adapter surface: what @uniwork/office-engine provides per runtime
// ---------------------------------------------------------------------------

/** Engine-side surface a runtime entry point exposes. Host adapters feed it
 * ports; it produces results in the contract's shapes. `capability` is always
 * implemented and must answer honest evidence levels; every other operation
 * may throw HostCapabilityRefusal("unsupported") rather than pretend. */
export interface OfficeEngineAdapter {
  capability(format: OfficeFormat): Promise<Record<string, unknown>>;
  open(input: {
    bytes: Uint8Array;
    format: OfficeFormat;
    document_id: string;
    locale?: string;
  }): Promise<OpenOutcome>;
  serialize(input: {
    document_model_ref: string;
    format: OfficeFormat;
  }): Promise<{ bytes: Uint8Array; checksum: string; warnings?: unknown[] }>;
}
