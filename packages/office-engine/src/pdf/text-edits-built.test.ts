// Text edits on documents built inside the test: a blank page plus runs inserted
// with the bundled Noto Sans, so the embedded subset is deterministic on every
// machine. Covers inherited strokes, tilted text, transparent fills, kept-object
// recolouring and the relabelling of CFF font programs.
import { PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { applyTextEdits, validateTextEdits } from "./text.ts";
import { applyTextInserts } from "./text-insert.ts";
import { relabelOpenTypeFontFiles } from "./text-build.ts";
import { loadPdfium, saveDoc, withDocument } from "./pdfium.ts";
import { FPDF_PAGEOBJ_TEXT } from "./pdfium.ts";
import { collectTextObjects } from "./text-match.ts";
import type { PageTextObj } from "./text-match.ts";
import { readPdfText } from "./extract.ts";
import type { TextEditInput, TextInsertInput } from "./types.ts";

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  return doc.save();
}

async function withRuns(runs: Partial<TextInsertInput>[]): Promise<Uint8Array> {
  const res = await applyTextInserts(
    await blankPdf(),
    runs.map((r) => ({
      pageIndex: 0,
      origin: [50, 200] as [number, number],
      text: "x",
      fontSize: 14,
      color: [0, 0, 0] as [number, number, number],
      font: "noto",
      ...r,
    })),
  );
  expect(res.skipped).toEqual([]);
  return res.bytes;
}

async function objectsOf(bytes: Uint8Array): Promise<PageTextObj[]> {
  const m = await loadPdfium();
  return withDocument(m, bytes, async (doc) => {
    const page = m._FPDF_LoadPage(doc, 0);
    const tp = m._FPDFText_LoadPage(page);
    try {
      return collectTextObjects(m, page, tp).map((o) => ({ ...o }));
    } finally {
      m._FPDFText_ClosePage(tp);
      m._FPDF_ClosePage(page);
    }
  });
}

interface Ink {
  text: string;
  fill: [number, number, number, number];
  stroke: [number, number, number, number] | null;
  mode: number;
  strokeWidth: number;
}

/** Fill/stroke attributes of every text object, read straight from pdfium. */
async function inkOf(bytes: Uint8Array): Promise<Ink[]> {
  const m = await loadPdfium();
  return withDocument(m, bytes, async (doc) => {
    const page = m._FPDF_LoadPage(doc, 0);
    const tp = m._FPDFText_LoadPage(page);
    const buf = m._malloc(32);
    try {
      const out: Ink[] = [];
      for (const o of collectTextObjects(m, page, tp)) {
        const read = (fn: (p: number, a: number, b: number, c: number, d: number) => number) =>
          fn(buf, buf + 4, buf + 8, buf + 12, 0)
            ? ([0, 4, 8, 12].map((k) => m.HEAPU8[buf + k]!) as [number, number, number, number])
            : null;
        const fill = read((r, g, b, a) => m._FPDFPageObj_GetFillColor(o.obj, r, g, b, a))!;
        const stroke = read((r, g, b, a) => m._FPDFPageObj_GetStrokeColor(o.obj, r, g, b, a));
        const mode = m._FPDFTextObj_GetTextRenderMode(o.obj);
        const strokeWidth = m._FPDFPageObj_GetStrokeWidth(o.obj, buf + 16) ? m.HEAPF32[(buf + 16) >> 2]! : 0;
        out.push({ text: o.text, fill, stroke, mode, strokeWidth });
      }
      return out;
    } finally {
      m._free(buf);
      m._FPDFText_ClosePage(tp);
      m._FPDF_ClosePage(page);
    }
  });
}

/** Apply `mutate` to every text object of the page and save (test-side document surgery). */
async function mutateText(
  bytes: Uint8Array,
  mutate: (m: Awaited<ReturnType<typeof loadPdfium>>, obj: number) => void,
): Promise<Uint8Array> {
  const m = await loadPdfium();
  return withDocument(m, bytes, async (doc) => {
    const page = m._FPDF_LoadPage(doc, 0);
    try {
      const n = m._FPDFPage_CountObjects(page);
      for (let i = 0; i < n; i++) {
        const obj = m._FPDFPage_GetObject(page, i);
        if (m._FPDFPageObj_GetType(obj) === FPDF_PAGEOBJ_TEXT) mutate(m, obj);
      }
      expect(m._FPDFPage_GenerateContent(page)).toBeTruthy();
    } finally {
      m._FPDF_ClosePage(page);
    }
    return saveDoc(m, doc);
  });
}

const rectOf = (o: PageTextObj): [number, number, number, number] => [
  o.bounds[0] - 1,
  o.bounds[1] - 1,
  o.bounds[2] + 1,
  o.bounds[3] + 1,
];

