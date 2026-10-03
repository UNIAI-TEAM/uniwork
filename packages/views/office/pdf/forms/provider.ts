import type {
  PdfFormFieldKind,
  PdfFormFieldValueInput,
  PdfFormFlattenOperation,
  PdfFormOperationProvider,
  PdfFormOperationSubmitter,
  PdfFormSetValueOperation,
} from "./types";

export class PdfFormProviderError extends Error {
  readonly code = "invalid_input" as const;

  constructor(message: string) {
    super(message);
    this.name = "PdfFormProviderError";
  }
}

const KINDS: readonly PdfFormFieldKind[] = ["text", "checkbox", "radio", "choice"];

/** The engine takes a string for text/choice and a boolean for a checkbox; a
 * radio takes an option's export value, or a boolean for a two-state field.
 * A mismatched pair would be dropped at save time, so it is refused here
 * before the submitter is touched. */
function fieldOperation(input: PdfFormFieldValueInput): PdfFormSetValueOperation {
  if (typeof input.name !== "string" || input.name.trim() === "") {
    throw new PdfFormProviderError("field name must be non-empty text");
  }
  if (!KINDS.includes(input.kind)) {
    throw new PdfFormProviderError(`unsupported form field kind: ${String(input.kind)}`);
  }
  const takesString = input.kind === "text" || input.kind === "choice";
  const takesBoolean = input.kind === "checkbox";
  const wrongString = takesString && typeof input.value !== "string";
  const wrongBoolean = takesBoolean && typeof input.value !== "boolean";
  const wrongRadio = input.kind === "radio" && typeof input.value !== "string" && typeof input.value !== "boolean";
  if (wrongString || wrongBoolean || wrongRadio) {
    throw new PdfFormProviderError(`${input.kind} fields take a ${takesBoolean ? "boolean" : takesString ? "string" : "string or boolean"} value`);
  }
  return { op: "setFormValue", field: { name: input.name, kind: input.kind, value: input.value } };
}

/** Browser-safe form provider. Every change submits exactly one typed envelope;
 * the view never serializes and the engine is not imported here. */
export function createPdfFormOperationProvider(submitter: PdfFormOperationSubmitter): PdfFormOperationProvider {
  return {
    async setFormValue(input: PdfFormFieldValueInput) {
      await submitter.submit([fieldOperation(input)]);
    },
    async flattenForms() {
      const operation: PdfFormFlattenOperation = { op: "flattenForms" };
      await submitter.submit([operation]);
    },
  };
}
