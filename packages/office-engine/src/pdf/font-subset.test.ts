// subsetTtf against the bundled Noto Sans (real hb-subset wasm) and
// identityCffCharset against hand-built CID-keyed CFF fonts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fontCoversText } from "./font-cmap";
import { identityCffCharset, subsetTtf } from "./font-subset";
import { bundledFontDir } from "./pdfium";

const noto = () => readFileSync(join(bundledFontDir()!, "NotoSans-Regular.ttf"));

describe("subsetTtf", () => {
  it("keeps the requested glyphs and drops the rest of the font", async () => {
    const font = noto();
    const sub = await subsetTtf(font, "Việt Nam");
    expect(sub.length).toBeLessThan(font.length / 10);
    expect(sub.readUInt32BE(0)).toBe(0x00010000); // still a TrueType sfnt
    expect(fontCoversText(sub, "Việt Nam")).toBe(true);
    expect(fontCoversText(sub, "xyz")).toBe(false);
  });

  it("subsets astral code points and duplicates without failing", async () => {
    const sub = await subsetTtf(noto(), "aaa\u{1F600}");
    expect(fontCoversText(sub, "a")).toBe(true);
  });

  it("rejects bytes that are not a font", async () => {
    await expect(subsetTtf(Buffer.from("definitely not a font file"), "a")).rejects.toThrow();
  });

  it("keeps serving calls after a failed one (the shared wasm queue is not poisoned)", async () => {
    const results = await Promise.allSettled([
      subsetTtf(Buffer.alloc(16), "a"),
      subsetTtf(noto(), "A"),
      subsetTtf(noto(), "B"),
    ]);
    expect(results[0]!.status).toBe("rejected");
    expect(results[1]!.status).toBe("fulfilled");
    expect(results[2]!.status).toBe("fulfilled");
    const b = (results[2] as PromiseFulfilledResult<Buffer>).value;
    expect(fontCoversText(b, "B")).toBe(true);
    expect(fontCoversText(b, "A")).toBe(false);
  });
});

// ── CFF fixtures ─────────────────────────────────────────────────────

const OTTO = 0x4f54544f;

interface CffSpec {
  /** charset bytes (first byte is the format) */
  charset: number[];
  nGlyphs: number;
  /** false = omit the ROS operator (not CID-keyed) */
  cid?: boolean;
  /** charset operand written into the top DICT (default: right after the top INDEX) */
  charsetOffset?: number;
}

const int32 = (op: number, v: number) => {
  const b = Buffer.alloc(6);
  b[0] = 29;
  b.writeInt32BE(v, 1);
  b[5] = op;
  return b;
};

/** A minimal CFF table: header, Name INDEX, Top DICT INDEX, charset, CharStrings INDEX header. */
function buildCff(spec: CffSpec): { cff: Buffer; charsetPos: number } {
  const cid = spec.cid ?? true;
  const dictLen = (cid ? 5 : 0) + 6 + 6;
  const topIndexLen = 5 + dictLen;
  const charsetPos = 4 + 6 + topIndexLen;
  const csPos = charsetPos + spec.charset.length;
  const dict = Buffer.concat([
    cid ? Buffer.from([0x8b, 0x8b, 0x8b, 12, 30]) : Buffer.alloc(0),
    int32(15, spec.charsetOffset ?? charsetPos),
    int32(17, csPos),
  ]);
  const header = Buffer.from([1, 0, 4, 1]);
  const nameIndex = Buffer.from([0, 1, 1, 1, 2, 0x41]);
  const topIndex = Buffer.concat([Buffer.from([0, 1, 1, 1, dict.length + 1]), dict]);
  const charStrings = Buffer.alloc(4);
  charStrings.writeUInt16BE(spec.nGlyphs, 0);
  return {
    cff: Buffer.concat([header, nameIndex, topIndex, Buffer.from(spec.charset), charStrings]),
    charsetPos,
  };
}

/** OTTO sfnt carrying the given CFF table. */
function buildOtto(cff: Buffer): { font: Buffer; cffOff: number } {
  const head = Buffer.alloc(12 + 16);
  head.writeUInt32BE(OTTO, 0);
  head.writeUInt16BE(1, 4);
  head.write("CFF ", 12, "latin1");
  head.writeUInt32BE(head.length, 20);
  head.writeUInt32BE(cff.length, 24);
  return { font: Buffer.concat([head, cff]), cffOff: head.length };
}

