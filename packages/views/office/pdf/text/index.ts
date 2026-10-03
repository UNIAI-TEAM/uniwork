export { PdfTextEditPanel, type PdfTextEditPanelProps } from "./text-edit-panel";
export { PdfTextInsertPanel, type PdfTextInsertPanelProps } from "./text-insert-panel";
export { pdfTextErrorMessage } from "./error";
export { bridgePdfTextOperation, createPdfTextOperationProvider, type PdfTextBridgeInput, type PdfTextOperationSubmitter } from "./provider";
export type {
  PdfTextEditInput,
  PdfTextEngineOperation,
  PdfTextInsertInput,
  PdfTextOperationError,
  PdfTextOperationProvider,
  PdfTextSelection,
} from "./types";

export { PdfTextEditPanel as PdfTextEditingPanel } from "./text-edit-panel";
export { PdfTextInsertPanel as PdfTextInsertionPanel } from "./text-insert-panel";
