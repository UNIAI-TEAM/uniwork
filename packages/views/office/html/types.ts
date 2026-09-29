import type { TextCapability, TextEditorHandle, TextOpenFailure, TextOpenSuccess, TextSaveCoordinator, IsolatedPreviewPort } from "../source-editor-types";
import type { AssetManifestLike, AssetStatus } from "../asset-manifest";

export type HtmlEditorHandle<TSnapshot = unknown> = TextEditorHandle<TSnapshot>;
export type HtmlOpenOutcome = TextOpenSuccess | (TextOpenFailure & { format: "html" });
export type HtmlCapability = TextCapability & { format: "html" };
export type HtmlSaveCoordinator = TextSaveCoordinator;

export interface HtmlEditorProps<TSnapshot = unknown> {
  documentKey: string;
  editor: HtmlEditorHandle<TSnapshot>;
  open: { open(signal?: AbortSignal): Promise<HtmlOpenOutcome> };
  coordinator: HtmlSaveCoordinator;
  capability?: HtmlCapability;
  preview?: IsolatedPreviewPort;
  manifest?: AssetManifestLike | null;
  assetFailures?: Readonly<Record<string, AssetStatus | boolean>>;
  title?: string;
  className?: string;
  onOpen?: (outcome: HtmlOpenOutcome) => void;
}