const edit = (over: Partial<TextEditInput>): TextEditInput => ({
  pageIndex: 0,
  rect: [0, 0, 400, 300],
  oldText: "",
  newText: "",
  fontSize: 14,
  ...over,
});

const textOfPage = async (bytes: Uint8Array) => (await readPdfText(bytes)).pages[0]!.text;

describe("edits on a document built from bundled-font runs", () => {
  it("re-edits the embedded subset (no system font involved)", async () => {
    const doc = await withRuns([{ text: "Hello World" }]);
    const res = await applyTextEdits(doc, [
      edit({ rect: rectOf((await objectsOf(doc))[0]!), oldText: "Hello World", newText: "World Hello", newColor: [9, 9, 9] }),
    ]);
    expect(res.skipped).toEqual([]);
    expect(await textOfPage(res.bytes)).toContain("World Hello");
  });
});

describe("inherited strokes", () => {
  it("keeps a synthetic-bold stroke tracking the fill when the run is redrawn", async () => {
    const doc = await withRuns([{ text: "Hello World" }]);
    const first = (await objectsOf(doc))[0]!;
    const bold = await applyTextEdits(doc, [
      edit({ rect: rectOf(first), oldText: "Hello World", newText: "Hello World", newBold: true, newColor: [200, 0, 0] }),
    ]);
    expect(bold.skipped).toEqual([]);
    const [stroked] = await inkOf(bold.bytes);
    expect(stroked!.mode).toBe(2);
    expect(stroked!.stroke!.slice(0, 3)).toEqual([200, 0, 0]);
    // re-edit without any style change: the stroke must survive
    const again = await applyTextEdits(bold.bytes, [
      edit({ rect: rectOf((await objectsOf(bold.bytes))[0]!), oldText: "Hello World", newText: "Hello Earth", newFont: "noto" }),
    ]);
    expect(again.skipped).toEqual([]);
    const [kept] = await inkOf(again.bytes);
    expect(kept!.mode).toBe(2);
    expect(kept!.stroke!.slice(0, 3)).toEqual(kept!.fill.slice(0, 3));
    expect(kept!.strokeWidth).toBeGreaterThan(0);
  });

  it("recolours kept objects and their tracking stroke, and strokes the redrawn tail alike", async () => {
    const doc = await withRuns([{ text: "Hello World" }]);
    const bold = await applyTextEdits(doc, [
      edit({
        rect: rectOf((await objectsOf(doc))[0]!),
        oldText: "Hello World",
        newText: "Hello World",
        newBold: true,
        styleRuns: [{ start: 0, end: 5, color: [255, 0, 0] }],
      }),
    ]);
    expect(bold.skipped).toEqual([]);
    const objs = await objectsOf(bold.bytes);
    expect(objs.length).toBeGreaterThan(1);
    const row: [number, number, number, number] = [
      Math.min(...objs.map((o) => o.bounds[0])) - 1,
      Math.min(...objs.map((o) => o.bounds[1])) - 1,
      Math.max(...objs.map((o) => o.bounds[2])) + 1,
      Math.max(...objs.map((o) => o.bounds[3])) + 1,
    ];
    const res = await applyTextEdits(bold.bytes, [
      edit({ rect: row, oldText: "Hello World", newText: "Hello Mars", newColor: [0, 160, 0] }),
    ]);
    expect(res.skipped).toEqual([]);
    expect(await textOfPage(res.bytes)).toContain("Hello Mars");
    const ink = await inkOf(res.bytes);
    expect(ink.length).toBeGreaterThan(1);
    for (const i of ink) {
      expect(i.fill.slice(0, 3)).toEqual([0, 160, 0]);
      expect(i.mode).toBe(2);
      expect(i.stroke!.slice(0, 3)).toEqual([0, 160, 0]);
    }
  });

  it("carries an authored outline with its own colour and width into the rebuilt run", async () => {
    const doc = await withRuns([{ text: "Outlined" }]);
    const outlined = await mutateText(doc, (m, obj) => {
      m._FPDFTextObj_SetTextRenderMode(obj, 2);
      m._FPDFPageObj_SetStrokeColor(obj, 0, 0, 255, 255);
      m._FPDFPageObj_SetStrokeWidth(obj, 1.5);
    });
    const res = await applyTextEdits(outlined, [
      edit({ rect: rectOf((await objectsOf(outlined))[0]!), oldText: "Outlined", newText: "Outlined", newColor: [10, 10, 10] }),
    ]);
    expect(res.skipped).toEqual([]);
    const [i] = await inkOf(res.bytes);
    expect(i!.mode).toBe(2);
    expect(i!.stroke!.slice(0, 3)).toEqual([0, 0, 255]);
    expect(i!.strokeWidth).toBeCloseTo(1.5, 1);
    expect(i!.fill.slice(0, 3)).toEqual([10, 10, 10]);
  });
});

