import type { TextCapability, TextEditorHandle, TextOpenFailure, TextOpenSuccess, TextSaveCoordinator, IsolatedPreviewPort } from "../source-editor-types";
import type { AssetManifestLike, AssetStatus } from "../asset-manifest";
import type { MarkdownPrintPort } from "../markdown/wysiwyg/print";

export type HtmlEditorHandle<TSnapshot = unknown> = TextEditorHandle<TSnapshot>;
export type HtmlOpenOutcome = TextOpenSuccess | (TextOpenFailure & { format: "html" });
export type HtmlCapability = TextCapability & { format: "html" };
export type HtmlSaveCoordinator = TextSaveCoordinator;
export type HtmlOpenPort = import("../source-editor-types").TextOpenPort;

export interface HtmlEditorProps<TSnapshot = unknown> {
  documentKey: string;
  editor: HtmlEditorHandle<TSnapshot>;
  open: { open(signal?: AbortSignal): Promise<HtmlOpenOutcome> };
  coordinator: HtmlSaveCoordinator;
  capability?: HtmlCapability;
  preview?: IsolatedPreviewPort;
  manifest?: AssetManifestLike | null;
  assetFailures?: Readonly<Record<string, AssetStatus | boolean>>;
  permissions?: import("../source-editor-types").TextEditorPermissions;
  /** The host print path. When absent the surface offers no Print entry at
   * all, so the web host and its tests are unchanged; a host that injects
   * one gets the same sanitized-copy entry the Markdown surface has. */
  printPort?: MarkdownPrintPort;
  title?: string;
  className?: string;
  onOpen?: (outcome: HtmlOpenOutcome) => void;
}
