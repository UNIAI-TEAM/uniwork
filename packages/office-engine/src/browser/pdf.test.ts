import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { applyPdfOpsInBrowser, type BrowserPdfApplyResult, BrowserPdfUnsupportedError, PdfOpError, readPdfFormFields } from "./pdf";

async function fixture(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([300 + i * 10, 300]);
    page.drawText(`page ${i + 1}`, { x: 24, y: 260, size: 12 });
  }
  return doc.save();
}

async function formFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([320, 320]);
  const form = doc.getForm();
  form.createTextField("full_name").addToPage(page, { x: 24, y: 240, width: 160, height: 20 });
  form.createCheckBox("agree").addToPage(page, { x: 24, y: 210, width: 16, height: 16 });
  const radio = form.createRadioGroup("tier");
  radio.addOptionToPage("basic", page, { x: 24, y: 180, width: 16, height: 16 });
  radio.addOptionToPage("pro", page, { x: 24, y: 160, width: 16, height: 16 });
  const dropdown = form.createDropdown("city");
  dropdown.addOptions(["Hue", "Hanoi"]);
  dropdown.addToPage(page, { x: 24, y: 130, width: 160, height: 20 });
  return doc.save();
}

async function annots(bytes: Uint8Array, pageIndex = 0): Promise<PDFDict[]> {
  const doc = await PDFDocument.load(bytes);
  const list = doc.getPage(pageIndex).node.get(PDFName.of("Annots"));
  if (!list) return [];
  const refs = doc.context.lookup(list, PDFArray);
  return refs.asArray().map((ref) => doc.context.lookup(ref, PDFDict));
}

describe("applyPdfOpsInBrowser", () => {
  it("adds a markup annotation and never mutates the input", async () => {
    const input = await fixture();
    const copy = input.slice();
    const out = await applyPdfOpsInBrowser(input, [
      { op: "addMarkup", attributes: { markup: { pageIndex: 0, type: "highlight", color: [1, 0.8, 0], quads: [[72, 250, 190, 250, 72, 235, 190, 235]] } } },
    ]);
    expect(input).toEqual(copy);
    expect(out.skipped).toEqual([]);
    const [annot] = await annots(out.bytes);
    expect(annot!.get(PDFName.of("Subtype"))).toEqual(PDFName.of("Highlight"));
  });

  it("adds a note with Vietnamese contents", async () => {
    const out = await applyPdfOpsInBrowser(await fixture(), [
      { op: "addNote", attributes: { note: { pageIndex: 0, rect: [40, 200, 60, 220], contents: "Ghi chú tiếng Việt" } } },
    ]);
    const [note] = await annots(out.bytes);
    expect(note!.get(PDFName.of("Subtype"))).toEqual(PDFName.of("Text"));
  });

  it("reports a skip for an out-of-range page instead of throwing", async () => {
    const out = await applyPdfOpsInBrowser(await fixture(), [
      { op: "addNote", attributes: { note: { pageIndex: 5, rect: [40, 200, 60, 220], contents: "x" } } },
    ]);
    expect(out.skipped).toEqual([{ op: "addNote", reason: "page 6: page out of range" }]);
  });

  it("rotates a page", async () => {
    const out = await applyPdfOpsInBrowser(await fixture(2), [{ op: "rotatePages", attributes: { pages: [1], dir: 90 } }]);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPage(0).getRotation().angle).toBe(0);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
  });

  it("reorders pages", async () => {
    const out = await applyPdfOpsInBrowser(await fixture(3), [{ op: "setPageOrder", attributes: { order: [2, 0, 1] } }]);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPages().map((p) => p.getWidth())).toEqual([320, 300, 310]);
  });

  it("deletes a page and inserts a blank page", async () => {
    const out = await applyPdfOpsInBrowser(await fixture(3), [
      { op: "deletePage", attributes: { pageIndex: 0 } },
      { op: "insertBlankPage", attributes: { afterPageIndex: 1, width: 200, height: 100 } },
    ]);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPages().map((p) => p.getWidth())).toEqual([310, 200, 320]);
  });

  it("writes ASCII form values", async () => {
    const out = await applyPdfOpsInBrowser(await formFixture(), [
      { op: "setFormValue", field: { name: "full_name", kind: "text", value: "An" } },
      { op: "setFormValue", field: { name: "agree", kind: "checkbox", value: true } },
      { op: "setFormValue", field: { name: "tier", kind: "radio", value: "pro" } },
      { op: "setFormValue", field: { name: "city", kind: "choice", value: "Hanoi" } },
    ]);
    expect(out.skipped).toEqual([]);
    const fields = await readPdfFormFields(out.bytes);
    expect(fields.find((f) => f.name === "full_name")?.value).toBe("An");
    expect(fields.find((f) => f.name === "agree")?.value).toBe(true);
    expect(fields.find((f) => f.name === "tier")).toMatchObject({ kind: "radio", value: "pro" });
    expect(fields.find((f) => f.name === "city")).toMatchObject({
      kind: "choice",
      value: "Hanoi",
      options: [
        { value: "Hue", label: "Hue" },
        { value: "Hanoi", label: "Hanoi" },
      ],
    });
  });

  it("never throws a bare Error for a value the WinAnsi font cannot encode", async () => {
    const result: BrowserPdfApplyResult | unknown = await applyPdfOpsInBrowser(await formFixture(), [
      { op: "setFormValue", field: { name: "full_name", kind: "text", value: "Nguyễn An" } },
    ]).then(
      (r) => r,
      (e: unknown) => e,
    );
    if (result instanceof Error) expect(result).toBeInstanceOf(PdfOpError);
    else expect((result as BrowserPdfApplyResult).skipped).toEqual([expect.objectContaining({ op: "setFormValue" })]);
  });

  it("flattens a form", async () => {
    const out = await applyPdfOpsInBrowser(await formFixture(), [{ op: "flattenForms" }]);
    expect(await readPdfFormFields(out.bytes)).toEqual([]);
  });

  it.each([
    [{ op: "putTextEdit", attributes: { pageIndex: 0, rect: [0, 0, 10, 10], oldText: "a", newText: "b", fontSize: 12 } }, "textEdits"],
    [{ op: "deleteSavedAnnot", attributes: { annot: { pageIndex: 0, objNum: 4, subtype: "highlight", rect: [0, 0, 1, 1] } } }, "annotDeletes"],
  ])("refuses %j as unsupported in the browser", async (op, field) => {
    const error = await applyPdfOpsInBrowser(await fixture(), [op]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BrowserPdfUnsupportedError);
    expect((error as BrowserPdfUnsupportedError).code).toBe("unsupported_in_browser");
    expect((error as BrowserPdfUnsupportedError).fields).toContain(field);
  });

  it("rejects malformed ops with a typed PdfOpError", async () => {
    await expect(applyPdfOpsInBrowser(await fixture(), [{ op: "nope" }])).rejects.toBeInstanceOf(PdfOpError);
  });
});

describe("readPdfFormFields", () => {
  it("returns [] when there is no AcroForm", async () => {
    expect(await readPdfFormFields(await fixture())).toEqual([]);
  });

  it("lists every kind with its value", async () => {
    const fields = await readPdfFormFields(await formFixture());
    expect(fields.map((f) => [f.name, f.kind])).toEqual([
      ["full_name", "text"],
      ["agree", "checkbox"],
      ["tier", "radio"],
      ["city", "choice"],
    ]);
  });
});
