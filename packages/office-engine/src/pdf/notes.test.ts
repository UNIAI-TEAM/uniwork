import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyPdfEditBytes, probePdf } from "./adapter";
import { readPdfText } from "./extract";

async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  page.drawText("keep this content", { x: 24, y: 260, size: 12 });
  return doc.save();
}

const RECT: [number, number, number, number] = [40, 200, 60, 220];
const CONTENTS = "Ghi chú tiếng Việt";

interface NoteAnnot {
  ref: PDFRef;
  dict: PDFDict;
}

function noteAnnots(doc: PDFDocument, pageIndex = 0): NoteAnnot[] {
  const raw = doc.getPage(pageIndex)!.node.get(PDFName.of("Annots"));
  if (!raw) return [];
  const annots = doc.context.lookup(raw, PDFArray);
  const found: NoteAnnot[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i);
    if (!(ref instanceof PDFRef)) continue;
    const dict = doc.context.lookupMaybe(ref, PDFDict);
    if (dict && dict.lookupMaybe(PDFName.of("Subtype"), PDFName) === PDFName.of("Text")) found.push({ ref, dict });
  }
  return found;
}

function textOf(dict: PDFDict, key: string): string {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : "";
}

function addNoteOp(note: Record<string, unknown>): { op: "addNote"; attributes: { note: Record<string, unknown> } } {
  return { op: "addNote", attributes: { note } };
}

