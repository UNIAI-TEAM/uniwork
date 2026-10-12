// Saved-annotation deletes through real pdfium: guarded identity (objNum hint,
// subtype, rect, contents), the match fallback after renumbering, and the
// fail-soft skips. Fixtures are built in the test with pdf-lib.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFRef } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { applyAnnotDeletes } from "./annots";
import { readPdfText } from "./extract";
import type { AnnotDeleteInput } from "./types";

const FIXTURES = fileURLToPath(new URL("../../../../docs/office/g0/fixtures/files/pdf/", import.meta.url));
const TEXT_PDF = () => new Uint8Array(readFileSync(FIXTURES + "pdf-text-editable.pdf"));

type Rect = [number, number, number, number];
interface Seeded {
  subtype: "Text" | "Highlight" | "Underline" | "StrikeOut";
  rect: Rect;
  contents?: string;
}
interface Built {
  bytes: Uint8Array;
  refs: PDFRef[];
}

/** The text fixture with the given annotations on page 0, in order. */
async function withAnnots(seeded: Seeded[]): Promise<Built> {
  const doc = await PDFDocument.load(TEXT_PDF());
  const page = doc.getPage(0)!;
  const annots = doc.context.obj([]) as PDFArray;
  page.node.set(PDFName.of("Annots"), annots);
  const refs: PDFRef[] = [];
  for (const s of seeded) {
    const [x1, y1, x2, y2] = s.rect;
    const dict: Record<string, unknown> = { Type: "Annot", Subtype: s.subtype, Rect: s.rect };
    if (s.contents !== undefined) dict.Contents = PDFHexString.fromText(s.contents);
    if (s.subtype !== "Text") dict.QuadPoints = [x1, y2, x2, y2, x1, y1, x2, y1];
    const ref = doc.context.register(doc.context.obj(dict as never));
    annots.push(ref);
    refs.push(ref);
  }
  return { bytes: await doc.save(), refs };
}

/** Annotations left on page 0 of `bytes`, as [subtype, contents]. */
async function remaining(bytes: Uint8Array): Promise<[string, string | undefined][]> {
  const doc = await PDFDocument.load(bytes);
  const raw = doc.getPage(0)!.node.get(PDFName.of("Annots"));
  if (!raw) return [];
  const arr = doc.context.lookup(raw, PDFArray);
  const out: [string, string | undefined][] = [];
  for (let i = 0; i < arr.size(); i++) {
    const d = doc.context.lookup(arr.get(i)) as unknown as { get(n: PDFName): { decodeText?: () => string; asString?: () => string } | undefined };
    const sub = d.get(PDFName.of("Subtype"))!.asString!().replace("/", "");
    const c = d.get(PDFName.of("Contents"));
    out.push([sub, c?.decodeText?.()]);
  }
  return out;
}

const NOTE_RECT: Rect = [50, 700, 70, 720];
const HL_RECT: Rect = [100, 600, 220, 616];

