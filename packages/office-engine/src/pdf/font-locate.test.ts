// findSystemFont / findFontCovering / isTruetype against a font directory the
// test builds under os.tmpdir() (pointed at through UNIWORK_PDF_ASSETS, which
// the engine scans first): a .ttc made of the bundled Noto Sans faces, plus
// malformed and vanishing files. No installed system font is required.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { fontCoversText } from "./font-cmap";
import { bundledFontDir } from "./pdfium";

type Locate = typeof import("./font-locate");

const bundled = bundledFontDir()!;
const notoRegular = readFileSync(join(bundled, "NotoSans-Regular.ttf"));
const notoBold = readFileSync(join(bundled, "NotoSans-Bold.ttf"));

/** Bytes of one table of a standalone sfnt. */
function tableBytes(font: Buffer, tag: string): Buffer | null {
  const n = font.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const rec = 12 + 16 * i;
    if (font.toString("latin1", rec, rec + 4) === tag) {
      const off = font.readUInt32BE(rec + 8);
      return font.subarray(off, off + font.readUInt32BE(rec + 12));
    }
  }
  return null;
}

/** A .ttc whose faces are the given single-face fonts (tables relocated into the collection). */
function buildTtc(fonts: Buffer[]): Buffer {
  const headLen = 12 + 4 * fonts.length;
  const dirLens = fonts.map((f) => 12 + 16 * f.readUInt16BE(4));
  const totalDirs = dirLens.reduce((a, b) => a + b, 0);
  const head = Buffer.alloc(headLen);
  head.write("ttcf", 0, "latin1");
  head.writeUInt32BE(0x00010000, 4);
  head.writeUInt32BE(fonts.length, 8);
  const dirs: Buffer[] = [];
  const datas: Buffer[] = [];
  let dirPos = headLen;
  let dataPos = headLen + totalDirs;
  fonts.forEach((f, i) => {
    head.writeUInt32BE(dirPos, 12 + 4 * i);
    const dir = Buffer.from(f.subarray(0, dirLens[i]!));
    for (let t = 0; t < f.readUInt16BE(4); t++) {
      const p = 12 + 16 * t + 8;
      dir.writeUInt32BE(dir.readUInt32BE(p) - dirLens[i]! + dataPos, p);
    }
    dirs.push(dir);
    const data = f.subarray(dirLens[i]!);
    datas.push(data);
    dirPos += dirLens[i]!;
    dataPos += data.length;
  });
  return Buffer.concat([head, ...dirs, ...datas]);
}

/** sfnt holding only a name table with a Windows PostScript name and family. */
function namedStub(ps: string, family: string): Buffer {
  const u16 = (s: string) => Buffer.from(s, "utf16le").swap16();
  const recs = [
    { id: 6, bytes: u16(ps) },
    { id: 1, bytes: u16(family) },
  ];
  const strBase = 6 + 12 * recs.length;
  const name = Buffer.alloc(strBase);
  name.writeUInt16BE(recs.length, 2);
  name.writeUInt16BE(strBase, 4);
  let off = 0;
  recs.forEach((r, i) => {
    const o = 6 + 12 * i;
    name.writeUInt16BE(3, o);
    name.writeUInt16BE(1, o + 2);
    name.writeUInt16BE(r.id, o + 6);
    name.writeUInt16BE(r.bytes.length, o + 8);
    name.writeUInt16BE(off, o + 10);
    off += r.bytes.length;
  });
  const table = Buffer.concat([name, ...recs.map((r) => r.bytes)]);
  const head = Buffer.alloc(12 + 16);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt16BE(1, 4);
  head.write("name", 12, "latin1");
  head.writeUInt32BE(head.length, 20);
  head.writeUInt32BE(table.length, 24);
  return Buffer.concat([head, table]);
}

describe("isTruetype", () => {
  it("is true for glyf-flavored fonts and false for CFF 'OTTO' fonts", async () => {
    const { isTruetype } = await import("./font-locate");
    expect(isTruetype(notoRegular)).toBe(true);
    expect(isTruetype(Buffer.from("OTTO\0\0\0\0"))).toBe(false);
  });

  it("is false for a buffer too short to carry a flavor tag", async () => {
    const { isTruetype } = await import("./font-locate");
    expect(isTruetype(Buffer.from([0, 1, 0]))).toBe(false);
  });
});

