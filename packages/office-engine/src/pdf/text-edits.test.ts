// End-to-end text replacement on real pdfium documents: reuse vs rebuild of the
// font, styles, multi-line, Vietnamese, keep-plan, deletes, moves, skips and the
// dry-run / read-back verification. Fixtures are the repo's G0 PDFs; rebuilds
// that need a face use the bundled Noto Sans ("noto") or the document's own
// embedded subset, never a system font.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { applyTextEdits, validateTextEdits, verifyTextEdits } from "./text.ts";
import { loadPdfium, withDocument } from "./pdfium.ts";
import { collectTextObjects } from "./text-match.ts";
import type { PageTextObj } from "./text-match.ts";
import { readPdfText } from "./extract.ts";
import type { TextEditInput } from "./types.ts";

const FIXTURES = fileURLToPath(
  new URL("../../../../docs/office/g0/fixtures/files/pdf/", import.meta.url),
);
const fixture = (name: string) => new Uint8Array(readFileSync(FIXTURES + name));
const TEXT_PDF = () => fixture("pdf-text-editable.pdf");
const TABLE_PDF = () => fixture("pdf-table.pdf");

/** Text objects of one page of `bytes`, as the engine sees them. */
async function objectsOf(bytes: Uint8Array, pageIndex = 0): Promise<PageTextObj[]> {
  const m = await loadPdfium();
  return withDocument(m, bytes, async (doc) => {
    const page = m._FPDF_LoadPage(doc, pageIndex);
    const tp = m._FPDFText_LoadPage(page);
    try {
      return collectTextObjects(m, page, tp).map((o) => ({ ...o }));
    } finally {
      m._FPDFText_ClosePage(tp);
      m._FPDF_ClosePage(page);
    }
  });
}

const pageText = async (bytes: Uint8Array, pageIndex = 0) =>
  (await readPdfText(bytes)).pages[pageIndex]!.text;

const textOf = async (bytes: Uint8Array, pageIndex = 0) =>
  (await objectsOf(bytes, pageIndex)).map((o) => o.text);

// Rects and sizes of the fixture's runs (read off the engine's bounds).
const TITLE = { rect: [73, 776, 311, 793] as [number, number, number, number], text: "Bao cao tong hop nam 2026" };
const LINE2 = {
  rect: [72, 737, 526, 748] as [number, number, number, number],
  text: "Tai lieu kiem thu tieng Viet: dau huyen, sac, hoi, nga, nang; chu D va d; to hop u, o, a, a, e, o.",
};
const LINE3 = { rect: [72, 717, 380, 728] as [number, number, number, number], text: "Doan van thu hai: noi dung phai sua duoc trong lop chu co san." };

const e = (over: Partial<TextEditInput>): TextEditInput => ({
  pageIndex: 0,
  rect: TITLE.rect,
  oldText: TITLE.text,
  newText: TITLE.text,
  fontSize: 14,
  ...over,
});

