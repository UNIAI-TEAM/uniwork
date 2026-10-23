import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { applyPdfEditBytes, probePdf } from "./adapter";
import { applyFormValue, flattenForms } from "./forms";
import { PdfOpError } from "./op-parse";
import { readPdfText } from "./extract";

const PAGE: [number, number] = [320, 320];

/** A form fixture with one widget of every kind this lane writes. */
async function formFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(PAGE);
  page.drawText("keep this content", { x: 24, y: 290, size: 12 });
  const form = doc.getForm();
  form.createTextField("full_name").addToPage(page, { x: 24, y: 240, width: 160, height: 20 });
  form.createCheckBox("agree").addToPage(page, { x: 24, y: 210, width: 16, height: 16 });
  const radio = form.createRadioGroup("tier");
  radio.addOptionToPage("basic", page, { x: 24, y: 180, width: 16, height: 16 });
  radio.addOptionToPage("pro", page, { x: 24, y: 160, width: 16, height: 16 });
  const dropdown = form.createDropdown("city");
  dropdown.addOptions(["Hà Nội", "Đà Nẵng", "Hue"]);
  dropdown.addToPage(page, { x: 24, y: 130, width: 160, height: 20 });
  const optionList = form.createOptionList("tags");
  optionList.addOptions(["alpha", "beta"]);
  optionList.addToPage(page, { x: 24, y: 90, width: 160, height: 40 });
  return doc.save();
}

/** A document with an AcroForm but zero fields — flatten must be a no-op. */
async function emptyFormFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage(PAGE);
  doc.catalog.set(PDFName.of("AcroForm"), doc.context.obj({ Fields: [] }));
  return doc.save();
}

/** Count annotations of one /Subtype on a page of saved bytes. */
async function annotCount(bytes: Uint8Array, subtype: string, pageIndex = 0): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  const raw = doc.getPage(pageIndex)!.node.get(PDFName.of("Annots"));
  if (!raw) return 0;
  const annots = doc.context.lookup(raw, PDFArray);
  let count = 0;
  for (let i = 0; i < annots.size(); i++) {
    const dict = doc.context.lookupMaybe(annots.get(i), PDFDict);
    if (dict?.lookupMaybe(PDFName.of("Subtype"), PDFName) === PDFName.of(subtype)) count++;
  }
  return count;
}

const setFormValue = (name: string, kind: string, value: string | boolean) => ({
  op: "setFormValue" as const,
  field: { name, kind, value },
});
const flattenOp = { op: "flattenForms" as const };