describe("fills and geometry the rebuild must cope with", () => {
  it("never turns a run with a zero-alpha fill read into invisible text", async () => {
    // A standard-font run drawn through an ExtGState with fill alpha 0 (Chrome-print style)
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 300]);
    page.drawText("Ghost", {
      x: 50,
      y: 200,
      size: 14,
      font: await pdf.embedFont(StandardFonts.Helvetica),
      color: rgb(0, 0, 120 / 255),
      opacity: 0,
    });
    const clear = await pdf.save();
    expect((await inkOf(clear))[0]!.fill[3]).toBe(0);
    const res = await applyTextEdits(clear, [
      edit({ rect: rectOf((await objectsOf(clear))[0]!), oldText: "Ghost", newText: "Ghost", newFont: "noto" }),
    ]);
    expect(res.skipped).toEqual([]);
    const [i] = await inkOf(res.bytes);
    expect(i!.fill).toEqual([0, 0, 120, 255]);
  });

  it("redraws tilted text instead of walking it as horizontal", async () => {
    const doc = await withRuns([{ text: "Tilted line", rotate: 90, origin: [200, 100] }]);
    const [o] = await objectsOf(doc);
    expect(o!.bounds[3] - o!.bounds[1]).toBeGreaterThan(o!.bounds[2] - o!.bounds[0]);
    const res = await applyTextEdits(doc, [
      edit({ rect: rectOf(o!), oldText: "Tilted line", newText: "Tilted text", newColor: [1, 2, 3] }),
    ]);
    expect(res.skipped).toEqual([]);
    expect(await textOfPage(res.bytes)).toContain("Tilted text");
  });

  it("reads kept and redrawn pieces back in reading order after a partial rebuild", async () => {
    const doc = await withRuns([
      { text: "Alpha ", origin: [50, 200] },
      { text: "Beta ", origin: [100, 200] },
      { text: "Gamma", origin: [150, 200] },
    ]);
    const objs = await objectsOf(doc);
    expect(objs).toHaveLength(3);
    const row: [number, number, number, number] = [49, 195, 260, 220];
    const res = await applyTextEdits(doc, [
      {
        pageIndex: 0,
        rect: row,
        oldText: "Alpha Beta Gamma",
        newText: "Alpha Beta Gxmma Delta",
        fontSize: 14,
        styleRuns: [
          { start: 12, end: 14, bold: true },
          { start: 15, end: 22, color: [255, 0, 0] },
        ],
      },
    ]);
    expect(res.skipped).toEqual([]);
    const text = (await textOfPage(res.bytes)).replace(/\s+/g, "");
    expect(text).toBe("AlphaBetaGxmmaDelta");
    // the untouched head objects are still the original ones, in place
    const after = await objectsOf(res.bytes);
    const alpha = after.find((o) => o.text.trim() === "Alpha")!;
    expect(alpha.bounds[0]).toBeCloseTo(objs[0]!.bounds[0], 1);
  });
});

describe("dry run on a document with a coloured run", () => {
  it("reports colour runs by oldText offset, leaving the gap space uncoloured", async () => {
    const doc = await withRuns([
      { text: "Red ", origin: [50, 200], color: [255, 0, 0] },
      { text: "Blue", origin: [90, 200], color: [0, 0, 255] },
    ]);
    const [v] = await validateTextEdits(doc, [edit({ rect: [49, 195, 200, 220], oldText: "Red Blue", newText: "x" })]);
    expect(v!.reason).toBeNull();
    expect(v!.colorRuns).toEqual([
      { start: 0, end: 3, color: [255, 0, 0] },
      { start: 4, end: 8, color: [0, 0, 255] },
    ]);
    expect(v!.baseColor).toEqual([255, 0, 0]);
  });
});