describe("applyTextEdits — one run, font reuse and rebuild", () => {
  it("re-encodes in place when every glyph already exists in the run's face", async () => {
    const input = TEXT_PDF();
    const out = await applyTextEdits(input, [e({ newText: "Bao cao tong hop nam 0620" })]);
    expect(out.skipped).toEqual([]);
    expect(out.bytes).not.toBe(input);
    const objs = await textOf(out.bytes);
    expect(objs).toContain("Bao cao tong hop nam 0620");
    expect(objs).not.toContain(TITLE.text);
    // the run keeps its place in the stream
    expect((await objectsOf(out.bytes))[0]!.text).toBe("Bao cao tong hop nam 0620");
  });

  it("rebuilds with the embedded subset when a style forces new objects", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [e({ newColor: [200, 0, 0] })]);
    expect(out.skipped).toEqual([]);
    expect(await textOf(out.bytes)).toContain(TITLE.text);
  });

  it("rebuilds with a glyph the original subset lacks", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [e({ newText: "Bao cao tong hop nam 2027", newFont: "noto" })]);
    expect(out.skipped).toEqual([]);
    expect(await pageText(out.bytes)).toContain("nam 2027");
  });

  it("writes Vietnamese with diacritics through the bundled font", async () => {
    const vi = "Báo cáo tổng hợp năm 2026 — Tiếng Việt đầy đủ dấu";
    const out = await applyTextEdits(TEXT_PDF(), [e({ newText: vi, newFont: "noto" })]);
    expect(out.skipped).toEqual([]);
    const text = await pageText(out.bytes);
    expect(text).toContain("Báo cáo tổng hợp năm 2026");
    expect(text).toContain("Tiếng Việt đầy đủ dấu");
  });

  it("applies a new size, colour, bold and italic to the rebuilt run", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [
      e({ newFont: "noto", newFontSize: 20, newColor: [10, 20, 30], newBold: true, newItalic: true }),
    ]);
    expect(out.skipped).toEqual([]);
    const title = (await objectsOf(out.bytes)).find((o) => o.text === TITLE.text)!;
    expect(title).toBeDefined();
    // 20pt text is taller than the original 14pt run
    expect(title.bounds[3] - title.bounds[1]).toBeGreaterThan(16.9);
  });

  it("emboldens the original face with a stroke when bold is toggled", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [e({ newBold: true })]);
    expect(out.skipped).toEqual([]);
    expect(await textOf(out.bytes)).toContain(TITLE.text);
  });
});

describe("applyTextEdits — multi-line", () => {
  it("rebuilds one object per line and steps down by the leading", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [
      {
        pageIndex: 0,
        rect: LINE3.rect,
        oldText: LINE3.text,
        newText: "Doan van moi\ndong thu hai\ndong thu ba",
        fontSize: 10,
        newFont: "noto",
        lineLeading: 14,
        origin: [72, 718],
      },
    ]);
    expect(out.skipped).toEqual([]);
    const objs = await objectsOf(out.bytes);
    const lines = ["Doan van moi", "dong thu hai", "dong thu ba"].map((t) => objs.find((o) => o.text === t));
    expect(lines.every(Boolean)).toBe(true);
    const ys = lines.map((o) => o!.bounds[1]);
    expect(ys[0]! - ys[1]!).toBeGreaterThan(10);
    expect(ys[1]! - ys[2]!).toBeGreaterThan(10);
  });

  it("offsets each line by its own x when the block is aligned", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [
      {
        pageIndex: 0,
        rect: LINE3.rect,
        oldText: LINE3.text,
        newText: "short\nmuch longer line",
        fontSize: 10,
        newFont: "noto",
        origin: [72, 718],
        lineLeading: 12,
        lineXOffsets: [0, 40],
        align: "left",
      },
    ]);
    const objs = await objectsOf(out.bytes);
    expect(out.skipped).toEqual([]);
    const a = objs.find((o) => o.text.trim() === "short")!;
    const b = objs.find((o) => o.text.trim() === "much longer line")!;
    expect(b.bounds[0] - a.bounds[0]).toBeGreaterThan(35);
  });
});

describe("applyTextEdits — selection styles", () => {
  it("splits a line at style boundaries into several objects", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [
      e({
        newText: "Bao cao tong hop nam 2026",
        newFont: "noto",
        styleRuns: [
          { start: 0, end: 3, color: [255, 0, 0], bold: true },
          { start: 4, end: 7, size: 20, italic: true },
        ],
      }),
    ]);
    expect(out.skipped).toEqual([]);
    const parts = (await textOf(out.bytes)).filter((t) => TITLE.text.includes(t.trim()) && t.trim() !== "");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("").replace(/\s+/g, "")).toBe(TITLE.text.replace(/\s+/g, ""));
  });

  it("accepts the legacy colorRuns form", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [
      e({ newFont: "noto", colorRuns: [{ start: 0, end: 3, color: [0, 128, 0] }] }),
    ]);
    expect(out.skipped).toEqual([]);
    expect((await textOf(out.bytes)).length).toBeGreaterThan(5);
  });
});

