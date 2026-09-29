import type {
  EditorHandle,
  OfficeCapabilityEntry,
  SaveAttemptResult,
  SaveCoordinatorState,
} from "@uniwork/core/office";
import type { OpenOutcome } from "@uniwork/office-contracts";
import type { AssetManifestLike, AssetStatus } from "./asset-manifest";

export interface SourceTextPort {
  getText(): string;
  setText(text: string): void;
  subscribe?(listener: (text: string) => void): () => void;
}

export type TextEditorHandle<TSnapshot = unknown> = EditorHandle<TSnapshot> & {
  source?: SourceTextPort;
  getText?(): string;
  setText?(text: string): void;
  getAssetManifest?(): AssetManifestLike | null;
  cancel?(reason?: string): Promise<void> | void;
};

export type TextOpenSuccess = Extract<OpenOutcome, { outcome: "opened" }>;
export type TextOpenFailure = Extract<OpenOutcome, { outcome: "failed" }>;
export type TextOpenOutcome = TextOpenSuccess | TextOpenFailure;

export interface TextOpenPort {
  open(signal?: AbortSignal): Promise<TextOpenOutcome>;
}

export interface TextSaveCoordinator {
  getState(): SaveCoordinatorState;
  subscribe(listener: (state: SaveCoordinatorState) => void): () => void;
  save(entryPoint?: "button" | "menu" | "shortcut" | "dialog" | "retry"): Promise<SaveAttemptResult>;
  cancel?(): Promise<void>;
  markDirty?(generation: number): void;
  checkpoint?(): Promise<void>;
}

export interface PreviewMountOptions {
  container: HTMLElement;
  format: "md" | "html";
  title: string;
  text: string;
  manifest: AssetManifestLike;
  onEvent?(event: { type: string }): void;
}

export interface PreviewSession {
  update?(text: string, manifest?: AssetManifestLike): Promise<void> | void;
  dispose(): void;
}

/** The web host supplies this port. Views never import apps/web or build an iframe policy. */
export interface IsolatedPreviewPort {
  mount(options: PreviewMountOptions): Promise<PreviewSession> | PreviewSession;
}

export interface TextCapability extends OfficeCapabilityEntry {
  operation: string;
}

export interface TextEditorProps<TSnapshot = unknown> {
  documentKey: string;
  editor: TextEditorHandle<TSnapshot>;
  open: TextOpenPort;
  coordinator: TextSaveCoordinator;
  capability?: TextCapability;
  preview?: IsolatedPreviewPort;
  manifest?: AssetManifestLike | null;
  assetFailures?: Readonly<Record<string, AssetStatus | boolean>>;
  title?: string;
  className?: string;
  onOpen?: (outcome: TextOpenOutcome) => void;
}

export type TextViewState = "opening" | "ready" | "error";
