import { createHash } from "node:crypto";
import type { DesktopDocxSurface } from "../renderer/office/docx-surface";

/** Transport tests isolate IPC from parsing; real DOCX integration is covered
 * by docx-surface.test.tsx and docx-surface.unit.test.tsx. */
export async function createByteTestEditor(options: { documentId: string; readBytes(): Promise<Uint8Array>; generation: number }): Promise<DesktopDocxSurface> {
  const value = await options.readBytes();
  const checksum = `sha256:${createHash("sha256").update(value).digest("hex")}`;
  return {
    format: "docx", open: async () => undefined,
    openOutcome: () => ({ outcome: "opened", document_id: options.documentId, document_model_ref: options.documentId, warnings: [] }),
    getDirtyGeneration: () => options.generation,
    captureSnapshot: async () => ({ value: value.slice(), generation: options.generation, fingerprint: checksum, checksumSha256: checksum, sizeBytes: value.length }),
    renderSurface: () => null, dispose: async () => undefined,
  };
}
