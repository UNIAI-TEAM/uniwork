"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { EditorHandle, OfficeCapabilityEntry, OfficeCapabilityStatus, OfficeHost } from "@uniwork/core/office";
import { EditorSlot, type EditorOpenState, type OfficeEditorComponent } from "../editor-slot";
import { OfficeShell, type OfficeSaveCoordinatorLike } from "../office-shell";
import { PptxEditor, type PptxEditorProps } from "./pptx-editor";

export interface PptxEditorViewProps extends Omit<PptxEditorProps, "host" | "editorHandle"> {
  title: ReactNode;
  host: OfficeHost;
  editorHandle?: EditorHandle | null;
  capability: OfficeCapabilityEntry | OfficeCapabilityStatus;
  openState?: EditorOpenState;
  openError?: ReactNode;
  onRetry?: () => void;
  breadcrumbs?: Parameters<typeof OfficeShell>[0]["breadcrumbs"];
  saveCoordinator?: OfficeSaveCoordinatorLike;
  fullscreen?: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
  panel?: ReactNode;
  panelLabel?: string;
}

/** Root format view. The slot remains the only mounting boundary; presenter
 * mode and fullscreen are view state around the same editor handle. */
export function PptxEditorView({
  title,
  host,
  editorHandle = null,
  capability,
  openState = "loading",
  openError,
  onRetry,
  breadcrumbs,
  saveCoordinator,
  fullscreen = false,
  onFullscreenChange,
  panel,
  panelLabel,
  ...editorProps
}: PptxEditorViewProps) {
  const [panelOpen, setPanelOpen] = useState(Boolean(panel));
  const FormatEditor: OfficeEditorComponent = ({ host, editorHandle }) => (
    <PptxEditor
      host={host}
      editorHandle={editorHandle}
      {...editorProps}
      saveCoordinator={saveCoordinator}
      includeSave={false}
    />
  );
  const editor = (
    <EditorSlot
      format="pptx"
      host={host}
      editorHandle={editorHandle}
      capability={capability}
      openState={openState}
      openError={openError}
      onRetry={onRetry}
      loadEditor={async () => ({ default: FormatEditor })}
    />
  );
  return (
    <OfficeShell
      title={title}
      breadcrumbs={breadcrumbs}
      editor={editor}
      toolbar={null}
      panel={panel}
      panelLabel={panelLabel}
      panelOpen={panelOpen}
      onPanelOpenChange={setPanelOpen}
      fullscreen={fullscreen}
      onFullscreenChange={onFullscreenChange}
      saveCoordinator={saveCoordinator}
      editorReady={openState === "ready" && (typeof capability === "string" ? capability === "available" : capability.status === "available")}
    />
  );
}

export { PptxEditor };