describe("applyTextEdits — keep plan on a multi-object line", () => {
  const ROW = { rect: [72, 727, 402, 738] as [number, number, number, number], old: "Hang muc Quy I Quy II" };

  it("redraws only the edited tail and translates the untouched objects in place", async () => {
    const before = await objectsOf(TABLE_PDF());
    const quy1 = before.find((o) => o.text === "Quy I ")!;
    const out = await applyTextEdits(TABLE_PDF(), [
      { pageIndex: 0, rect: ROW.rect, oldText: ROW.old, newText: "Hang muc Quy I Quy III", fontSize: 10 },
    ]);
    expect(out.skipped).toEqual([]);
    const after = await objectsOf(out.bytes);
    const kept = after.find((o) => o.text === "Quy I ")!;
    expect(kept).toBeDefined();
    expect(kept.bounds[0]).toBeCloseTo(quy1.bounds[0], 1);
    expect(after.some((o) => o.text === "Hang muc ")).toBe(true);
    expect(after.some((o) => o.text.includes("Quy III") || o.text.trim() === "III" || o.text.includes("II"))).toBe(true);
    expect(await pageText(out.bytes)).toContain("Quy III");
  });

  it("closes a gap when only whitespace changes at a seam", async () => {
    const out = await applyTextEdits(TABLE_PDF(), [
      { pageIndex: 0, rect: ROW.rect, oldText: ROW.old, newText: "Hangmuc Quy I Quy II", fontSize: 10 },
    ]);
    expect(out.skipped).toEqual([]);
    expect(await pageText(out.bytes)).toContain("Hangmuc");
  });

  it("repaints a uniform colour over the kept objects", async () => {
    const out = await applyTextEdits(TABLE_PDF(), [
      { pageIndex: 0, rect: ROW.rect, oldText: ROW.old, newText: "Hang muc Quy I Quy IV", fontSize: 10, newColor: [200, 0, 0] },
    ]);
    expect(out.skipped).toEqual([]);
    expect(await pageText(out.bytes)).toContain("Quy IV");
  });

  it("keeps different colours of an earlier selection-colour edit through the next edit", async () => {
    const first = await applyTextEdits(TABLE_PDF(), [
      {
        pageIndex: 0,
        rect: ROW.rect,
        oldText: ROW.old,
        newText: ROW.old,
        fontSize: 10,
        styleRuns: [{ start: 0, end: 4, color: [255, 0, 0] }],
      },
    ]);
    expect(first.skipped).toEqual([]);
    // the dry run reads the saved colours back out of the run
    const [v] = await validateTextEdits(first.bytes, [
      { pageIndex: 0, rect: ROW.rect, oldText: ROW.old, newText: ROW.old, fontSize: 10 },
    ]);
    expect(v!.reason).toBeNull();
    expect(v!.colorRuns?.some((r) => r.color[0] === 255 && r.color[1] === 0)).toBe(true);
    expect(v!.baseColor).toBeDefined();
    // a following text edit keeps the red head instead of flattening it
    const second = await applyTextEdits(first.bytes, [
      { pageIndex: 0, rect: ROW.rect, oldText: ROW.old, newText: "Hang muc Quy I Quy V", fontSize: 10 },
    ]);
    expect(second.skipped).toEqual([]);
    const [v2] = await validateTextEdits(second.bytes, [
      { pageIndex: 0, rect: ROW.rect, oldText: "Hang muc Quy I Quy V", newText: "x", fontSize: 10 },
    ]);
    expect(v2!.colorRuns?.some((r) => r.color[0] === 255 && r.color[1] === 0)).toBe(true);
  });
});

