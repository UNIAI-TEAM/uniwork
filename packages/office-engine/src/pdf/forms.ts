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

// The code points CP1252/WinAnsi can encode that sit above 0xFF.
const WINANSI_HIGH = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);
/** A WinAnsi standard font (the AcroForm norm) encodes code points below 0xFF
    except the control slots and the five C1 gaps, plus the 27 high code points
    in WINANSI_HIGH. Anything else would crash pdf-lib's appearance update
    inside save(); refuse it as a typed error. */
function isWinAnsiEncodable(value: string): boolean {
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xff) { if (!WINANSI_HIGH.has(cp)) return false; continue; }
    if (cp < 0x20 && cp !== 0x08 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0c && cp !== 0x0d) return false;
    if (cp === 0x7f || (cp >= 0x80 && cp <= 0x9f && cp !== 0x85)) return false;
  }
  return true;
}

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
      const text = asString(input.value, "text");
      if (!isWinAnsiEncodable(text)) {
        throw new PdfOpError(OP, "value", `field "${input.name}" cannot encode the value with its WinAnsi font`, true);
      }
      field.setText(text);
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
      if (!isWinAnsiEncodable(value)) {
        throw new PdfOpError(OP, "value", `field "${input.name}" cannot encode the value with its WinAnsi font`, true);
      }
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
  for (const field of form.getFields()) {
    const name = field.getName();
    const getText = (field as { getText?: () => string }).getText;
    if (typeof getText === "function") {
      const value = getText.call(field);
      if (typeof value === "string" && !isWinAnsiEncodable(value)) {
        throw new PdfOpError(OP, "value", `field "${name}" cannot encode its value with its WinAnsi font`);
      }
    }
    // Choice fields carry their text in the selected value, so an unencodable
    // selection would crash flatten() the same way a text value does.
    const getSelected = (field as { getSelected?: () => unknown }).getSelected;
    if (typeof getSelected === "function") {
      const selected = getSelected.call(field);
      const values = Array.isArray(selected) ? selected : [selected];
      for (const value of values) {
        if (typeof value === "string" && !isWinAnsiEncodable(value)) {
          throw new PdfOpError(OP, "value", `field "${name}" cannot encode its selected value with its WinAnsi font`);
        }
      }
    }
    // An option list lays out every offered option at appearance time, so a
    // hostile option crashes the flatten even when the selection is fine.
    if (field instanceof PDFOptionList) {
      for (const option of field.getOptions()) {
        if (!isWinAnsiEncodable(option)) {
          throw new PdfOpError(OP, "value", `field "${name}" offers an option its WinAnsi font cannot encode`);
        }
      }
    }
  }
  form.flatten();
  return true;
}
