import type { ReactNode } from "react";
import type { EditorHandle } from "@uniwork/core/office";
import type { OpenOutcome } from "@uniwork/office-contracts";
import type { DocxFormatCommands } from "@uniwork/views/office/docx";
import type { LibraryBridge } from "../library/model";

/** The renderer-side editor surface the byte session drives. Every format lane
 * implements this seam (the DOCX surface today, the PDF surface next); the
 * session itself never branches on format. The optional facets below are the
 * shared view handles a lane may bind — the DOCX commands/selection are typed
 * facets of the one lane that has them, and a lane without them omits them. */
export type DesktopEditorSurface = EditorHandle<Uint8Array> & {
  /** Outcome of the explicit open this surface ran, when it ran one. */
  openOutcome?(): OpenOutcome | null;
  subscribeDirty?(listener: (generation: number) => void): () => void;
  renderSurface?(): ReactNode;
  /** Format-specific selection/commands are attached by the mounted lane. */
  selection?: unknown;
  commands?: DocxFormatCommands;
};

/** Everything a format lane needs to bind an editor to the opened document. */
export interface DesktopSurfaceSettings {
  readonly documentId: string;
  readBytes(): Promise<Uint8Array>;
  readonly generation: number;
  readonly readOnly: boolean;
  readonly bridge: LibraryBridge;
  readonly sessionGeneration: string;
}

export type DesktopSurfaceFactory = (settings: DesktopSurfaceSettings) => Promise<DesktopEditorSurface>;
