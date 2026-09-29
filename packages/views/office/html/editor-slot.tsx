"use client";

import { useTranslation } from "react-i18next";
import type { OfficeEditorLoader, OfficeEditorRendererProps } from "../editor-slot";
import { SourceEditor } from "../source-editor";
import type { AssetManifestLike, AssetStatus } from "../asset-manifest";
import type { IsolatedPreviewPort } from "../source-editor-types";
import type { HtmlCapability, HtmlEditorHandle, HtmlOpenOutcome, HtmlOpenPort, HtmlSaveCoordinator } from "./types";

export interface HtmlEditorSlotConfig {
  documentKey: string;
  open: HtmlOpenPort;
  coordinator: HtmlSaveCoordinator;
  capability?: HtmlCapability;
  preview?: IsolatedPreviewPort;
  manifest?: AssetManifestLike | null;
  assetFailures?: Readonly<Record<string, AssetStatus | boolean>>;
  permissions?: import("../source-editor-types").TextEditorPermissions;
  title?: string;
  onOpen?: (outcome: HtmlOpenOutcome) => void;
}

function MissingHandleState() {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html" });
  return <p className="p-3 text-body text-destructive" role="alert">{t("errors.unknown")}</p>;
}

/** Bind the HTML source view to the shared EditorSlot lifecycle. */
export function createHtmlEditorLoader(config: HtmlEditorSlotConfig): OfficeEditorLoader {
  return async (format) => {
    if (format !== "html") throw new Error(`HTML loader cannot render ${format}`);
    function HtmlSlotEditor({ editorHandle }: OfficeEditorRendererProps) {
      const { t } = useTranslation(undefined, { keyPrefix: "office.html" });
      if (!editorHandle) return <MissingHandleState />;
      return (
        <SourceEditor
          format="html"
          documentKey={config.documentKey}
          editor={editorHandle as HtmlEditorHandle}
          open={config.open}
          coordinator={config.coordinator}
          capability={config.capability}
          preview={config.preview}
          manifest={config.manifest}
          assetFailures={config.assetFailures}
          permissions={config.permissions}
          title={config.title ?? t("title")}
          onOpen={config.onOpen ? (outcome) => {
            if (outcome.outcome === "opened" || outcome.format === "html") config.onOpen?.(outcome as HtmlOpenOutcome);
          } : undefined}
        />
      );
    }
    return {
      default: HtmlSlotEditor,
    };
  };
}
