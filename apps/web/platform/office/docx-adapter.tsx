"use client";

import { createElement } from "react";
import { bindDocxEngine, createDocxAdapter } from "@uniwork/office-engine/docx";
import { parseDocx, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { createDocxTiptapHandle, DocxEditor, type DocxOpenError, type DocxOpenOutcome, type DocxTiptapSnapshot } from "@uniwork/views/office/docx";
import type { OfficeCapabilityEntry } from "@uniwork/core/office";
import { createOfficeEditorSession, type BrowserOfficeDraftOptions } from "./editor-host-core";
import { createDocxSaveTransport, type DocxDocumentsTransport } from "./docx-save-transport";

export interface DocxFormatAdapterOptions extends BrowserOfficeDraftOptions<DocxTiptapSnapshot> {
  documents: DocxDocumentsTransport;
  capability: OfficeCapabilityEntry;
  title: string;
}

export function createDocxFormatAdapter(options: DocxFormatAdapterOptions) {
  const editor = createDocxTiptapHandle({
    adapter: createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) }),
    documentId: options.identity.documentId,
    readBytes: options.documents.read,
    readOnly: options.capability.status !== "available",
  });
  const transport = createDocxSaveTransport({ documentId: options.identity.documentId, documents: options.documents, serialize: (snapshot) => editor.serializeSnapshot(snapshot) });
  const session = createOfficeEditorSession({ ...options, editor, transport });
  session.coordinator.setCapability(options.capability);
  let opening: Promise<void> | null = null;
  const open = {
    async open(signal?: AbortSignal): Promise<DocxOpenOutcome> {
      if (signal?.aborted) throw new DOMException("Open cancelled", "AbortError");
      try {
        opening ??= editor.open().catch((error: unknown) => { opening = null; throw error; });
        await opening;
        if (signal?.aborted) throw new DOMException("Open cancelled", "AbortError");
        const outcome = editor.openOutcome();
        if (!outcome) throw new Error("docx_open_outcome_missing");
        return outcome;
      } catch (error) {
        const failure = error as DocxOpenError;
        return {
          outcome: "failed", document_id: options.identity.documentId, format: "docx", failure_class: "engine_error",
          message: failure.message,
        };
      }
    },
  };
  const originalDispose = session.dispose;
  let disposal: Promise<void> | null = null;
  session.dispose = () => disposal ??= (async () => {
    await session.coordinator.cancel();
    await originalDispose();
  })();
  return {
    session, editor, open, capability: options.capability,
    editorView: createElement(DocxEditor<DocxTiptapSnapshot>, {
      documentKey: options.identity.documentId, editor, open, coordinator: session.coordinator,
      capability: options.capability, title: options.title, manageSession: false,
    }),
    async onRecoverSnapshot(snapshot: Parameters<typeof editor.restoreSnapshot>[0]) {
      await open.open();
      editor.restoreSnapshot(snapshot);
      session.coordinator.markDirty(editor.getDirtyGeneration());
    },
  };
}