describe("pdf notes", () => {
  it("writes a Text note with Contents and author without rewriting page content", async () => {
    const input = await fixture();
    const before = await readPdfText(input);
    const out = await applyPdfEditBytes(input, [
      addNoteOp({ pageIndex: 0, rect: RECT, contents: CONTENTS, author: "Nguyễn An", createdMs: 1_700_000_000_000 }),
    ]);
    expect(out.report.notes).toEqual({ applied: 1, skipped: 0 });
    expect(out.warnings).toEqual([]);
    expect(await readPdfText(out.bytes)).toEqual(before);
    const doc = await PDFDocument.load(out.bytes);
    const [note] = noteAnnots(doc);
    expect(note).toBeDefined();
    expect(note!.dict.lookup(PDFName.of("Name"))?.toString()).toBe("/Comment");
    expect(textOf(note!.dict, "Contents")).toBe(CONTENTS);
    expect(textOf(note!.dict, "T")).toBe("Nguyễn An");
    expect(note!.dict.lookup(PDFName.of("F"))?.toString()).toBe("4");
    expect(textOf(note!.dict, "CreationDate")).toMatch(/^D:\d{14}[+-]\d{2}'\d{2}'$/);
    const rect = note!.dict.lookup(PDFName.of("Rect"), PDFArray);
    expect(rect.asArray().map((_value, index) => rect.lookupMaybe(index, PDFNumber)?.asNumber())).toEqual([40, 200, 60, 220]);

    const probe = await probePdf(out.bytes);
    expect(probe.features.note).toBe(true);
    expect(probe.features.noteResolve).toBe(true);
  });

  it("replies to a saved note through /IRT + /RT", async () => {
    const first = await applyPdfEditBytes(await fixture(), [addNoteOp({ pageIndex: 0, rect: RECT, contents: CONTENTS })]);
    const parentDoc = await PDFDocument.load(first.bytes);
    const parent = noteAnnots(parentDoc)[0]!;
    const second = await applyPdfEditBytes(first.bytes, [
      addNoteOp({ pageIndex: 0, rect: RECT, contents: "Trả lời", replyTo: { objNum: parent.ref.objectNumber, rect: RECT, contents: CONTENTS } }),
    ]);
    expect(second.report.notes).toEqual({ applied: 1, skipped: 0 });
    const doc = await PDFDocument.load(second.bytes);
    const notes = noteAnnots(doc);
    expect(notes).toHaveLength(2);
    const reply = notes.find((note) => textOf(note.dict, "Contents") === "Trả lời")!;
    const parentRef = reply.dict.get(PDFName.of("IRT"));
    expect(parentRef).toBeInstanceOf(PDFRef);
    expect((parentRef as PDFRef).objectNumber).toBe(notes.find((note) => textOf(note.dict, "Contents") === CONTENTS)!.ref.objectNumber);
    expect(reply.dict.lookup(PDFName.of("IRT"), PDFDict).lookup(PDFName.of("Contents"))?.toString()).toBeDefined();
    expect(reply.dict.lookup(PDFName.of("RT"))?.toString()).toBe("/R");
  });

  it("threads a reply to a note written earlier in the same batch", async () => {
    const out = await applyPdfEditBytes(await fixture(), [
      addNoteOp({ pageIndex: 0, rect: RECT, contents: "Gốc", localId: "root" }),
      addNoteOp({ pageIndex: 0, rect: RECT, contents: "Con", replyToLocalId: "root" }),
    ]);
    expect(out.report.notes).toEqual({ applied: 2, skipped: 0 });
    const doc = await PDFDocument.load(out.bytes);
    const notes = noteAnnots(doc);
    expect(notes).toHaveLength(2);
    const root = notes.find((note) => textOf(note.dict, "Contents") === "Gốc")!;
    const child = notes.find((note) => textOf(note.dict, "Contents") === "Con")!;
    expect((child.dict.get(PDFName.of("IRT")) as PDFRef).objectNumber).toBe(root.ref.objectNumber);
  });

  it("skips an unresolvable reply instead of degrading it to a root note", async () => {
    const input = await fixture();
    const out = await applyPdfEditBytes(input, [
      addNoteOp({ pageIndex: 0, rect: RECT, contents: "Trả lời", replyTo: { objNum: 999, rect: [1, 2, 3, 4], contents: "không có" } }),
    ]);
    expect(out.report.notes).toEqual({ applied: 0, skipped: 1 });
    expect(out.warnings).toEqual([{ code: "edit_skipped", detail: "note page=1: reply parent note was not found in the file" }]);
    const doc = await PDFDocument.load(out.bytes);
    expect(noteAnnots(doc)).toHaveLength(0);
  });

  it("edits a saved note in place, keeping its object number and reply chain", async () => {
    const first = await applyPdfEditBytes(await fixture(), [
      addNoteOp({ pageIndex: 0, rect: RECT, contents: "Gốc", localId: "root" }),
      addNoteOp({ pageIndex: 0, rect: RECT, contents: "Con", replyToLocalId: "root" }),
    ]);
    const before = await readPdfText(first.bytes);
    const beforeDoc = await PDFDocument.load(first.bytes);
    const rootBefore = noteAnnots(beforeDoc).find((note) => textOf(note.dict, "Contents") === "Gốc")!;
    const second = await applyPdfEditBytes(first.bytes, [
      { op: "editSavedNote", attributes: { pageIndex: 0, objNum: rootBefore.ref.objectNumber, rect: RECT, oldContents: "Gốc", contents: "Gốc đã sửa" } },
    ]);
    expect(second.report.noteEdits).toEqual({ applied: 1, skipped: 0 });
    expect(await readPdfText(second.bytes)).toEqual(before);
    const doc = await PDFDocument.load(second.bytes);
    const notes = noteAnnots(doc);
    expect(notes).toHaveLength(2);
    const root = notes.find((note) => textOf(note.dict, "Contents") === "Gốc đã sửa")!;
    expect(root.ref.objectNumber).toBe(rootBefore.ref.objectNumber);
    const child = notes.find((note) => textOf(note.dict, "Contents") === "Con")!;
    expect((child.dict.get(PDFName.of("IRT")) as PDFRef).objectNumber).toBe(root.ref.objectNumber);

    const stale = await applyPdfEditBytes(second.bytes, [
      { op: "editSavedNote", attributes: { pageIndex: 0, objNum: root.ref.objectNumber, rect: RECT, oldContents: "Gốc", contents: "không khớp" } },
    ]);
    expect(stale.report.noteEdits).toEqual({ applied: 0, skipped: 1 });
    expect(stale.warnings).toEqual([{ code: "edit_skipped", detail: "note-edit page=1: note was not found in the file" }]);
  });

  it("accepts the upstream editSavedNote annot shape", async () => {
    const first = await applyPdfEditBytes(await fixture(), [addNoteOp({ pageIndex: 0, rect: RECT, contents: "Gốc" })]);
    const doc = await PDFDocument.load(first.bytes);
    const root = noteAnnots(doc)[0]!;
    const second = await applyPdfEditBytes(first.bytes, [
      { op: "editSavedNote", attributes: { annot: { pageIndex: 0, objNum: root.ref.objectNumber, rect: RECT, contents: "Gốc" }, contents: "Mới" } },
    ]);
    expect(second.report.noteEdits).toEqual({ applied: 1, skipped: 0 });
    expect(textOf(noteAnnots(await PDFDocument.load(second.bytes))[0]!.dict, "Contents")).toBe("Mới");
  });

  it("resolves and unresolves a saved note with the PDF review state model", async () => {
    const first = await applyPdfEditBytes(await fixture(), [addNoteOp({ pageIndex: 0, rect: RECT, contents: CONTENTS })]);
    const doc = await PDFDocument.load(first.bytes);
    const note = noteAnnots(doc)[0]!;
    const identity = { pageIndex: 0, objNum: note.ref.objectNumber, rect: RECT, contents: CONTENTS };
    const resolved = await applyPdfEditBytes(first.bytes, [
      { op: "resolveNote", attributes: { ...identity, resolved: true } },
    ]);
    expect(resolved.report.noteResolves).toEqual({ applied: 1, skipped: 0 });
    const resolvedDoc = await PDFDocument.load(resolved.bytes);
    const resolvedNote = noteAnnots(resolvedDoc)[0]!;
    expect(resolvedNote.dict.get(PDFName.of("State"))?.toString()).toBe("/Completed");
    expect(resolvedNote.dict.get(PDFName.of("StateModel"))?.toString()).toBe("/Review");
    const unresolve = await applyPdfEditBytes(resolved.bytes, [
      { op: "resolveNote", attributes: { ...identity, resolved: false } },
    ]);
    expect(unresolve.report.noteResolves).toEqual({ applied: 1, skipped: 0 });
    expect(noteAnnots(await PDFDocument.load(unresolve.bytes))[0]!.dict.get(PDFName.of("State"))?.toString()).toBe("/None");
  });

  it("reports per-note skips for missing notes and out-of-range pages", async () => {
    const input = await fixture();
    const out = await applyPdfEditBytes(input, [
      { op: "editSavedNote", attributes: { pageIndex: 0, objNum: 1, rect: RECT, oldContents: "x", contents: "y" } },
      { op: "resolveNote", attributes: { pageIndex: 9, objNum: 1, rect: RECT, contents: "x", resolved: true } },
      addNoteOp({ pageIndex: 9, rect: RECT, contents: "x" }),
    ]);
    expect(out.report.noteEdits).toEqual({ applied: 0, skipped: 1 });
    expect(out.report.noteResolves).toEqual({ applied: 0, skipped: 1 });
    expect(out.report.notes).toEqual({ applied: 0, skipped: 1 });
    expect(out.warnings.map((warning) => warning.detail)).toEqual([
      "note page=10: page out of range",
      "note-edit page=1: note was not found in the file",
      "note-resolve page=10: page out of range",
    ]);
  });

  it("refuses malformed note ops with typed field errors", async () => {
    const input = await fixture();
    const refusal = (op: string, field: string) => ({ code: "engine_result_invalid", reason: expect.stringContaining(`bad_op:${op}.${field}`) });
    await expect(applyPdfEditBytes(input, [addNoteOp({ pageIndex: 0, rect: RECT, contents: "   " })])).rejects.toMatchObject(refusal("addNote", "contents"));
    await expect(applyPdfEditBytes(input, [addNoteOp({ pageIndex: 0, rect: [40, 200, 40, 220], contents: "x" })])).rejects.toMatchObject(refusal("addNote", "rect"));
    await expect(applyPdfEditBytes(input, [addNoteOp({ pageIndex: 0, rect: RECT, contents: "x", replyTo: { rect: RECT, contents: "y" } })])).rejects.toMatchObject(refusal("addNote", "replyTo.objNum"));
    await expect(applyPdfEditBytes(input, [addNoteOp({ pageIndex: 0, rect: RECT, contents: "x", replyTo: { objNum: 1, rect: RECT, contents: "y" }, replyToLocalId: "z" })])).rejects.toMatchObject(refusal("addNote", "replyTo"));
    await expect(applyPdfEditBytes(input, [{ op: "editSavedNote", attributes: { pageIndex: 0, objNum: 1, rect: RECT, oldContents: "", contents: "y" } }])).rejects.toMatchObject(refusal("editSavedNote", "oldContents"));
    await expect(applyPdfEditBytes(input, [{ op: "resolveNote", attributes: { pageIndex: 0, objNum: 1, rect: RECT, contents: "x" } }])).rejects.toMatchObject(refusal("resolveNote", "resolved"));
  });

  it("accumulates a thread across two saves and reopens as a resolved reply chain", async () => {
    const input = await fixture();
    const before = await readPdfText(input);
    const first = await applyPdfEditBytes(input, [addNoteOp({ pageIndex: 0, rect: RECT, contents: "Gốc" })]);
    const firstDoc = await PDFDocument.load(first.bytes);
    const root = noteAnnots(firstDoc)[0]!;
    const second = await applyPdfEditBytes(first.bytes, [
      addNoteOp({ pageIndex: 0, rect: RECT, contents: "Trả lời", replyTo: { objNum: root.ref.objectNumber, rect: RECT, contents: "Gốc" } }),
      { op: "editSavedNote", attributes: { pageIndex: 0, objNum: root.ref.objectNumber, rect: RECT, oldContents: "Gốc", contents: "Gốc đã sửa" } },
      { op: "resolveNote", attributes: { pageIndex: 0, objNum: root.ref.objectNumber, rect: RECT, contents: "Gốc đã sửa", resolved: true } },
    ]);
    expect(first.report.notes).toEqual({ applied: 1, skipped: 0 });
    expect(second.report.notes).toEqual({ applied: 1, skipped: 0 });
    expect(second.report.noteEdits).toEqual({ applied: 1, skipped: 0 });
    expect(second.report.noteResolves).toEqual({ applied: 1, skipped: 0 });
    const doc = await PDFDocument.load(second.bytes);
    const notes = noteAnnots(doc);
    expect(notes).toHaveLength(2);
    const editedRoot = notes.find((note) => textOf(note.dict, "Contents") === "Gốc đã sửa")!;
    const reply = notes.find((note) => textOf(note.dict, "Contents") === "Trả lời")!;
    expect(editedRoot.dict.get(PDFName.of("State"))?.toString()).toBe("/Completed");
    expect((reply.dict.get(PDFName.of("IRT")) as PDFRef).objectNumber).toBe(editedRoot.ref.objectNumber);
    expect(await readPdfText(second.bytes)).toEqual(before);
  });
});
