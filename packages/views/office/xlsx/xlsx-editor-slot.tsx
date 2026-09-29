"use client";

import type { OfficeEditorLoader, OfficeEditorRendererProps } from "../editor-slot";
import { XlsxEditor } from "./xlsx-editor";
import { XlsxErrorState } from "./xlsx-error-state";
import type {
  XlsxCapability,
  XlsxEditorHandle,
  XlsxEditorPermissions,
  XlsxOpenPort,
  XlsxSaveCoordinator,
  XlsxOpenFailure,
} from "./types";

export interface XlsxEditorSlotConfig {
  documentKey: string;
  open: XlsxOpenPort;
  coordinator: XlsxSaveCoordinator;
  capability?: XlsxCapability;
  permissions?: XlsxEditorPermissions;
  title?: string;
  onOpen?: (outcome: import("./types").XlsxOpenOutcome) => void;
}

function missingHandleFailure(documentKey: string): XlsxOpenFailure {
  return {
    outcome: "failed",
    document_id: documentKey,
    format: "xlsx",
    failure_class: "engine_error",
  };
}

/**
 * Binds the format view to the shared G3-03 editor slot. The loader captures
 * only host-owned open/coordinator dependencies; the slot still controls
 * capability gating, lazy loading, and the no-empty-editor boundary.
 */
export function createXlsxEditorLoader(config: XlsxEditorSlotConfig): OfficeEditorLoader {
  return async (format) => {
    if (format !== "xlsx") throw new Error(`XLSX loader cannot render ${format}`);
    return {
      default: ({ editorHandle }: OfficeEditorRendererProps) => {
        if (!editorHandle) return <XlsxErrorState failure={missingHandleFailure(config.documentKey)} />;
        return (
          <XlsxEditor
            documentKey={config.documentKey}
            editor={editorHandle as XlsxEditorHandle}
            open={config.open}
            coordinator={config.coordinator}
            capability={config.capability}
            permissions={config.permissions}
            title={config.title}
            onOpen={config.onOpen}
          />
        );
      },
    };
  };
}
