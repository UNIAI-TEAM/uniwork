import { createOfficeSaveCoordinator } from "@uniwork/core/office/save-coordinator";
import type { DraftAdapter, EditorHandle, OfficeIdentity, OfficeSaveIntent, OfficeSaveTransport, StableSnapshot } from "@uniwork/core/office";
import { desktopFileResponseSchema, desktopOfficeSaveResponseSchema } from "../../shared/ipc";
import type { LibraryBridge } from "../library/model";

export type OpenedBytes = { dataBase64: string; checksum: string; localHandle?: string; canSave?: boolean };

/** Byte-preserving adapter until G3 supplies a content editing surface. */
export function createByteDocumentSession(bridge: LibraryBridge, identity: OfficeIdentity, opened: OpenedBytes) {
  let generation = 0;
  let bytes = Uint8Array.from(atob(opened.dataBase64), (character) => character.charCodeAt(0));
  let checkpoint: StableSnapshot<Uint8Array> | null = null;
  let pendingIntent: OfficeSaveIntent<Uint8Array> | null = null;
  const editor: EditorHandle<Uint8Array> = {
    format: "docx", open: async () => undefined,
    getDirtyGeneration: () => generation,
    captureSnapshot: async () => ({ generation, fingerprint: opened.checksum, checksumSha256: opened.checksum, sizeBytes: bytes.length, value: bytes.slice() }),
    dispose: () => { bytes = new Uint8Array(); checkpoint = null; pendingIntent = null; },
  };
  // Cloud intent memory is session-scoped. Local disk checkpoints are encrypted
  // by main before file-save; G4-04 owns the broader recovery UI.
  const draft: DraftAdapter<Uint8Array> = {
    checkpoint: async (snapshot) => { checkpoint = snapshot; }, recover: async () => checkpoint,
    discard: async () => { checkpoint = null; }, persistIntent: async (intent) => { pendingIntent = intent; },
    loadIntent: async () => pendingIntent, clearIntent: async () => { pendingIntent = null; },
  };
  const outputs = new Map<string, { dataBase64: string; sizeBytes: number; checksum: string }>();
  const transport: OfficeSaveTransport<Uint8Array> = {
    serialize: async ({ intent, snapshot }) => {
      let binary = "";
      for (let offset = 0; offset < snapshot.value.length; offset += 0x8000) binary += String.fromCharCode(...snapshot.value.subarray(offset, offset + 0x8000));
      outputs.set(intent.intentId, { dataBase64: btoa(binary), sizeBytes: snapshot.value.length, checksum: opened.checksum });
      return { data: snapshot.value, sizeBytes: snapshot.value.length, checksumSha256: opened.checksum, format: "docx" };
    },
    upload: async ({ intent, output }) => ({ uploadId: intent.intentId, sizeBytes: output.sizeBytes, checksumSha256: output.checksumSha256, claimExpiresAt: new Date(Date.now() + 60_000).toISOString() }),
    commit: async ({ intent }) => {
      const output = outputs.get(intent.intentId);
      if (!output) throw new Error("snapshot_missing");
      let versionId: string, revision: string, checksum: string;
      if (opened.localHandle) {
        const result = desktopFileResponseSchema.parse(await bridge.call("desktop:file-save", { sessionGeneration: "desktop-dev-session", handle: opened.localHandle, dataBase64: output.dataBase64 }));
        if (!result.opened || !result.metadata) throw new Error("save_unconfirmed");
        versionId = result.metadata.checksum; revision = (BigInt(intent.identity.baseRevision) + 1n).toString(); checksum = result.metadata.checksum;
      } else {
        const result = desktopOfficeSaveResponseSchema.parse(await bridge.call("desktop:office-save", { sessionGeneration: "desktop-dev-session", workspaceId: identity.workspaceId, documentId: identity.documentId, intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, baseVersionId: intent.identity.baseVersionId, baseRevision: intent.identity.baseRevision, dataBase64: output.dataBase64, checksum: output.checksum }));
        versionId = result.versionId; revision = result.revision; checksum = result.checksum;
      }
      outputs.delete(intent.intentId);
      return { intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, documentId: identity.documentId, versionId, revision, checksumSha256: checksum, sizeBytes: output.sizeBytes, engineName: "docx", engineVersion: "byte-preserving", contractVersion: "office-editor-host/1", protocolVersion: "1" };
    },
    reconcile: async () => null,
  };
  const coordinator = createOfficeSaveCoordinator({ identity, editor, draft, transport });
  if (opened.canSave === false) coordinator.setCapability({ format: "docx", operation: "serialize", host: "desktop", engineBuild: "byte-preserving", contractRevision: "office-editor-host/1", status: "readonly", fidelityWarnings: [] });
  return { editor, coordinator: { ...coordinator, save: async (entryPoint?: Parameters<typeof coordinator.save>[0]) => {
    // Explicit Save may write the opened bytes even before a content edit exists.
    // Never mark dirty during an in-flight Save: the shared coordinator rejects it.
    const state = coordinator.getState();
    if (state.state === "ready" || state.state === "saved") { generation += 1; coordinator.markDirty(generation); }
    return coordinator.save(entryPoint);
  } } };
}
