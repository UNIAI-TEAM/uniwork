// fontCoversText against hand-built cmap tables (formats 4 and 12, the
// subtable-choice policy, refusals) and the bundled Noto Sans faces.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fontCoversText } from "./font-cmap";
import { bundledFontDir } from "./pdfium";

interface Seg {
  start: number;
  end: number;
  delta: number;
  /** glyph ids addressed through idRangeOffset instead of the delta */
  glyphs?: number[];
}

/** cmap subtable format 4 (a 0xFFFF terminator segment is appended). */
function format4(segs: Seg[]): Buffer {
  const all = [...segs, { start: 0xffff, end: 0xffff, delta: 1 }];
  const n = all.length;
  const fixed = 16 + 8 * n;
  const glyphArr: number[] = [];
  const rangeOffs = all.map((s, i) => {
    if (!s.glyphs) return 0;
    const pos = glyphArr.length;
    glyphArr.push(...s.glyphs);
    // distance from this idRangeOffset slot to the first glyph id of the segment
    return (n - i) * 2 + pos * 2;
  });
  const b = Buffer.alloc(fixed + glyphArr.length * 2);
  b.writeUInt16BE(4, 0);
  b.writeUInt16BE(b.length, 2);
  b.writeUInt16BE(n * 2, 6);
  all.forEach((s, i) => {
    b.writeUInt16BE(s.end, 14 + 2 * i);
    b.writeUInt16BE(s.start, 16 + 2 * n + 2 * i);
    b.writeInt16BE(s.delta, 16 + 4 * n + 2 * i);
    b.writeUInt16BE(rangeOffs[i]!, 16 + 6 * n + 2 * i);
  });
  glyphArr.forEach((g, i) => b.writeUInt16BE(g, fixed + 2 * i));
  return b;
}

/** cmap subtable format 12 from [start, end, startGlyph] groups. */
function format12(groups: [number, number, number][]): Buffer {
  const b = Buffer.alloc(16 + 12 * groups.length);
  b.writeUInt16BE(12, 0);
  b.writeUInt32BE(b.length, 4);
  b.writeUInt32BE(groups.length, 12);
  groups.forEach(([s, e, g], i) => {
    b.writeUInt32BE(s, 16 + 12 * i);
    b.writeUInt32BE(e, 20 + 12 * i);
    b.writeUInt32BE(g, 24 + 12 * i);
  });
  return b;
}

/** sfnt holding only a cmap table made of [platform, encoding, subtable] records. */
function fontWithCmap(records: [number, number, Buffer][]): Buffer {
  const cmapHead = 4 + 8 * records.length;
  const cmap = Buffer.alloc(cmapHead);
  cmap.writeUInt16BE(records.length, 2);
  let off = cmapHead;
  records.forEach(([p, e, sub], i) => {
    cmap.writeUInt16BE(p, 4 + 8 * i);
    cmap.writeUInt16BE(e, 6 + 8 * i);
    cmap.writeUInt32BE(off, 8 + 8 * i);
    off += sub.length;
  });
  const table = Buffer.concat([cmap, ...records.map((r) => r[2])]);
  const head = Buffer.alloc(12 + 16);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt16BE(1, 4);
  head.write("cmap", 12, "latin1");
  head.writeUInt32BE(head.length, 12 + 8);
  head.writeUInt32BE(table.length, 12 + 12);
  return Buffer.concat([head, table]);
}

const fontsDir = bundledFontDir()!;
const noto = () => readFileSync(join(fontsDir, "NotoSans-Regular.ttf"));

