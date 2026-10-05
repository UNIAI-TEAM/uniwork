/** AcroForm field kinds the browser can fill. Mirrors the engine's
 * `FormValueInput.kind` union without importing the Node implementation. */
export type PdfFormFieldKind = "text" | "checkbox" | "radio" | "choice";

/** One option of a choice field (or a radio group's export values). */
export interface PdfFormFieldOption {
  /** Export value written to the document. */
  value: string;
  /** Human label the host resolved for display. */
  label: string;
}

/** A form field as the host reports it from the opened document. */
export interface PdfFormField {
  /** AcroForm field name; the engine matches on it. */
  name: string;
  kind: PdfFormFieldKind;
  /** Display label; falls back to `name` when the host has none. */
  label?: string;
  /** Current value: a string for text/choice, a boolean for checkbox/radio. */
  value?: string | boolean;
  /** Choices for `kind: "choice"`; absent or empty for the other kinds. */
  options?: readonly PdfFormFieldOption[];
  /** A field the host cannot write stays visible but not editable. */
  readOnly?: boolean;
}

/** One requested field write, before it becomes an engine envelope. */
export interface PdfFormFieldValueInput {
  name: string;
  kind: PdfFormFieldKind;
  /** Text/choice take a string, checkbox/radio a boolean. */
  value: string | boolean;
}

/** The JSON envelope the host submits for one `setFormValue` operation. Kept
 * local so a browser bundle never imports the Node PDF implementation. */
export interface PdfFormSetValueOperation {
  op: "setFormValue";
  field: { name: string; kind: PdfFormFieldKind; value: string | boolean };
}

/** Flatten every filled field into page content; one-way in the engine. */
export interface PdfFormFlattenOperation {
  op: "flattenForms";
}

export type PdfFormEngineOperation = PdfFormSetValueOperation | PdfFormFlattenOperation;

/** Host/provider contract for form operations. The view never imports a codec. */
export interface PdfFormOperationProvider {
  setFormValue(input: PdfFormFieldValueInput): Promise<void> | void;
  flattenForms(): Promise<void> | void;
}

/** Serialisable envelope sink owned by the host. */
export interface PdfFormOperationSubmitter {
  submit(operations: readonly PdfFormEngineOperation[]): Promise<void> | void;
}

export interface PdfFormsPanelProps {
  /** Fields read from the document; `undefined` while the host still loads them. */
  fields?: readonly PdfFormField[];
  provider?: PdfFormOperationProvider;
  loading?: boolean;
  /** Host read failure, shown as an alert instead of a fabricated field list. */
  error?: string | null;
  /** Host is read-only: every control is disabled but stays visible. */
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  onApplied?: () => void;
}