describe("pdf form fill", () => {
  it("round-trips every WinAnsi field kind through edit → save → reopen", async () => {
    const input = await formFixture();
    const out = await applyPdfEditBytes(input, [
      setFormValue("full_name", "text", "An"),
      setFormValue("agree", "checkbox", true),
      setFormValue("tier", "radio", "pro"),
      setFormValue("tags", "choice", "beta"),
      setFormValue("city", "choice", "Hue"),
    ]);
    expect(out.report.formValues).toEqual({ applied: 5, skipped: 0 });
    expect(out.warnings).toEqual([]);

    const doc = await PDFDocument.load(out.bytes);
    const form = doc.getForm();
    expect(form.getTextField("full_name").getText()).toBe("An");
    expect(form.getCheckBox("agree").isChecked()).toBe(true);
    expect(form.getRadioGroup("tier").getSelected()).toBe("pro");
    expect(form.getOptionList("tags").getSelected()).toEqual(["beta"]);
    expect(form.getDropdown("city").getSelected()).toEqual(["Hue"]);
    expect(doc.getPageCount()).toBe(1);
  });

  it("refuses a non-WinAnsi text value as a typed skip instead of crashing the save", async () => {
    const out = await applyPdfEditBytes(await formFixture(), [
      setFormValue("full_name", "text", "Nguyễn An"),
    ]);
    expect(out.report.formValues).toEqual({ applied: 0, skipped: 1 });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]!.code).toBe("edit_skipped");
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getForm().getTextField("full_name").getText()).toBeUndefined();
  });

  it("unchecks a checked box and reports the capability in the probe", async () => {
    const first = await applyPdfEditBytes(await formFixture(), [setFormValue("agree", "checkbox", true)]);
    const second = await applyPdfEditBytes(first.bytes, [setFormValue("agree", "checkbox", false)]);
    const doc = await PDFDocument.load(second.bytes);
    expect(doc.getForm().getCheckBox("agree").isChecked()).toBe(false);
    expect((await probePdf(second.bytes)).features.formFill).toBe(true);
  });

  it("does not rewrite page content when filling", async () => {
    const input = await formFixture();
    const before = await readPdfText(input);
    const out = await applyPdfEditBytes(input, [setFormValue("full_name", "text", "An")]);
    expect(await readPdfText(out.bytes)).toEqual(before);
  });

  it("preserves unrelated annotations when filling", async () => {
    const withNote = await applyPdfEditBytes(await formFixture(), [
      { op: "addNote", attributes: { note: { pageIndex: 0, rect: [40, 40, 60, 60], contents: "Ghi chú" } } },
    ]);
    const out = await applyPdfEditBytes(withNote.bytes, [setFormValue("full_name", "text", "An")]);
    expect(await annotCount(out.bytes, "Text")).toBe(1);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getForm().getTextField("full_name").getText()).toBe("An");
  });

  it("keeps an earlier WinAnsi value when a later save refuses a non-WinAnsi one", async () => {
    const first = await applyPdfEditBytes(await formFixture(), [setFormValue("full_name", "text", "An")]);
    const second = await applyPdfEditBytes(first.bytes, [setFormValue("city", "choice", "Hà Nội")]);
    expect(second.report.formValues).toEqual({ applied: 0, skipped: 1 });
    expect(second.warnings).toHaveLength(1);
    expect(second.warnings[0]!.code).toBe("edit_skipped");
    const doc = await PDFDocument.load(second.bytes);
    const form = doc.getForm();
    expect(form.getTextField("full_name").getText()).toBe("An");
    expect(form.getDropdown("city").getSelected()).toEqual([]);
  });
});

describe("pdf form flatten", () => {
  it("removes interactivity while keeping the page and its content", async () => {
    const filled = await applyPdfEditBytes(await formFixture(), [
      setFormValue("full_name", "text", "An"),
      setFormValue("agree", "checkbox", true),
    ]);
    expect(await annotCount(filled.bytes, "Widget")).toBeGreaterThan(0);

    const flat = await applyPdfEditBytes(filled.bytes, [flattenOp]);
    expect(flat.report.flattenForms).toEqual({ applied: 1 });
    expect(flat.report.formValues).toEqual({ applied: 0, skipped: 0 });

    expect(await annotCount(flat.bytes, "Widget")).toBe(0);
    const doc = await PDFDocument.load(flat.bytes);
    expect(doc.getForm().getFields()).toEqual([]);
    expect(doc.getPageCount()).toBe(1);
    expect((await readPdfText(flat.bytes)).pages[0]!.hasTextLayer).toBe(true);
  });

  it("preserves unrelated pages and non-widget annotations when flattening", async () => {
    const base = await formFixture();
    const doc = await PDFDocument.load(base);
    doc.addPage([200, 200]);
    const twoPage = await doc.save();
    const withNote = await applyPdfEditBytes(twoPage, [
      { op: "addNote", attributes: { note: { pageIndex: 1, rect: [40, 40, 60, 60], contents: "Ghi chú" } } },
    ]);

    const flat = await applyPdfEditBytes(withNote.bytes, [flattenOp]);
    expect(flat.report.flattenForms).toEqual({ applied: 1 });
    expect(await annotCount(flat.bytes, "Widget")).toBe(0);
    expect(await annotCount(flat.bytes, "Text", 1)).toBe(1);
    const reopened = await PDFDocument.load(flat.bytes);
    expect(reopened.getPageCount()).toBe(2);
  });

  it("is a no-op for a document without an AcroForm", async () => {
    const doc = await PDFDocument.create();
    doc.addPage(PAGE);
    const out = await applyPdfEditBytes(await doc.save(), [flattenOp]);
    expect(out.report.flattenForms).toEqual({ applied: 0 });
    expect(out.warnings).toEqual([]);
  });

  it("is a no-op for an AcroForm with no fields", async () => {
    const out = await applyPdfEditBytes(await emptyFormFixture(), [flattenOp]);
    expect(out.report.flattenForms).toEqual({ applied: 0 });
    expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(1);
  });
});

