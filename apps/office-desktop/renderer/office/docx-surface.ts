import { bindDocxEngine, createDocxAdapter } from "@uniwork/office-engine/docx";
import { parseDocx, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { createDocxTiptapHandle, type DocxEditorHandle, type DocxOpenSuccess } from "@uniwork/views/office/docx";
import type { StableSnapshot } from "@uniwork/core/office";

export const DOCX_DESKTOP_ENGINE_BUILD = "09485f884dc845cf3bf27fb7edfe489f9d457aad";

export type DesktopDocxSurface = DocxEditorHandle<Uint8Array> & {
  openOutcome(): DocxOpenSuccess | null;
};

/** Keep the accepted byte transport/draft envelope while sharing the web's
 * concrete editor and serializer. Serialization uses an immutable TipTap
 * snapshot, so typing N+1 never changes Save N or clears its undo history. */
export function createDesktopDocxSurface(options: {
  documentId: string;
  readBytes(): Promise<Uint8Array>;
  generation?: number;
  readOnly?: boolean;
}): DesktopDocxSurface {
  const tiptap = createDocxTiptapHandle({
    adapter: createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) }),
    documentId: options.documentId,
    readBytes: options.readBytes,
    readOnly: options.readOnly,
  });
  const offset = options.generation ?? 0;
  let cached: { generation: number; fingerprint: string; result: Promise<StableSnapshot<Uint8Array>> } | null = null;
  let disposed = false;
  return {
    format: "docx",
    open: () => tiptap.open(),
    openOutcome: () => tiptap.openOutcome(),
    getDirtyGeneration: () => offset + tiptap.getDirtyGeneration(),
    subscribeDirty: (listener) => tiptap.subscribeDirty!((generation) => listener(offset + generation)),
    selection: tiptap.selection,
    commands: tiptap.commands,
    undo: () => tiptap.undo?.(),
    redo: () => tiptap.redo?.(),
    renderSurface: () => tiptap.renderSurface?.(),
    async captureSnapshot() {
      if (disposed) throw new Error("docx_editor_disposed");
      const snapshot = await tiptap.captureSnapshot();
      if (disposed) throw new Error("docx_editor_disposed");
      if (!cached || cached.fingerprint !== snapshot.fingerprint || cached.generation !== snapshot.generation) {
        const result = tiptap.serializeSnapshot(snapshot).then((output) => ({
          generation: offset + snapshot.generation,
          fingerprint: output.checksum,
          checksumSha256: output.checksum.startsWith("sha256:") ? output.checksum : `sha256:${output.checksum}`,
          sizeBytes: output.bytes.length,
          value: output.bytes,
        }));
        cached = { generation: snapshot.generation, fingerprint: snapshot.fingerprint, result };
        // A failed engine operation can be retried against the same snapshot.
        void result.catch(() => { if (cached?.result === result) cached = null; });
      }
      const result = await cached.result;
      if (disposed) throw new Error("docx_editor_disposed");
      return { ...result, value: result.value.slice() };
    },
    async dispose() {
      disposed = true;
      cached = null;
      await tiptap.dispose();
    },
  };
}