describe("relabelOpenTypeFontFiles", () => {
  async function docWithFontFile(program: Uint8Array): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.addPage();
    const file = doc.context.register(doc.context.stream(program));
    const descriptor = doc.context.register(
      doc.context.obj({ Type: "FontDescriptor", FontName: "AAAAAA+Test", Flags: 4, FontFile: file }),
    );
    doc.catalog.set(PDFName.of("TestFontDescriptor"), descriptor);
    return doc.save({ useObjectStreams: false });
  }
  const fontFileKeys = async (bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes);
    const out: { key: string; subtype?: string }[] = [];
    for (const [, d] of doc.context.enumerateIndirectObjects()) {
      if (!(d instanceof PDFDict) || d.get(PDFName.of("Type")) !== PDFName.of("FontDescriptor")) continue;
      const key = d.get(PDFName.of("FontFile3")) ? "FontFile3" : d.get(PDFName.of("FontFile")) ? "FontFile" : "none";
      const ref = d.get(PDFName.of("FontFile3")) ?? d.get(PDFName.of("FontFile"));
      const stream = ref ? doc.context.lookup(ref as never) : undefined;
      const subtype = stream instanceof PDFRawStream ? String(stream.dict.get(PDFName.of("Subtype"))) : undefined;
      out.push({ key, subtype });
    }
    return out;
  };

  it("moves a CFF-flavoured program from FontFile to FontFile3 /OpenType", async () => {
    const otto = new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 1, 2, 3, 4, 5, 6, 7]);
    const bytes = await docWithFontFile(otto);
    const out = await relabelOpenTypeFontFiles(bytes);
    expect(out).not.toBe(bytes);
    expect(await fontFileKeys(out)).toEqual([{ key: "FontFile3", subtype: "/OpenType" }]);
  });

  it("returns a document whose Type1/TrueType programs are genuine untouched", async () => {
    const truetype = new Uint8Array([0, 1, 0, 0, 9, 9, 9, 9]);
    const bytes = await docWithFontFile(truetype);
    expect(await relabelOpenTypeFontFiles(bytes)).toBe(bytes);
  });

  it("returns the input when no descriptor embeds a program", async () => {
    const bytes = await blankPdf();
    expect(await relabelOpenTypeFontFiles(bytes)).toBe(bytes);
  });
});

describe("bold on the run's own face", () => {
  it("strokes the object in place when the text keeps its glyphs, once", async () => {
    const doc = await withRuns([{ text: "Hello World" }]);
    const rect = rectOf((await objectsOf(doc))[0]!);
    const e1 = edit({ rect, oldText: "Hello World", newText: "Hello World", newBold: true });
    const bold = await applyTextEdits(doc, [e1]);
    expect(bold.skipped).toEqual([]);
    const [i] = await inkOf(bold.bytes);
    expect(i!.mode).toBe(2);
    expect(i!.strokeWidth).toBeGreaterThan(0);
    expect(i!.text.trim()).toBe("Hello World");
    // a second bold request finds the stroke already there and leaves the width alone
    const twice = await applyTextEdits(bold.bytes, [{ ...e1, rect: rectOf((await objectsOf(bold.bytes))[0]!) }]);
    const [j] = await inkOf(twice.bytes);
    expect(j!.strokeWidth).toBeCloseTo(i!.strokeWidth, 3);
  });
});

describe("colours that ride along through later edits", () => {
  const rowRect = async (bytes: Uint8Array): Promise<[number, number, number, number]> => {
    const objs = await objectsOf(bytes);
    return [
      Math.min(...objs.map((o) => o.bounds[0])) - 1,
      Math.min(...objs.map((o) => o.bounds[1])) - 1,
      Math.max(...objs.map((o) => o.bounds[2])) + 1,
      Math.max(...objs.map((o) => o.bounds[3])) + 1,
    ];
  };

  it("keeps a coloured tail when only the head of the run is edited", async () => {
    const doc = await withRuns([{ text: "Hello World" }]);
    const tinted = await applyTextEdits(doc, [
      edit({
        rect: rectOf((await objectsOf(doc))[0]!),
        oldText: "Hello World",
        newText: "Hello World",
        styleRuns: [{ start: 6, end: 11, color: [255, 0, 0] }],
      }),
    ]);
    expect(tinted.skipped).toEqual([]);
    const res = await applyTextEdits(tinted.bytes, [
      edit({ rect: await rowRect(tinted.bytes), oldText: "Hello World", newText: "Jello World" }),
    ]);
    expect(res.skipped).toEqual([]);
    expect(await textOfPage(res.bytes)).toContain("Jello");
    const ink = await inkOf(res.bytes);
    const world = ink.find((i) => i.text.includes("World"))!;
    expect(world.fill.slice(0, 3)).toEqual([255, 0, 0]);
  });

  it("opens and closes a gap at the tail seam of a run", async () => {
    const doc = await withRuns([
      { text: "Alpha ", origin: [50, 200] },
      { text: "Beta ", origin: [100, 200] },
      { text: "Gamma", origin: [150, 200] },
    ]);
    const rect: [number, number, number, number] = [49, 195, 260, 220];
    const closed = await applyTextEdits(doc, [
      edit({ rect, oldText: "Alpha Beta Gamma", newText: "Alpha BetaGamma" }),
    ]);
    expect(closed.skipped).toEqual([]);
    expect((await textOfPage(closed.bytes)).replace(/\s+/g, "")).toBe("AlphaBetaGamma");
    const opened = await applyTextEdits(doc, [
      edit({ rect, oldText: "Alpha Beta Gamma", newText: "Alpha Beta Gam ma" }),
    ]);
    expect(opened.skipped).toEqual([]);
    expect((await textOfPage(opened.bytes))).toContain("Gam ma");
  });
});
