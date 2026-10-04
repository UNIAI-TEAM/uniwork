"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { EditorHandle, OfficeCapabilityEntry, OfficeCapabilityStatus, OfficeHost } from "@uniwork/core/office";
import { EditorSlot, type EditorOpenState, type OfficeEditorComponent, type OfficeEditorRendererProps } from "../editor-slot";
import { OfficeShell, type OfficeSaveCoordinatorLike } from "../office-shell";
import { PptxEditor, type PptxEditorProps } from "./pptx-editor";
import { buildPptxPanel, type PptxPanelKind } from "./pptx-panel-host";

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
  /** Wire-round seam: render the active panel for this surface inside the shell. */
  panelKind?: PptxPanelKind;
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
  panelKind,
  ...editorProps
}: PptxEditorViewProps) {
  // Wire-round: a host-supplied panel wins; otherwise compose the active panel
  // from `panelKind` with the same generic edit channel the editor uses.
  const composedPanel = panel ?? (panelKind
    ? buildPptxPanel({ panelKind, ...(editorProps.onApplyEdit ? { onApplyEdit: editorProps.onApplyEdit } : {}) })
    : undefined);
  const [panelOpen, setPanelOpen] = useState(Boolean(composedPanel));
  // EditorSlot keys its lazy component on the loader identity. Keep the
  // renderer and loader stable while the host updates controlled selection,
  // model arrays, callbacks, or shell state; the renderer reads the latest
  // props so those updates rerender the existing editor session in place.
  const latestEditorProps = useRef({ ...editorProps, saveCoordinator, fullscreen, onFullscreenChange });
  latestEditorProps.current = { ...editorProps, saveCoordinator, fullscreen, onFullscreenChange };
  const FormatEditor = useMemo<OfficeEditorComponent>(() => {
    function PptxFormatEditor({ host: editorHost, editorHandle }: OfficeEditorRendererProps) {
      return <PptxEditor host={editorHost} editorHandle={editorHandle} {...latestEditorProps.current} includeSave={false} />;
    }
    return PptxFormatEditor;
  }, []);
  const loadEditor = useCallback(async () => ({ default: FormatEditor }), [FormatEditor]);
  const editor = (
    <EditorSlot
      format="pptx"
      host={host}
      editorHandle={editorHandle}
      capability={capability}
      openState={openState}
      openError={openError}
      onRetry={onRetry}
      loadEditor={loadEditor}
    />
  );
  return (
    <OfficeShell
      title={title}
      breadcrumbs={breadcrumbs}
      editor={editor}
      toolbar={null}
      panel={composedPanel}
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