const fmt0 = (cids: number[]) => {
  const b = Buffer.alloc(1 + 2 * cids.length);
  cids.forEach((c, i) => b.writeUInt16BE(c, 1 + 2 * i));
  return [...b];
};

describe("identityCffCharset", () => {
  it("rewrites a CID-keyed format 0 charset into one identity range, leaving the input untouched", () => {
    const { cff, charsetPos } = buildCff({ charset: fmt0([10, 20, 30]), nGlyphs: 4 });
    const { font, cffOff } = buildOtto(cff);
    const original = Buffer.from(font);
    const out = identityCffCharset(font);
    const cs = cffOff + charsetPos;
    expect(out[cs]).toBe(2); // format 2: one range
    expect(out.readUInt16BE(cs + 1)).toBe(1); // first CID
    expect(out.readUInt16BE(cs + 3)).toBe(2); // nLeft = nGlyphs - 2: glyphs 1..3 become CIDs 1..3
    expect(font.equals(original)).toBe(true); // works on a copy
    expect(out.length).toBe(font.length);
    expect(out.subarray(0, cs).equals(font.subarray(0, cs))).toBe(true); // nothing before the charset moved
  });

  it("rewrites a format 2 charset that already fits the 5-byte range", () => {
    const cs = [2, 0, 5, 0, 2]; // first CID 5, nLeft 2 -> covers glyphs 1..3
    const { cff, charsetPos } = buildCff({ charset: cs, nGlyphs: 4 });
    const { font, cffOff } = buildOtto(cff);
    const out = identityCffCharset(font);
    expect([...out.subarray(cffOff + charsetPos, cffOff + charsetPos + 5)]).toEqual([2, 0, 1, 0, 2]);
  });

  it("rewrites a 4-byte format 1 charset with a one-byte range count", () => {
    const { cff, charsetPos } = buildCff({ charset: [1, 0, 9, 2], nGlyphs: 4 });
    const { font, cffOff } = buildOtto(cff);
    const out = identityCffCharset(font);
    expect([...out.subarray(cffOff + charsetPos, cffOff + charsetPos + 4)]).toEqual([1, 0, 1, 2]);
  });

  it("leaves a single-glyph CID font's charset alone", () => {
    const { cff } = buildCff({ charset: [0], nGlyphs: 1 });
    const { font } = buildOtto(cff);
    expect(identityCffCharset(font).equals(font)).toBe(true);
  });

  it("throws when the old charset is too small to hold the identity range in place", () => {
    const { cff } = buildCff({ charset: fmt0([10]), nGlyphs: 2 }); // 3 bytes
    expect(() => identityCffCharset(buildOtto(cff).font)).toThrow("too small");
  });

  it("throws on an unknown charset format", () => {
    const { cff } = buildCff({ charset: [7, 0, 0, 0, 0], nGlyphs: 4 });
    expect(() => identityCffCharset(buildOtto(cff).font)).toThrow("unknown CFF charset format 7");
  });

  it("throws when a CID-keyed CFF only uses a predefined charset", () => {
    const { cff } = buildCff({ charset: fmt0([10, 20, 30]), nGlyphs: 4, charsetOffset: 0 });
    expect(() => identityCffCharset(buildOtto(cff).font)).toThrow("without a custom charset");
  });

  it("passes a non-CID CFF through unchanged", () => {
    const { cff } = buildCff({ charset: fmt0([10, 20, 30]), nGlyphs: 4, cid: false });
    const { font } = buildOtto(cff);
    expect(identityCffCharset(font)).toBe(font);
  });

  it("passes TrueType fonts, tiny buffers and OTTO files without a CFF table through", () => {
    const ttf = noto();
    expect(identityCffCharset(ttf)).toBe(ttf);
    const tiny = Buffer.from([0x4f, 0x54, 0x54, 0x4f]);
    expect(identityCffCharset(tiny)).toBe(tiny);
    const noCff = Buffer.alloc(12);
    noCff.writeUInt32BE(OTTO, 0);
    expect(identityCffCharset(noCff)).toBe(noCff);
  });

  it("throws when the CFF has no top DICT", () => {
    const { cff } = buildCff({ charset: fmt0([10, 20, 30]), nGlyphs: 4 });
    const broken = Buffer.from(cff);
    broken.writeUInt16BE(0, 10); // Top DICT INDEX count = 0
    expect(() => identityCffCharset(buildOtto(broken).font)).toThrow("top DICT missing");
  });
});
