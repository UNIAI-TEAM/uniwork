import type { TextCapability, TextEditorHandle, TextOpenFailure, TextOpenSuccess, TextSaveCoordinator, IsolatedPreviewPort } from "../source-editor-types";
import type { AssetManifestLike, AssetStatus } from "../asset-manifest";
import type { MarkdownPrintPort } from "./wysiwyg/print";

export type MarkdownEditorHandle<TSnapshot = unknown> = TextEditorHandle<TSnapshot>;
export type MarkdownOpenOutcome = TextOpenSuccess | (TextOpenFailure & { format: "md" });
export type MarkdownCapability = TextCapability & { format: "md" };
export type MarkdownSaveCoordinator = TextSaveCoordinator;
export type MarkdownOpenPort = import("../source-editor-types").TextOpenPort;

export interface MarkdownEditorProps<TSnapshot = unknown> {
  documentKey: string;
  editor: MarkdownEditorHandle<TSnapshot>;
  open: { open(signal?: AbortSignal): Promise<MarkdownOpenOutcome> };
  coordinator: MarkdownSaveCoordinator;
  capability?: MarkdownCapability;
  preview?: IsolatedPreviewPort;
  manifest?: AssetManifestLike | null;
  assetFailures?: Readonly<Record<string, AssetStatus | boolean>>;
  permissions?: import("../source-editor-types").TextEditorPermissions;
  /** The host print path. Injected by a host that prints its own way
   * (the desktop renderer); absent, the surface keeps the browser port. */
  printPort?: MarkdownPrintPort;
  title?: string;
  className?: string;
  onOpen?: (outcome: MarkdownOpenOutcome) => void;
}