describe("applyTextEdits — fragments, deletes and moves", () => {
  it("rewrites the container run when the edit addresses a fragment of it", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [
      { pageIndex: 0, rect: [150, 718, 200, 727], oldText: "hai", newText: "ba", fontSize: 10, newFont: "noto" },
    ]);
    expect(out.skipped).toEqual([]);
    const text = await pageText(out.bytes);
    expect(text).toContain("Doan van thu ba");
    expect(text).not.toContain("thu hai");
  });

  it("removes the run when the replacement is empty or whitespace", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [
      e({ rect: LINE3.rect, oldText: LINE3.text, newText: "" }),
      e({ rect: LINE2.rect, oldText: LINE2.text, newText: "  \n " }),
    ]);
    expect(out.skipped).toEqual([]);
    const objs = await textOf(out.bytes);
    expect(objs).not.toContain(LINE3.text);
    expect(objs).not.toContain(LINE2.text);
    expect(objs).toContain(TITLE.text);
  });

  it("moves a whole run without redrawing it", async () => {
    const before = (await objectsOf(TEXT_PDF())).find((o) => o.text === LINE3.text)!;
    const out = await applyTextEdits(TEXT_PDF(), [
      e({ rect: LINE3.rect, oldText: LINE3.text, newText: LINE3.text, translate: [30, -100] }),
    ]);
    expect(out.skipped).toEqual([]);
    const after = (await objectsOf(out.bytes)).find((o) => o.text === LINE3.text)!;
    expect(after.bounds[0] - before.bounds[0]).toBeCloseTo(30, 0);
    expect(after.bounds[1] - before.bounds[1]).toBeCloseTo(-100, 0);
  });

  it("will not move a fragment because its container carries other text", async () => {
    const input = TEXT_PDF();
    const out = await applyTextEdits(input, [
      { pageIndex: 0, rect: [150, 718, 200, 727], oldText: "hai", newText: "hai", fontSize: 10, translate: [5, 5] },
    ]);
    expect(out.skipped).toEqual([
      { pageIndex: 0, oldText: "hai", reason: "the text block cannot be moved as one unit" },
    ]);
    expect(out.bytes).toBe(input);
  });
});

describe("applyTextEdits — skips", () => {
  it("returns the input bytes untouched when nothing applies", async () => {
    const input = TEXT_PDF();
    const out = await applyTextEdits(input, [e({ oldText: "not on the page", newText: "x" })]);
    expect(out.bytes).toBe(input);
    expect(out.skipped).toEqual([
      { pageIndex: 0, oldText: "not on the page", reason: "the edited text could not be located on the page" },
    ]);
  });

  it("returns the input bytes for an empty edit list", async () => {
    const input = TEXT_PDF();
    expect(await applyTextEdits(input, [])).toEqual({ bytes: input, skipped: [] });
  });

  it("reports a page that does not exist and still applies the rest", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [
      e({ pageIndex: 9, newText: "x" }),
      e({ pageIndex: -1, newText: "x" }),
      e({ newText: "Bao cao tong hop nam 0620" }),
    ]);
    expect(out.skipped.map((s) => s.reason)).toEqual(["page does not exist", "page does not exist"]);
    expect(await textOf(out.bytes)).toContain("Bao cao tong hop nam 0620");
  });

  it("lets the first of two edits claim a run and skips the overlapping one", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [
      e({ newText: "Bao cao tong hop nam 0620" }),
      e({ newText: "Bao cao tong hop nam 6200" }),
    ]);
    expect(out.skipped).toEqual([
      { pageIndex: 0, oldText: TITLE.text, reason: "overlaps another pending text edit" },
    ]);
    const objs = await textOf(out.bytes);
    expect(objs).toContain("Bao cao tong hop nam 0620");
    expect(objs).not.toContain("Bao cao tong hop nam 6200");
  });

  it("skips just the edit whose text no available face can draw", async () => {
    // U+10FFFE is a noncharacter: no installed or bundled font maps it
    const out = await applyTextEdits(TEXT_PDF(), [
      e({ newText: "Bao cao \u{10fffe}", newFont: "noto" }),
      e({ rect: LINE3.rect, oldText: LINE3.text, newText: "" }),
    ]);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]!.oldText).toBe(TITLE.text);
    expect(await textOf(out.bytes)).not.toContain(LINE3.text);
  });

  it("edits the second page independently", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [
      { pageIndex: 1, rect: [72, 776, 230, 791], oldText: "Trang hai: bang va hinh", newText: "Trang hai: bang va anh", fontSize: 14, newFont: "noto" },
    ]);
    expect(out.skipped).toEqual([]);
    expect(await pageText(out.bytes, 1)).toContain("Trang hai: bang va anh");
    expect(await pageText(out.bytes, 0)).toContain(TITLE.text);
  });
});

