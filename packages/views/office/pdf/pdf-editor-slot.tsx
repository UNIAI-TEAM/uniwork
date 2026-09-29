"use client";

import type { OfficeEditorLoader, OfficeEditorRendererProps } from "../editor-slot";
import { PdfEditor } from "./pdf-editor";
import { PdfErrorState } from "./pdf-error-state";
import type { PdfCapability, PdfEditorHandle, PdfOpenFailure, PdfOpenPort, PdfOpenOutcome, PdfSaveCoordinator } from "./types";

export interface PdfEditorSlotConfig {
  documentKey: string;
  open: PdfOpenPort;
  coordinator: PdfSaveCoordinator;
  capability?: PdfCapability;
  title?: string;
  onOpen?: (outcome: PdfOpenOutcome) => void;
}

function missingHandleFailure(documentKey: string): PdfOpenFailure {
  return { outcome: "failed", document_id: documentKey, format: "pdf", failure_class: "engine_error" };
}

export function createPdfEditorLoader(config: PdfEditorSlotConfig): OfficeEditorLoader {
  return async (format) => {
    if (format !== "pdf") throw new Error(`PDF loader cannot render ${format}`);
    return {
      default: ({ editorHandle }: OfficeEditorRendererProps) => {
        if (!editorHandle) return <PdfErrorState failure={missingHandleFailure(config.documentKey)} />;
        return <PdfEditor documentKey={config.documentKey} editor={editorHandle as PdfEditorHandle} open={config.open} coordinator={config.coordinator} capability={config.capability} title={config.title} onOpen={config.onOpen} />;
      },
    };
  };
}
