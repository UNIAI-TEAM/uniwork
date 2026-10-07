import type { TextCapability, TextEditorHandle, TextOpenFailure, TextOpenSuccess, TextSaveCoordinator, IsolatedPreviewPort } from "../source-editor-types";
import type { AssetManifestLike, AssetStatus } from "../asset-manifest";
import type { MarkdownPrintPort } from "../markdown/wysiwyg/print";
import type { HtmlVisualEditHost } from "./visual/use-visual-edit";

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
  /** The host print path (desktop injects its own). When absent the surface
   * prints through the shared browser port, like the Markdown surface. */
  printPort?: MarkdownPrintPort;
  /**
   * The visual editor host (browser parse map + engine `applyPatchSet`). With
   * none, or with the `office_html_visual_edit` flag off, the editor is exactly
   * the source / split / preview / present surface: no inspector mount, no
   * float toolbar, no style panel. Desktop injects none today.
   */
  visualEdit?: HtmlVisualEditHost;
  title?: string;
  className?: string;
  onOpen?: (outcome: HtmlOpenOutcome) => void;
}
