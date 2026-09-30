export {
  OfficeShell,
  type OfficeSaveCoordinatorLike,
  type OfficeShellProps,
  type OfficeShellTab,
} from "./office-shell";
export {
  EditorSlot,
  type EditorOpenState,
  type EditorSlotProps,
  type OfficeEditorComponent,
  type OfficeEditorLoader,
  type OfficeEditorRendererProps,
} from "./editor-slot";
export { SaveStatus, type OfficeSaveStatusKind, type SaveStatusProps } from "./save-status";
export {
  DraftRecoveryPrompt,
  LeaveDialog,
  type DraftRecoveryPromptProps,
  type LeaveChoice,
  type LeaveDialogProps,
} from "./leave-dialog";
export * from "./pptx";
export { PdfEditor, PdfErrorState, PdfPagePanel, PdfToolbar, createPdfEditorLoader } from "./pdf";
export type { PdfEditorProps, PdfEditorHandle, PdfOpenOutcome, PdfOpenFailure, PdfSaveCoordinator, PdfCapability } from "./pdf";
export { PDF_COMMANDS, PDF_COMMAND_CAPABILITIES, type PdfCommandId } from "./pdf";
export * from "./markdown";
export * from "./html";
export { assetManifestRows, hasFailedAsset, normaliseAssetPath, type AssetManifestEntryLike, type AssetManifestLike, type AssetManifestRow, type AssetStatus } from "./asset-manifest";
export { SourceEditor, type SourceEditorProps } from "./source-editor";
export type {
  IsolatedPreviewPort,
  PreviewMountOptions,
  PreviewSession,
  SourceTextPort,
  TextClipboardPort,
  TextEditorPermissions,
  TextEditorProps,
  TextCapability,
  TextEditorHandle,
  TextOpenFailure,
  TextOpenOutcome,
  TextOpenPort,
  TextOpenSuccess,
  TextSaveCoordinator,
} from "./source-editor-types";

/** Format loaders are intentionally thin; the host still supplies open,
 * coordinator and isolated preview ports through the editor props. */
export const loadMarkdownEditor = () => import("./markdown").then((module) => ({ default: module.MarkdownEditor }));
export const loadHtmlEditor = () => import("./html").then((module) => ({ default: module.HtmlEditor }));
