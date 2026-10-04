import { PDFName, PDFRef, PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { readPdfNotes } from "./notes-reader";
import { applyPdfOpsInBrowser } from "./pdf";

async function fixture(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300 + i * 10, 300]);
  return doc.save();
}

const RECT: [number, number, number, number] = [40, 200, 60, 220];

describe("readPdfNotes", () => {
  it("round-trips an added note: page, rect, contents and author come back", async () => {
    const out = await applyPdfOpsInBrowser(await fixture(), [
      { op: "addNote", attributes: { note: { pageIndex: 0, rect: RECT, contents: "Ghi chú tiếng Việt", author: "Nguyễn An" } } },
    ]);
    const read = await readPdfNotes(out.bytes);
    expect(read.skipped).toEqual([]);
    expect(read.threads).toHaveLength(1);
    const root = read.threads[0]!.root;
    expect(root).toMatchObject({ page: 1, pageIndex: 0, rect: RECT, contents: "Ghi chú tiếng Việt", author: "Nguyễn An" });
    expect(root.id).toBe(`${root.pageIndex}:${root.objNum}`);
    expect(root.resolved).toBeUndefined();
    expect(read.threads[0]!.replies).toEqual([]);
  });

  it("reports a resolved note as resolved and an unresolved one without the flag", async () => {
    const first = await applyPdfOpsInBrowser(await fixture(), [
      { op: "addNote", attributes: { note: { pageIndex: 0, rect: RECT, contents: "Cần xử lý" } } },
    ]);
    const doc = await PDFDocument.load(first.bytes);
    const ref = doc.getPage(0).node.Annots()!.get(0) as PDFRef;
    const resolved = await applyPdfOpsInBrowser(first.bytes, [
      { op: "resolveNote", attributes: { pageIndex: 0, objNum: ref.objectNumber, rect: RECT, contents: "Cần xử lý", resolved: true } },
    ]);
    const read = await readPdfNotes(resolved.bytes);
    expect(read.threads[0]!.root.resolved).toBe(true);
  });

  it("groups replies under their /IRT root", async () => {
    const first = await applyPdfOpsInBrowser(await fixture(2), [
      { op: "addNote", attributes: { note: { pageIndex: 1, rect: RECT, contents: "Gốc", author: "An" } } },
    ]);
    const doc = await PDFDocument.load(first.bytes);
    const rootRef = doc.getPage(1).node.Annots()!.get(0) as PDFRef;
    const second = await applyPdfOpsInBrowser(first.bytes, [
      { op: "addNote", attributes: { note: { pageIndex: 1, rect: RECT, contents: "Trả lời", author: "Bình", replyTo: { objNum: rootRef.objectNumber, rect: RECT, contents: "Gốc" } } } },
    ]);
    const read = await readPdfNotes(second.bytes);
    expect(read.skipped).toEqual([]);
    expect(read.threads).toHaveLength(1);
    const thread = read.threads[0]!;
    expect(thread.root.contents).toBe("Gốc");
    expect(thread.root.page).toBe(2);
    expect(thread.replies.map((reply) => reply.contents)).toEqual(["Trả lời"]);
    expect(thread.replies[0]!.page).toBe(2);
    expect(thread.replies[0]!.author).toBe("Bình");
  });

  it("returns no threads for a document without notes", async () => {
    expect(await readPdfNotes(await fixture())).toEqual({ threads: [], skipped: [] });
  });

  it("skips a Text annotation with no valid /Rect with a typed reason", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const annot = doc.context.obj({ Type: "Annot", Subtype: "Text", Contents: "no rect" });
    page.node.addAnnot(doc.context.register(annot));
    const read = await readPdfNotes(await doc.save());
    expect(read.threads).toEqual([]);
    expect(read.skipped).toHaveLength(1);
    expect(read.skipped[0]!.reason).toContain("/Rect");
  });

  it("skips a reply whose /IRT parent is not a saved note", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const orphan = doc.context.obj({
      Type: "Annot", Subtype: "Text", Rect: [40, 200, 60, 220], Contents: "mồ côi",
      IRT: PDFRef.of(9999), RT: PDFName.of("R"),
    });
    page.node.addAnnot(doc.context.register(orphan));
    const read = await readPdfNotes(await doc.save());
    expect(read.threads).toEqual([]);
    expect(read.skipped).toHaveLength(1);
    expect(read.skipped[0]!.reason).toBe("reply parent note was not found in the file");
  });
});
