import { createDesktopPptxAdapter, type DesktopPptxAdapter, type DesktopPptxEditorHandle } from "./pptx-adapter";
import { createWebPptxSessionRuntime, type PptxSessionRuntime } from "./pptx-runtime";
import type { OfficeCapabilityEntry, OfficeIdentity } from "@uniwork/core/office";

/** The genoffice commit the vendored pptx artifact is pinned to (UNI-684). */
export const PPTX_DESKTOP_ENGINE_BUILD = "09485f884dc845cf3bf27fb7edfe489f9d457aad";

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