describe("validateTextEdits", () => {
  it("reports the matched run's bounds and base colour without changing the document", async () => {
    const [v] = await validateTextEdits(TEXT_PDF(), [e({})]);
    expect(v!.reason).toBeNull();
    expect(v!.bounds![0]).toBeCloseTo(73.4, 0);
    expect(v!.bounds![3]).toBeCloseTo(792.9, 0);
    expect(v!.baseColor).toHaveLength(3);
    expect(v!.colorRuns).toBeUndefined();
  });

  it("keeps the edit rect's x-span for a fragment but takes the ink's vertical extent", async () => {
    const [v] = await validateTextEdits(TEXT_PDF(), [
      { pageIndex: 0, rect: [150, 718, 200, 727], oldText: "hai", newText: "ba", fontSize: 10 },
    ]);
    expect(v!.reason).toBeNull();
    expect(v!.bounds![0]).toBe(150);
    expect(v!.bounds![2]).toBe(200);
    expect(v!.bounds![1]).toBeCloseTo(717.6, 0);
  });

  it("gives a reason per failing edit and keeps result order", async () => {
    const res = await validateTextEdits(TEXT_PDF(), [
      e({ oldText: "nope" }),
      e({ pageIndex: 5 }),
      e({}),
      { pageIndex: 0, rect: [150, 718, 200, 727], oldText: "hai", newText: "hai", fontSize: 10, translate: [1, 1] },
    ]);
    expect(res[0]).toEqual({ reason: "the edited text could not be located on the page" });
    expect(res[1]).toEqual({ reason: "page does not exist" });
    expect(res[2]!.reason).toBeNull();
    expect(res[3]).toEqual({ reason: "the text block cannot be moved as one unit" });
  });

  it("returns an empty list for no edits", async () => {
    expect(await validateTextEdits(TEXT_PDF(), [])).toEqual([]);
  });
});

describe("verifyTextEdits", () => {
  it("accepts replacement text that is extractable, line by line and whitespace-insensitively", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [e({ newText: "Bao cao tong hop nam 0620" })]);
    expect(
      await verifyTextEdits(out.bytes, [
        { pageIndex: 0, newText: "Bao cao tong hop nam 0620" },
        { pageIndex: 0, newText: "Bao cao  tong hop\n\nnam 0620" },
        { pageIndex: 0, newText: "" },
      ]),
    ).toEqual([]);
  });

  it("matches NFC-equivalent text", async () => {
    const out = await applyTextEdits(TEXT_PDF(), [
      e({ newText: "Báo cáo tổng hợp", newFont: "noto" }),
    ]);
    const decomposed = "Báo cáo tổng hợp".normalize("NFD");
    expect(await verifyTextEdits(out.bytes, [{ pageIndex: 0, newText: decomposed }])).toEqual([]);
  });

  it("names the missing text, truncated, when it is not in the output", async () => {
    const res = await verifyTextEdits(TEXT_PDF(), [
      { pageIndex: 0, newText: "this replacement line is absolutely not there" },
    ]);
    expect(res).toEqual([
      { pageIndex: 0, reason: 'replacement text missing from saved output ("thisreplacementlinei")' },
    ]);
  });

  it("reports a page missing from the saved output", async () => {
    expect(
      await verifyTextEdits(TEXT_PDF(), [
        { pageIndex: 7, newText: "x" },
        { pageIndex: -1, newText: "x" },
      ]),
    ).toEqual([
      { pageIndex: 7, reason: "page missing from saved output" },
      { pageIndex: -1, reason: "page missing from saved output" },
    ]);
  });
});
