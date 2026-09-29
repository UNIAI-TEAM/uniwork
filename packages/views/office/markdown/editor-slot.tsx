"use client";

import { useTranslation } from "react-i18next";
import type { OfficeEditorLoader, OfficeEditorRendererProps } from "../editor-slot";
import { SourceEditor } from "../source-editor";
import type { AssetManifestLike, AssetStatus } from "../asset-manifest";
import type { IsolatedPreviewPort } from "../source-editor-types";
import type { MarkdownCapability, MarkdownEditorHandle, MarkdownOpenOutcome, MarkdownOpenPort, MarkdownSaveCoordinator } from "./types";

export interface MarkdownEditorSlotConfig {
  documentKey: string;
  open: MarkdownOpenPort;
  coordinator: MarkdownSaveCoordinator;
  capability?: MarkdownCapability;
  preview?: IsolatedPreviewPort;
  manifest?: AssetManifestLike | null;
  assetFailures?: Readonly<Record<string, AssetStatus | boolean>>;
  permissions?: import("../source-editor-types").TextEditorPermissions;
  title?: string;
  onOpen?: (outcome: MarkdownOpenOutcome) => void;
}

function MissingHandleState() {
  const { t } = useTranslation(undefined, { keyPrefix: "office.markdown" });
  return <p className="p-3 text-body text-destructive" role="alert">{t("errors.unknown")}</p>;
}

/** Bind the Markdown source view to the shared EditorSlot lifecycle. */
export function createMarkdownEditorLoader(config: MarkdownEditorSlotConfig): OfficeEditorLoader {
  return async (format) => {
    if (format !== "md") throw new Error(`Markdown loader cannot render ${format}`);
    return {
      default: ({ editorHandle }: OfficeEditorRendererProps) => {
        if (!editorHandle) return <MissingHandleState />;
        return (
          <SourceEditor
            format="md"
            documentKey={config.documentKey}
            editor={editorHandle as MarkdownEditorHandle}
            open={config.open}
            coordinator={config.coordinator}
            capability={config.capability}
            preview={config.preview}
            manifest={config.manifest}
            assetFailures={config.assetFailures}
            permissions={config.permissions}
            title={config.title ?? "Markdown"}
            onOpen={config.onOpen}
          />
        );
      },
    };
  };
}
