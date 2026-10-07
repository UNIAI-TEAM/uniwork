import type { OfficeEngine } from "@uniwork/office-engine";
import {
  officeFormatSchema,
  type CapabilityEntry,
  type EngineOperation,
  type OfficeFormat,
  type OfficeHostAdapter,
  toProductCapability,
} from "@uniwork/office-contracts";
import { z } from "zod";

export const OFFICE_HOST_CONTRACT_VERSION = "office-editor-host/1";

export const decimalRevisionSchema = z.string().regex(/^\d+$/);

export const officeIdentitySchema = z.object({
  deploymentId: z.string().min(1),
  accountId: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  documentId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  baseVersionId: z.string().min(1),
  baseRevision: decimalRevisionSchema,
});
export type OfficeIdentity = z.infer<typeof officeIdentitySchema>;

export const stableSnapshotSchema = z.object({
  generation: z.number().int().nonnegative(),
  fingerprint: z.string().min(1),
  value: z.unknown(),
  checksumSha256: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type StableSnapshot<TSnapshot = unknown> = Omit<z.infer<typeof stableSnapshotSchema>, "value"> & {
  value: TSnapshot;
};

export interface EditorHandle<TSnapshot = unknown> {
  format: OfficeFormat;
  open(): Promise<void>;
  getDirtyGeneration(): number;
  captureSnapshot(): Promise<StableSnapshot<TSnapshot>>;
  undo?(): void;
  redo?(): void;
  /** Whether undo/redo has a step to take right now. A view keeps its
   *  Undo/Redo control aria-disabled while this is false; a handle without
   *  it is treated as always able to step. */
  canUndo?(): boolean;
  canRedo?(): boolean;
  /** A Save committed these bytes: the editor rebases whatever its next
   *  serialization derives from them (DOCX core properties). */
  rebaseSaveSource?(receipt: OfficeSaveReceipt): void | Promise<void>;
  dispose(): void | Promise<void>;
}

export type OfficeHost = OfficeHostAdapter;
export type OfficeEnginePort = Pick<OfficeEngine, "submit" | "fingerprint">;
export type OfficeEngineOperation = EngineOperation;

export const officeCapabilityStatusSchema = z.enum(["available", "readonly", "unavailable", "unknown"]);
export type OfficeCapabilityStatus = z.infer<typeof officeCapabilityStatusSchema>;

export const officeCapabilityEntrySchema = z.object({
  format: officeFormatSchema,
  operation: z.string().min(1),
  host: z.string().min(1),
  engineBuild: z.string().min(1),
  contractRevision: z.string().min(1),
  status: officeCapabilityStatusSchema.catch("unknown"),
  reason: z.string().nullable().optional(),
  fidelityWarnings: z.array(z.string()).optional().default([]),
});
export type OfficeCapabilityEntry = z.infer<typeof officeCapabilityEntrySchema>;

export function toOfficeCapabilityEntry(
  format: OfficeFormat,
  entry: CapabilityEntry,
  metadata: Pick<OfficeCapabilityEntry, "host" | "engineBuild" | "contractRevision">,
): OfficeCapabilityEntry {
  const productEntry = toProductCapability(entry);
  const status: OfficeCapabilityStatus = productEntry.supported
    ? "available"
    : productEntry.operation === "open" || productEntry.operation === "serialize"
      ? "readonly"
      : "unavailable";
  return officeCapabilityEntrySchema.parse({
    format,
    operation: productEntry.operation,
    host: metadata.host,
    engineBuild: metadata.engineBuild,
    contractRevision: metadata.contractRevision,
    status,
    reason: productEntry.reason ?? null,
    fidelityWarnings: [],
  });
}

export const officeSaveIntentSchema = z.object({
  intentId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  identity: officeIdentitySchema,
  snapshotGeneration: z.number().int().nonnegative(),
  snapshotFingerprint: z.string().min(1),
  snapshot: z.unknown(),
  operation: z.literal("manual_save"),
  createdAt: z.number().finite(),
});
export type OfficeSaveIntent<TSnapshot = unknown> = Omit<z.infer<typeof officeSaveIntentSchema>, "snapshot"> & {
  snapshot: TSnapshot;
};

export const officeSerializedOutputSchema = z.object({
  data: z.unknown(),
  checksumSha256: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  format: officeFormatSchema,
});
export type OfficeSerializedOutput = z.infer<typeof officeSerializedOutputSchema>;

export const officeUploadReceiptSchema = z.object({
  uploadId: z.string().min(1),
  checksumSha256: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  claimExpiresAt: z.string().min(1),
});
export type OfficeUploadReceipt = z.infer<typeof officeUploadReceiptSchema>;

export const officeSaveReceiptSchema = z.object({
  intentId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  documentId: z.string().min(1),
  versionId: z.string().min(1),
  revision: decimalRevisionSchema,
  checksumSha256: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  engineName: z.string().min(1),
  engineVersion: z.string().min(1),
  contractVersion: z.string().min(1),
  protocolVersion: z.string().min(1),
});
export type OfficeSaveReceipt = z.infer<typeof officeSaveReceiptSchema>;

export interface DraftAdapter<TSnapshot = unknown> {
  checkpoint(snapshot: StableSnapshot<TSnapshot>): Promise<void>;
  recover(identity: OfficeIdentity): Promise<StableSnapshot<TSnapshot> | null>;
  /** Remove the durable draft consumed by an explicit discard or confirmed
   * commit. When supplied, `generation` scopes cleanup to that exact
   * snapshot so a newer N+1 draft cannot be deleted by Save N. */
  discard(identity: OfficeIdentity, generation?: number): Promise<void>;
  persistIntent(intent: OfficeSaveIntent<TSnapshot>): Promise<void>;
  loadIntent(identity: OfficeIdentity): Promise<OfficeSaveIntent<TSnapshot> | null>;
  clearIntent(intentId: string): Promise<void>;
}

export interface OfficeSaveTransport<TSnapshot = unknown> {
  serialize(input: {
    intent: OfficeSaveIntent<TSnapshot>;
    snapshot: StableSnapshot<TSnapshot>;
  }): Promise<unknown>;
  upload(input: {
    intent: OfficeSaveIntent<TSnapshot>;
    output: OfficeSerializedOutput;
  }): Promise<unknown>;
  commit(input: {
    intent: OfficeSaveIntent<TSnapshot>;
    upload: OfficeUploadReceipt;
  }): Promise<unknown>;
  reconcile(input: {
    intent: OfficeSaveIntent<TSnapshot>;
  }): Promise<unknown>;
  cancel?(input: { intent: OfficeSaveIntent<TSnapshot> }): Promise<void>;
  /** The intent is proven not to have committed this document (a refusal
   *  before or at commit, a conflict, a blocked refusal, or a reconcile that
   *  proved no commit). A transport that holds per-intent state drops it here;
   *  a blocked intent stays pending, and its Retry starts a fresh intent. Never
   *  called while the outcome may be a landed write (an ambiguous failure, or a
   *  commit-step throw that is not a refusal). */
  release?(input: { intent: OfficeSaveIntent<TSnapshot> }): Promise<void>;
}
