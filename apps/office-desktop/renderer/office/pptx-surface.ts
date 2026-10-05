import { createDesktopPptxAdapter, type DesktopPptxAdapter, type DesktopPptxEditorHandle } from "./pptx-adapter";
import { createWebPptxSessionRuntime, type PptxSessionRuntime } from "./pptx-runtime";
import type { OfficeCapabilityEntry, OfficeIdentity } from "@uniwork/core/office";
import { desktopEngineBuild } from "../../shared/document-formats";

/** The genoffice commit the vendored pptx artifact is pinned to (UNI-684); the
 * shared desktop format table is its single source. */
export const PPTX_DESKTOP_ENGINE_BUILD = desktopEngineBuild("pptx");

export type DesktopPptxSurface = DesktopPptxEditorHandle;

/** Bind the shared pptx editor to the accepted byte transport. The renderer
 * owns open/edit/serialize; main owns every file and cloud write behind the
 * validated IPC seam (the session module supplies the save transport). */
export function createDesktopPptxSurface(options: {
  documentId: string;
  readBytes(): Promise<Uint8Array>;
  identity: OfficeIdentity;
  capability: OfficeCapabilityEntry;
  readOnly?: boolean;
  onDirty?(generation: number): void;
  runtime?: PptxSessionRuntime;
}): DesktopPptxAdapter {
  const runtime = options.runtime ?? createWebPptxSessionRuntime({ documentId: options.documentId });
  return createDesktopPptxAdapter({
    identity: options.identity,
    runtime,
    readBytes: options.readBytes,
    capability: options.capability,
    readonly: options.readOnly,
    ...(options.onDirty ? { onDirty: options.onDirty } : {}),
  });
}

export type { DesktopPptxEditorHandle };