describe("lookup over a font directory", () => {
  let root: string;
  let goneFile: string;
  let prevEnv: string | undefined;
  let locate: Locate;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "font-locate-"));
    const fonts = join(root, "fonts");
    mkdirSync(fonts);
    writeFileSync(join(fonts, "noto.ttc"), buildTtc([notoRegular, notoBold]));
    // A collection claiming 65 faces is refused outright (the face-count cap)
    const huge = Buffer.alloc(16);
    huge.write("ttcf", 0, "latin1");
    huge.writeUInt32BE(65, 8);
    writeFileSync(join(fonts, "huge.ttc"), huge);
    writeFileSync(join(fonts, "junk.ttf"), Buffer.from("not a font"));
    goneFile = join(fonts, "gone.ttf");
    writeFileSync(goneFile, namedStub("GoneFont-Regular", "Gone Font"));
    prevEnv = process.env.UNIWORK_PDF_ASSETS;
    process.env.UNIWORK_PDF_ASSETS = root;
    vi.resetModules();
    locate = await import("./font-locate");
    locate.findSystemFont("NotoSans-Regular", ""); // builds the index while every file exists
    rmSync(goneFile);
  });
  afterAll(() => {
    if (prevEnv === undefined) delete process.env.UNIWORK_PDF_ASSETS;
    else process.env.UNIWORK_PDF_ASSETS = prevEnv;
    rmSync(root, { recursive: true, force: true });
  });

  it("extracts a standalone sfnt from a .ttc by exact PostScript name", () => {
    const bold = locate.findSystemFont("NotoSans-Bold", "")!;
    expect(bold.readUInt32BE(0)).toBe(0x00010000); // not 'ttcf'
    expect(locate.isTruetype(bold)).toBe(true);
    for (const tag of ["glyf", "cmap", "head", "name"]) {
      expect(tableBytes(bold, tag)?.equals(tableBytes(notoBold, tag)!)).toBe(true);
    }
    expect(fontCoversText(bold, "Việt Nam")).toBe(true);
  });

  it("extracts the other face of the collection for its own name", () => {
    const regular = locate.findSystemFont("NotoSans-Regular", "")!;
    expect(tableBytes(regular, "glyf")?.equals(tableBytes(notoRegular, "glyf")!)).toBe(true);
    expect(tableBytes(regular, "glyf")?.equals(tableBytes(notoBold, "glyf")!)).toBe(false);
  });

  it("matches names regardless of case, spaces and hyphens", () => {
    const a = locate.findSystemFont("notosans-bold", "");
    const b = locate.findSystemFont("Noto Sans Bold", "");
    expect(a).not.toBeNull();
    expect(a).toBe(b); // same cached face
  });

  it("serves a repeated lookup from the face cache", () => {
    expect(locate.findSystemFont("NotoSans-Regular", "")).toBe(locate.findSystemFont("NotoSans-Regular", ""));
  });

  it("falls back to the family and ranks faces by the style tokens of the PostScript name", () => {
    const bold = locate.findSystemFont("Missing-Bold", "Noto Sans")!;
    expect(tableBytes(bold, "glyf")?.equals(tableBytes(notoBold, "glyf")!)).toBe(true);
    const plain = locate.findSystemFont("Missing", "Noto Sans")!;
    expect(tableBytes(plain, "glyf")?.equals(tableBytes(notoRegular, "glyf")!)).toBe(true);
  });

  it("returns null when neither name nor family is installed", () => {
    expect(locate.findSystemFont("Nothing-Regular", "No Such Family")).toBeNull();
    expect(locate.findSystemFont("", "")).toBeNull();
  });

  it("returns null for an indexed face whose file can no longer be read", () => {
    expect(locate.findSystemFont("GoneFont-Regular", "Gone Font")).toBeNull();
  });

  it("finds a face covering the whole text and returns it as a standalone sfnt", () => {
    const covering = locate.findFontCovering("Việt Nam\nHà Nội")!;
    expect(covering.readUInt32BE(0)).not.toBe(0x74746366);
    expect(fontCoversText(covering, "Việt Nam\nHà Nội")).toBe(true);
  });

  it("returns null for empty or line-break-only text", () => {
    expect(locate.findFontCovering("")).toBeNull();
    expect(locate.findFontCovering("\r\n")).toBeNull();
  });

  it("returns null when no face maps a code point (a plane-16 private-use character)", () => {
    expect(locate.findFontCovering("a\u{10FFFD}")).toBeNull();
  });
});

describe("single-file font directory", () => {
  it("indexes a plain .ttf copied into the font directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "font-locate-single-"));
    const prev = process.env.UNIWORK_PDF_ASSETS;
    try {
      mkdirSync(join(root, "fonts"));
      copyFileSync(join(bundled, "NotoSans-Bold.ttf"), join(root, "fonts", "NotoSans-Bold.ttf"));
      process.env.UNIWORK_PDF_ASSETS = root;
      vi.resetModules();
      const { findSystemFont } = await import("./font-locate");
      const found = findSystemFont("NotoSans-Bold", "")!;
      expect(found.equals(notoBold)).toBe(true); // plain ttf passes through unchanged
    } finally {
      if (prev === undefined) delete process.env.UNIWORK_PDF_ASSETS;
      else process.env.UNIWORK_PDF_ASSETS = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
