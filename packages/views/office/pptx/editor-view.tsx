"use client";

import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { EditorHandle, OfficeCapabilityEntry, OfficeCapabilityStatus, OfficeHost } from "@uniwork/core/office";
import { EditorSlot, type EditorOpenState, type OfficeEditorComponent, type OfficeEditorRendererProps } from "../editor-slot";
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
  const {
    slides,
    elements,
    selectedIndex,
    onSlideSelect,
    onTransform,
    transformRequest,
    onTextEdit,
    onOpen,
    onCommandError,
    onDirty,
    onSnapshot,
    capabilities,
    className,
  } = editorProps;
  const FormatEditor = useMemo<OfficeEditorComponent>(() => {
    function PptxFormatEditor({ host: editorHost, editorHandle }: OfficeEditorRendererProps) {
      return (
        <PptxEditor
          host={editorHost}
          editorHandle={editorHandle}
          slides={slides}
          elements={elements}
          selectedIndex={selectedIndex}
          onSlideSelect={onSlideSelect}
          onTransform={onTransform}
          transformRequest={transformRequest}
          onTextEdit={onTextEdit}
          onOpen={onOpen}
          onCommandError={onCommandError}
          onDirty={onDirty}
          onSnapshot={onSnapshot}
          capabilities={capabilities}
          className={className}
          saveCoordinator={saveCoordinator}
          includeSave={false}
        />
      );
    }
    return PptxFormatEditor;
  }, [capabilities, className, elements, onCommandError, onDirty, onOpen, onSnapshot, onSlideSelect, onTextEdit, onTransform, selectedIndex, slides, transformRequest, saveCoordinator]);
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
