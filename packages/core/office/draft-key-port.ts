import { z } from "zod";
import type { DraftBase, DraftIdentity, DraftSession } from "./draft-recovery";

/**
 * The auth-owned seam used to obtain a browser-wrappable data-key envelope.
 *
 * The server endpoint is intentionally not implemented by the Office host.
 * Consumers receive an unknown response and validate it at this boundary so a
 * malformed or stale response can never be treated as a successful unlock.
 */
export interface DraftKeyUnwrapRequest {
  readonly session: DraftSession;
  readonly identity: DraftIdentity;
  readonly draftId: string;
  readonly generation: number;
  readonly checksum: string;
}

export type DraftKeyUnwrapResponse =
  | { readonly status: "unwrapped"; readonly wrappedKey: Uint8Array }
  | { readonly status: "blocked"; readonly reason: "edit_acl_missing" }
  | {
      readonly status: "conflict";
      readonly currentBase: DraftBase;
      readonly draftBase: DraftBase;
    }
  | { readonly status: "locked"; readonly code: "draft_recovery_locked" };

/** JSON-safe response accepted from an auth endpoint or test fake. */
export const draftKeyUnwrapResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("unwrapped"),
    wrappedKey: z.union([
      z.string().min(1),
      z.instanceof(Uint8Array).refine((value) => value.byteLength > 0),
    ]),
  }),
  z.object({ status: z.literal("blocked"), reason: z.literal("edit_acl_missing") }),
  z.object({
    status: z.literal("conflict"),
    currentBase: z.object({ revision: z.string().min(1), version: z.string().min(1) }),
    draftBase: z.object({ revision: z.string().min(1), version: z.string().min(1) }),
  }),
  z.object({ status: z.literal("locked"), code: z.literal("draft_recovery_locked") }),
]);

export const draftKeyUnwrapRequestSchema = z.object({
  sessionId: z.string().min(1),
  sessionGeneration: z.number().int().positive(),
  deploymentId: z.string().min(1),
  accountId: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  documentId: z.string().min(1),
  baseRevision: z.string().min(1),
  baseVersion: z.string().min(1),
  draftId: z.string().min(1),
  generation: z.number().int().positive(),
  checksum: z.string().min(1),
});

export type DraftKeyUnwrapResponseWire = z.input<typeof draftKeyUnwrapResponseSchema>;

export interface DraftKeyUnwrapPort {
  unwrap(request: DraftKeyUnwrapRequest): Promise<unknown>;
}

/** A deterministic fake for contract tests and browser-host unit tests. */
export interface FakeDraftKeyUnwrapPort extends DraftKeyUnwrapPort {
  readonly requests: readonly DraftKeyUnwrapRequest[];
  setResponse(response: unknown): void;
}

export function createFakeDraftKeyUnwrapPort(
  initialResponse: unknown = { status: "locked", code: "draft_recovery_locked" },
): FakeDraftKeyUnwrapPort {
  let response = initialResponse;
  const requests: DraftKeyUnwrapRequest[] = [];
  return {
    get requests() {
      return requests.slice();
    },
    setResponse(next) {
      response = next;
    },
    async unwrap(request) {
      requests.push(request);
      return response;
    },
  };
}

export function draftKeyUnwrapRequestToWire(request: DraftKeyUnwrapRequest): z.input<typeof draftKeyUnwrapRequestSchema> {
  return {
    sessionId: request.session.sessionId,
    sessionGeneration: request.session.generation,
    deploymentId: request.identity.deploymentId,
    accountId: request.identity.accountId,
    organizationId: request.identity.organizationId,
    workspaceId: request.identity.workspaceId,
    documentId: request.identity.documentId,
    baseRevision: request.identity.base.revision,
    baseVersion: request.identity.base.version,
    draftId: request.draftId,
    generation: request.generation,
    checksum: request.checksum,
  };
}