describe("pdf form refusals", () => {
  it("throws a typed error for an unknown field", async () => {
    const doc = await PDFDocument.load(await formFixture());
    expect(() => applyFormValue(doc, { name: "nope", kind: "text", value: "x" })).toThrow(PdfOpError);
    try {
      applyFormValue(doc, { name: "nope", kind: "text", value: "x" });
    } catch (error) {
      expect((error as PdfOpError).field).toBe("field");
      expect((error as PdfOpError).unsupported).toBe(false);
    }
  });

  it("throws a typed error when the kind does not match the document field", async () => {
    const doc = await PDFDocument.load(await formFixture());
    expect(() => applyFormValue(doc, { name: "full_name", kind: "checkbox", value: true })).toThrow(PdfOpError);
    expect(() => applyFormValue(doc, { name: "agree", kind: "text", value: "x" })).toThrow(PdfOpError);
    expect(() => applyFormValue(doc, { name: "city", kind: "radio", value: "pro" })).toThrow(PdfOpError);
  });

  it("throws a typed error for a value of the wrong type", async () => {
    const doc = await PDFDocument.load(await formFixture());
    expect(() => applyFormValue(doc, { name: "full_name", kind: "text", value: true })).toThrow(PdfOpError);
    expect(() => applyFormValue(doc, { name: "agree", kind: "checkbox", value: "yes" })).toThrow(PdfOpError);
  });

  it("throws a typed error for an option the field does not offer", async () => {
    const doc = await PDFDocument.load(await formFixture());
    expect(() => applyFormValue(doc, { name: "tier", kind: "radio", value: "gold" })).toThrow(PdfOpError);
    expect(() => applyFormValue(doc, { name: "city", kind: "choice", value: "Huế" })).toThrow(PdfOpError);
    expect(() => applyFormValue(doc, { name: "tags", kind: "choice", value: "gamma" })).toThrow(PdfOpError);
  });

  it("reports a refused write as a skip without failing the batch", async () => {
    const out = await applyPdfEditBytes(await formFixture(), [
      setFormValue("nope", "text", "x"),
      setFormValue("full_name", "text", "An"),
    ]);
    expect(out.report.formValues).toEqual({ applied: 1, skipped: 1 });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]!.code).toBe("edit_skipped");
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getForm().getTextField("full_name").getText()).toBe("An");
  });

  it("refuses a malformed setFormValue envelope before touching bytes", async () => {
    await expect(
      applyPdfEditBytes(await formFixture(), [
        { op: "setFormValue", field: { name: "x", kind: "nope", value: "y" } },
      ]),
    ).rejects.toThrow();
    await expect(
      applyPdfEditBytes(await formFixture(), [
        { op: "setFormValue", field: { name: "x", kind: "checkbox", value: "yes" } },
      ]),
    ).rejects.toThrow();
    // The engine also accepts the nested attributes.field envelope.
    await expect(
      applyPdfEditBytes(await formFixture(), [
        { op: "setFormValue", attributes: { field: { name: "x", kind: "nope", value: "y" } } },
      ]),
    ).rejects.toThrow();
  });

  it("clears a two-state radio when the value is false", async () => {
    const filled = await applyPdfEditBytes(await formFixture(), [setFormValue("tier", "radio", "pro")]);
    const cleared = await applyPdfEditBytes(filled.bytes, [setFormValue("tier", "radio", false)]);
    expect(cleared.report.formValues).toEqual({ applied: 1, skipped: 0 });
    const doc = await PDFDocument.load(cleared.bytes);
    expect(doc.getForm().getRadioGroup("tier").getSelected()).toBeUndefined();
  });

  it("flattens through the direct helper", async () => {
    const doc = await PDFDocument.load(await formFixture());
    expect(flattenForms(doc)).toBe(true);
  });
});
