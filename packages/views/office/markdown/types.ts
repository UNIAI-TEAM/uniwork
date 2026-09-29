import type { TextCapability, TextEditorHandle, TextOpenFailure, TextOpenSuccess, TextSaveCoordinator, IsolatedPreviewPort } from "../source-editor-types";
import type { AssetManifestLike, AssetStatus } from "../asset-manifest";

export type MarkdownEditorHandle<TSnapshot = unknown> = TextEditorHandle<TSnapshot>;
export type MarkdownOpenOutcome = TextOpenSuccess | (TextOpenFailure & { format: "md" });
export type MarkdownCapability = TextCapability & { format: "md" };
export type MarkdownSaveCoordinator = TextSaveCoordinator;

export interface MarkdownEditorProps<TSnapshot = unknown> {
  documentKey: string;
  editor: MarkdownEditorHandle<TSnapshot>;
  open: { open(signal?: AbortSignal): Promise<MarkdownOpenOutcome> };
  coordinator: MarkdownSaveCoordinator;
  capability?: MarkdownCapability;
  preview?: IsolatedPreviewPort;
  manifest?: AssetManifestLike | null;
  assetFailures?: Readonly<Record<string, AssetStatus | boolean>>;
  title?: string;
  className?: string;
  onOpen?: (outcome: MarkdownOpenOutcome) => void;
}