describe("applyAnnotDeletes", () => {
  it("removes a note by object number and identity, leaving the other annotations", async () => {
    const built = await withAnnots([
      { subtype: "Text", rect: NOTE_RECT, contents: "keep" },
      { subtype: "Text", rect: [150, 700, 170, 720], contents: "drop me" },
    ]);
    const del: AnnotDeleteInput = {
      pageIndex: 0,
      objNum: built.refs[1]!.objectNumber,
      subtype: "note",
      rect: [150, 700, 170, 720],
      contents: "drop me",
    };
    const out = await applyAnnotDeletes(built.bytes, [del]);
    expect(out).toMatchObject({ removed: 1, skipped: [] });
    expect(await remaining(out.bytes)).toEqual([["Text", "keep"]]);
  });

  it("falls back to scanning when the object number is stale, and tells notes of one rect apart by contents", async () => {
    const built = await withAnnots([
      { subtype: "Text", rect: NOTE_RECT, contents: "root" },
      { subtype: "Text", rect: NOTE_RECT, contents: "reply" },
    ]);
    const out = await applyAnnotDeletes(built.bytes, [
      { pageIndex: 0, objNum: 99999, subtype: "note", rect: NOTE_RECT, contents: "reply" },
    ]);
    expect(out.removed).toBe(1);
    expect(await remaining(out.bytes)).toEqual([["Text", "root"]]);
  });

  it("does not delete through a hint number that now points at another annotation", async () => {
    const built = await withAnnots([
      { subtype: "Text", rect: NOTE_RECT, contents: "first" },
      { subtype: "Text", rect: [150, 700, 170, 720], contents: "second" },
    ]);
    // The hint names "second" but the identity fields describe "first": the guard refuses the
    // hint, and the scan removes only the annotation that really matches.
    const out = await applyAnnotDeletes(built.bytes, [
      { pageIndex: 0, objNum: built.refs[1]!.objectNumber, subtype: "note", rect: NOTE_RECT, contents: "first" },
    ]);
    expect(out.removed).toBe(1);
    expect(await remaining(out.bytes)).toEqual([["Text", "second"]]);
  });

  it("matches a note by its top-left corner when its icon rect was resized", async () => {
    const built = await withAnnots([{ subtype: "Text", rect: NOTE_RECT, contents: "n" }]);
    const out = await applyAnnotDeletes(built.bytes, [
      { pageIndex: 0, objNum: 99999, subtype: "note", rect: [50, 690, 90, 720], contents: "n" },
    ]);
    expect(out.removed).toBe(1);
    expect(await remaining(out.bytes)).toEqual([]);
  });

  it("removes highlight, underline and strikeout markups by subtype and rect", async () => {
    const built = await withAnnots([
      { subtype: "Highlight", rect: HL_RECT },
      { subtype: "Underline", rect: [100, 500, 220, 516] },
      { subtype: "StrikeOut", rect: [100, 400, 220, 416] },
    ]);
    const out = await applyAnnotDeletes(built.bytes, [
      { pageIndex: 0, objNum: 99999, subtype: "highlight", rect: [100.5, 600, 220, 616.5] },
      { pageIndex: 0, objNum: built.refs[1]!.objectNumber, subtype: "underline", rect: [100, 500, 220, 516] },
      { pageIndex: 0, objNum: 99999, subtype: "strikeout", rect: [100, 400, 220, 416] },
    ]);
    expect(out).toMatchObject({ removed: 3, skipped: [] });
    expect(await remaining(out.bytes)).toEqual([]);
  });

  it("skips entries whose subtype, rect or contents do not match, and keeps the input bytes", async () => {
    const built = await withAnnots([
      { subtype: "Highlight", rect: HL_RECT },
      { subtype: "Text", rect: NOTE_RECT, contents: "real" },
    ]);
    const out = await applyAnnotDeletes(built.bytes, [
      { pageIndex: 0, objNum: built.refs[0]!.objectNumber, subtype: "underline", rect: HL_RECT },
      { pageIndex: 0, objNum: 99999, subtype: "highlight", rect: [100, 600, 260, 616] },
      { pageIndex: 0, objNum: built.refs[1]!.objectNumber, subtype: "note", rect: NOTE_RECT, contents: "other" },
    ]);
    expect(out.removed).toBe(0);
    expect(out.bytes).toBe(built.bytes);
    expect(out.skipped).toEqual([
      { pageIndex: 0, reason: "no matching annotation" },
      { pageIndex: 0, reason: "no matching annotation" },
      { pageIndex: 0, reason: "no matching annotation" },
    ]);
  });

  it("skips entries on missing pages but still applies the valid ones", async () => {
    const built = await withAnnots([{ subtype: "Highlight", rect: HL_RECT }]);
    const out = await applyAnnotDeletes(built.bytes, [
      { pageIndex: 7, objNum: 1, subtype: "highlight", rect: HL_RECT },
      { pageIndex: -1, objNum: 1, subtype: "highlight", rect: HL_RECT },
      { pageIndex: 0, objNum: built.refs[0]!.objectNumber, subtype: "highlight", rect: HL_RECT },
    ]);
    expect(out.removed).toBe(1);
    expect(out.skipped).toEqual([
      { pageIndex: 7, reason: "page out of range" },
      { pageIndex: -1, reason: "page out of range" },
    ]);
    expect(await remaining(out.bytes)).toEqual([]);
  });

  it("does not disturb the page text when annotations are deleted", async () => {
    const built = await withAnnots([{ subtype: "Highlight", rect: HL_RECT }]);
    const out = await applyAnnotDeletes(built.bytes, [
      { pageIndex: 0, objNum: built.refs[0]!.objectNumber, subtype: "highlight", rect: HL_RECT },
    ]);
    const before = await readPdfText(TEXT_PDF());
    const after = await readPdfText(out.bytes);
    expect(after.pages.map((p) => p.text)).toEqual(before.pages.map((p) => p.text));
  });

  it("is a no-op for an empty delete list", async () => {
    const input = TEXT_PDF();
    const out = await applyAnnotDeletes(input, []);
    expect(out).toEqual({ bytes: input, removed: 0, skipped: [] });
  });
});