describe("fontCoversText with a format 4 cmap", () => {
  const font = fontWithCmap([
    [
      3,
      1,
      format4([
        { start: 0x41, end: 0x5a, delta: 100 - 0x41 }, // A-Z via delta
        { start: 0x61, end: 0x63, delta: 0, glyphs: [7, 0, 9] }, // a, b(unmapped glyph 0), c
        { start: 0x300, end: 0x300, delta: -0x300 }, // maps to glyph 0: unmapped
      ]),
    ],
  ]);

  it("maps characters through idDelta segments", () => {
    expect(fontCoversText(font, "ABC")).toBe(true);
  });

  it("maps characters through idRangeOffset glyph arrays and treats glyph 0 as unmapped", () => {
    expect(fontCoversText(font, "ac")).toBe(true);
    expect(fontCoversText(font, "b")).toBe(false);
  });

  it("refuses characters outside every segment, in a gap, or above the BMP", () => {
    expect(fontCoversText(font, "A1")).toBe(false); // 0x31 falls before the first segment
    expect(fontCoversText(font, "Ad")).toBe(false); // 0x64 sits in the gap after segment two
    expect(fontCoversText(font, "A\u{1F600}")).toBe(false); // format 4 has no astral planes
    expect(fontCoversText(font, "̀")).toBe(false); // delta lands on .notdef
  });

  it("ignores line breaks but still requires a glyph for Unicode spaces", () => {
    expect(fontCoversText(font, "A\r\nB")).toBe(true);
    expect(fontCoversText(font, "A B")).toBe(false); // NBSP is drawn, so it must be mapped
  });
});

describe("fontCoversText with a format 12 cmap", () => {
  const font = fontWithCmap([
    [
      3,
      10,
      format12([
        [0x41, 0x5a, 5],
        [0x1f600, 0x1f64f, 100],
      ]),
    ],
  ]);

  it("maps BMP and supplementary-plane characters from sorted groups", () => {
    expect(fontCoversText(font, "QZ\u{1F600}\u{1F64F}")).toBe(true);
  });

  it("refuses characters before, between and after the groups", () => {
    expect(fontCoversText(font, "0")).toBe(false);
    expect(fontCoversText(font, "a")).toBe(false);
    expect(fontCoversText(font, "\u{1F650}")).toBe(false);
  });
});

describe("cmap subtable choice", () => {
  const f4 = format4([{ start: 0x41, end: 0x41, delta: 1 - 0x41 }]); // only 'A'
  const f12 = format12([[0x42, 0x42, 1]]); // only 'B'

  it("prefers a format 12 subtable over format 4 when both are Unicode", () => {
    const font = fontWithCmap([
      [3, 1, f4],
      [3, 10, f12],
    ]);
    expect(fontCoversText(font, "B")).toBe(true);
    expect(fontCoversText(font, "A")).toBe(false);
  });

  it("keeps the first format 4 subtable when no format 12 exists", () => {
    const other = format4([{ start: 0x43, end: 0x43, delta: 1 - 0x43 }]);
    const font = fontWithCmap([
      [0, 3, f4],
      [3, 1, other],
    ]);
    expect(fontCoversText(font, "A")).toBe(true);
    expect(fontCoversText(font, "C")).toBe(false);
  });

  it("ignores non-Unicode records such as Mac Roman and Windows symbol", () => {
    const font = fontWithCmap([
      [1, 0, f4],
      [3, 0, f4],
    ]);
    expect(fontCoversText(font, "A")).toBe(false);
  });
});

describe("fontCoversText refusals", () => {
  it("returns false for a font without a cmap table", () => {
    const font = Buffer.alloc(12);
    font.writeUInt32BE(0x00010000, 0);
    expect(fontCoversText(font, "A")).toBe(false);
  });

  it("returns false instead of throwing on a truncated or garbage buffer", () => {
    expect(fontCoversText(Buffer.from([0, 1, 0, 0, 0, 9]), "A")).toBe(false);
    const truncated = fontWithCmap([[3, 1, format4([{ start: 0x41, end: 0x5a, delta: 1 }])]]).subarray(0, 40);
    expect(fontCoversText(truncated, "A")).toBe(false);
  });

  it("covers an empty or line-break-only string even for an unparseable font", () => {
    expect(fontCoversText(Buffer.alloc(0), "")).toBe(true);
    expect(fontCoversText(Buffer.alloc(0), "\r\n\n")).toBe(true);
  });
});

describe("fontCoversText with the bundled Noto Sans", () => {
  it("covers Vietnamese text including stacked diacritics", () => {
    expect(fontCoversText(noto(), "Việt Nam, Hà Nội\nphở")).toBe(true);
  });

  it("refuses CJK characters the Latin face does not map", () => {
    expect(fontCoversText(noto(), "日本")).toBe(false);
    expect(fontCoversText(noto(), "abc日")).toBe(false);
  });
});
