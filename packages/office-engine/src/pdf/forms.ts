// AcroForm fill + flatten (UNI-925 B5). Filling writes a field's value and its
// appearance without touching any page content stream; flattening bakes each
// field's appearance into its page and drops the interactive form. Refusals are
// typed PdfOpError values — unknown field, a kind the document's field does not
// match, a value of the wrong type, an option the field does not offer — so the
// worker maps them onto a closed outcome instead of guessing. Unrelated pages,
// annotations and fields are never rewritten.
import { PDFCheckBox, PDFDict, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFTextField } from "pdf-lib";
import type { PDFDocument, PDFField } from "pdf-lib";

import { PdfOpError } from "./op-parse.ts";
import type { FormFieldInput } from "./types.ts";

const OP = "setFormValue";

/** True when the document carries an AcroForm at all. Read from the raw
    catalog: getForm() would create an empty /AcroForm on a document that never
    had one, so a refused write must not touch it. */
function hasAcroForm(doc: PDFDocument): boolean {
  return doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict) !== undefined;
}

/** Resolve a field by name, turning pdf-lib's bare Error into a typed refusal. */
function requireField(doc: PDFDocument, name: string): PDFField {
  let field: PDFField | undefined;
  if (hasAcroForm(doc)) {
    try {
      field = doc.getForm().getField(name);
    } catch {
      field = undefined;
    }
  }
  if (!field) throw new PdfOpError(OP, "field", `unknown field "${name}"`);
  return field;
}

/** Text and choice values are strings; a boolean here is a caller bug. */
function asString(value: string | boolean, kind: string): string {
  if (typeof value !== "string") {
    throw new PdfOpError(OP, "value", `${kind} field requires a string value`);
  }
  return value;
}

/** The value must be one the field actually offers; selecting anything else is
    a silent no-op in pdf-lib, so the refusal has to be explicit. */
function requireOption(options: string[], value: string, name: string): string {
  if (!options.includes(value)) {
    throw new PdfOpError(OP, "value", `"${value}" is not an option of field "${name}"`);
  }
  return value;
}

/**
 * Set one AcroForm field value in place. The field's kind must match the
 * document's own field type — `choice` accepts a dropdown or an option list,
 * the document decides which — and the value must be the type that kind takes:
 * a string for text and choice, a boolean for a checkbox, and for a radio
 * either an option name or a boolean that clears / picks its sole option.
 */
export function applyFormValue(doc: PDFDocument, input: FormFieldInput): void {
  const field = requireField(doc, input.name);
  switch (input.kind) {
    case "text": {
      if (!(field instanceof PDFTextField)) {
        throw new PdfOpError(OP, "kind", `field "${input.name}" is not a text field`);
      }
      field.setText(asString(input.value, "text"));
      return;
    }
    case "checkbox": {
      if (!(field instanceof PDFCheckBox)) {
        throw new PdfOpError(OP, "kind", `field "${input.name}" is not a checkbox`);
      }
      if (typeof input.value !== "boolean") {
        throw new PdfOpError(OP, "value", "checkbox requires a boolean value");
      }
      if (input.value) field.check();
      else field.uncheck();
      return;
    }
    case "radio": {
      if (!(field instanceof PDFRadioGroup)) {
        throw new PdfOpError(OP, "kind", `field "${input.name}" is not a radio group`);
      }
      const options = field.getOptions();
      // A boolean targets a two-state radio the host reported without options:
      // false clears the group, true can only be resolved when one option is
      // left to choose. A string is an option name and must exist.
      if (typeof input.value === "boolean") {
        if (!input.value) {
          field.clear();
          return;
        }
        if (options.length !== 1) {
          throw new PdfOpError(OP, "value", `radio field "${input.name}" needs an option name`);
        }
        field.select(options[0]!);
        return;
      }
      field.select(requireOption(options, asString(input.value, "radio"), input.name));
      return;
    }
    case "choice": {
      if (!(field instanceof PDFDropdown) && !(field instanceof PDFOptionList)) {
        throw new PdfOpError(OP, "kind", `field "${input.name}" is not a choice field`);
      }
      const value = asString(input.value, "choice");
      field.select(requireOption(field.getOptions(), value, input.name));
      return;
    }
    default: {
      const kind: never = input.kind;
      throw new PdfOpError(OP, "kind", `unknown field kind "${String(kind)}"`);
    }
  }
}

/**
 * Bake every AcroForm field's appearance into the page content and remove the
 * interactive form (pdf-lib drops the widget annotations and the AcroForm
 * itself). Returns whether anything was flattened: a document with no fields is
 * left semantically unchanged and reported as a no-op rather than silently
 * counted as applied. Every non-widget annotation is preserved.
 */
export function flattenForms(doc: PDFDocument): boolean {
  // hasAcroForm reads the raw catalog: getForm() would create an empty
  // /AcroForm on a document that never had one, and "no fields" must stay a
  // byte-level no-op.
  if (!hasAcroForm(doc)) return false;
  const form = doc.getForm();
  if (form.getFields().length === 0) return false;
  form.flatten();
  return true;
}
