// Direct tests for the sfnt plumbing: name normalisation, style tokens and
// scoring, table-directory / table reads from a file descriptor, and the
// font index built from a font directory (UNIWORK_PDF_ASSETS/fonts) holding
// hand-built faces, so nothing depends on fonts installed on the machine.
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OTTO_TAG, norm, readTable, readTableDir, styleScore, styleTokens, TTC_TAG } from "./sfnt";
import type { FaceRef, FontIndex } from "./sfnt";

/** sfnt with the given flavor and tables (offsets laid out after the directory). */
function buildSfnt(flavor: number, tables: [string, Buffer][]): Buffer {
  const head = Buffer.alloc(12 + 16 * tables.length);
  head.writeUInt32BE(flavor, 0);
  head.writeUInt16BE(tables.length, 4);
  let off = head.length;
  const bodies: Buffer[] = [];
  tables.forEach(([tag, data], i) => {
    head.write(tag, 12 + 16 * i, "latin1");
    head.writeUInt32BE(off, 12 + 16 * i + 8);
    head.writeUInt32BE(data.length, 12 + 16 * i + 12);
    bodies.push(data);
    off += data.length;
  });
  return Buffer.concat([head, ...bodies]);
}

interface NameRec {
  platform: number;
  encoding: number;
  id: number;
  bytes: Buffer;
}

/** name table (format 0) holding the given records. */
function buildName(recs: NameRec[]): Buffer {
  const strBase = 6 + 12 * recs.length;
  const head = Buffer.alloc(strBase);
  head.writeUInt16BE(recs.length, 2);
  head.writeUInt16BE(strBase, 4);
  let off = 0;
  recs.forEach((r, i) => {
    const o = 6 + 12 * i;
    head.writeUInt16BE(r.platform, o);
    head.writeUInt16BE(r.encoding, o + 2);
    head.writeUInt16BE(r.id, o + 6);
    head.writeUInt16BE(r.bytes.length, o + 8);
    head.writeUInt16BE(off, o + 10);
    off += r.bytes.length;
  });
  return Buffer.concat([head, ...recs.map((r) => r.bytes)]);
}

const utf16be = (s: string) => Buffer.from(s, "utf16le").swap16();
const glyf = Buffer.from([0, 0, 0, 0]);

function face(style: string): FaceRef {
  return { path: "x.ttf", offset: 0, style };
}

describe("norm", () => {
  it("lowercases, folds compatibility forms and drops spaces, hyphens and underscores", () => {
    expect(norm("Noto Sans-Bold_Italic")).toBe("notosansbolditalic");
    expect(norm("ＡＲＩＡＬ")).toBe("arial"); // fullwidth letters fold under NFKC
  });
});

describe("styleTokens", () => {
  it("splits a BoldItalic name into bold and italic", () => {
    expect(styleTokens("Arial-BoldItalic")).toEqual(["bold", "italic"]);
  });

  it("consumes the longest weight word, so Semibold and ExtraBold are not plain bold", () => {
    expect(styleTokens("Face-SemiBold")).toEqual(["semibold"]);
    expect(styleTokens("Face-ExtraBold")).toEqual(["extrabold"]);
  });

  it("folds oblique into italic and keeps numeric weights", () => {
    expect(styleTokens("Helvetica-Oblique")).toEqual(["italic"]);
    expect(styleTokens("HiraginoSans-W3")).toEqual(["w3"]);
  });

  it("returns no tokens for a name without style words", () => {
    expect(styleTokens("Courier")).toEqual([]);
  });
});

describe("styleScore", () => {
  it("ranks the exact style above a variant carrying extra tokens", () => {
    const bold = face(norm("Noto Sans Bold"));
    const boldItalic = face(norm("Noto Sans Bold Italic"));
    expect(styleScore(bold, ["bold"])).toBeGreaterThan(styleScore(boldItalic, ["bold"]));
  });

  it("prefers a BoldItalic face when both styles are wanted", () => {
    const want = ["bold", "italic"];
    const scores = ["Regular", "Bold", "Italic", "Bold Italic"].map((s) =>
      styleScore(face(norm(`Fam ${s}`)), want),
    );
    expect(scores[3]).toBeGreaterThan(Math.max(scores[0]!, scores[1]!, scores[2]!));
  });

  it("does not credit a Semibold face for a bold want", () => {
    expect(styleScore(face(norm("Fam Semibold")), ["bold"])).toBeLessThan(
      styleScore(face(norm("Fam Bold")), ["bold"]),
    );
  });

  it("with no wanted tokens ranks the Regular face above bold and untagged ones", () => {
    const regular = styleScore(face(norm("Fam Regular")), []);
    expect(regular).toBeGreaterThan(styleScore(face(norm("Fam Bold")), []));
    expect(regular).toBeGreaterThan(styleScore(face(norm("Fam")), []));
  });
});

describe("table reads", () => {
  let dir: string;
  const path = (n: string) => join(dir, n);

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sfnt-tables-"));
    writeFileSync(
      path("ok.ttf"),
      buildSfnt(0x00010000, [
        ["glyf", glyf],
        ["name", Buffer.alloc(8, 7)],
        ["tiny", Buffer.from([1])],
      ]),
    );
    writeFileSync(path("otto.otf"), buildSfnt(OTTO_TAG, [["CFF ", Buffer.alloc(4)]]));
    writeFileSync(path("true.ttf"), buildSfnt(0x74727565, [["glyf", glyf]]));
    writeFileSync(path("junk.bin"), Buffer.from("this is not a font at all"));
    writeFileSync(path("zero.ttf"), buildSfnt(0x00010000, []));
    const many = Array.from({ length: 65 }, (_, i): [string, Buffer] => [
      `t${String(i).padStart(3, "0")}`,
      glyf,
    ]);
    writeFileSync(path("many.ttf"), buildSfnt(0x00010000, many));
    writeFileSync(path("short.ttf"), buildSfnt(0x00010000, [["glyf", glyf]]).subarray(0, 20));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const withFd = <T>(name: string, fn: (fd: number) => T): T => {
    const fd = openSync(path(name), "r");
    try {
      return fn(fd);
    } finally {
      closeSync(fd);
    }
  };

  it("exports the TTC and OTTO magic numbers", () => {
    expect(TTC_TAG).toBe(Buffer.from("ttcf").readUInt32BE(0));
    expect(OTTO_TAG).toBe(Buffer.from("OTTO").readUInt32BE(0));
  });

  it("reads the table directory of TrueType, 'true' and OTTO flavored faces", () => {
    const dirOk = withFd("ok.ttf", (fd) => readTableDir(fd, 0))!;
    expect([...dirOk.keys()]).toEqual(["glyf", "name", "tiny"]);
    expect(dirOk.get("glyf")).toEqual({ off: 12 + 16 * 3, len: 4 });
    expect(withFd("otto.otf", (fd) => readTableDir(fd, 0))?.has("CFF ")).toBe(true);
    expect(withFd("true.ttf", (fd) => readTableDir(fd, 0))?.has("glyf")).toBe(true);
  });

  it("refuses a file whose flavor is not sfnt", () => {
    expect(withFd("junk.bin", (fd) => readTableDir(fd, 0))).toBeNull();
  });

  it("refuses a directory with zero tables or more than 64", () => {
    expect(withFd("zero.ttf", (fd) => readTableDir(fd, 0))).toBeNull();
    expect(withFd("many.ttf", (fd) => readTableDir(fd, 0))).toBeNull();
  });

  it("throws on a truncated table directory instead of returning a partial map", () => {
    expect(() => withFd("short.ttf", (fd) => readTableDir(fd, 0))).toThrow("short read");
  });

  it("reads one table's bytes and refuses absent, tiny or oversized tables", () => {
    withFd("ok.ttf", (fd) => {
      const tables = readTableDir(fd, 0)!;
      expect(readTable(fd, tables, "name", 100)).toEqual(Buffer.alloc(8, 7));
      expect(readTable(fd, tables, "cmap", 100)).toBeNull(); // absent
      expect(readTable(fd, tables, "tiny", 100)).toBeNull(); // shorter than 2 bytes
      expect(readTable(fd, tables, "name", 4)).toBeNull(); // over maxLen
    });
  });
});

describe("font index from a font directory", () => {
  let root: string;
  let prevEnv: string | undefined;
  let index: FontIndex;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "sfnt-index-"));
    const fonts = join(root, "fonts");
    mkdirSync(join(fonts, "sub", "deeper", "toodeep", "nope"), { recursive: true });
    const named = (recs: NameRec[]) =>
      buildSfnt(0x00010000, [
        ["glyf", glyf],
        ["name", buildName(recs)],
      ]);
    // Windows UTF-16BE names: PS name, family (1), typographic family (16) and subfamily (17)
    writeFileSync(
      join(fonts, "alpha.ttf"),
      named([
        { platform: 3, encoding: 1, id: 6, bytes: utf16be("Alpha-BoldItalic") },
        { platform: 3, encoding: 1, id: 1, bytes: utf16be("Alpha Legacy") },
        { platform: 3, encoding: 1, id: 16, bytes: utf16be("Alpha") },
        { platform: 3, encoding: 1, id: 17, bytes: utf16be("Bold Italic") },
        { platform: 3, encoding: 1, id: 4, bytes: utf16be("ignored full name") },
      ]),
    );
    // Mac Roman (platform 1, encoding 0) latin1 names, plus a Mac CJK record that is skipped
    writeFileSync(
      join(fonts, "beta.otf"),
      buildSfnt(OTTO_TAG, [
        ["CFF ", Buffer.alloc(4)],
        [
          "name",
          buildName([
            { platform: 1, encoding: 0, id: 6, bytes: Buffer.from("Beta-Regular", "latin1") },
            { platform: 1, encoding: 0, id: 1, bytes: Buffer.from("Beta", "latin1") },
            { platform: 1, encoding: 1, id: 1, bytes: Buffer.from("MacCJKname", "latin1") },
            { platform: 0, encoding: 3, id: 2, bytes: utf16be("Regular") },
          ]),
        ],
      ]),
    );
    // nested one level down: still found; five levels down: not scanned
    writeFileSync(
      join(fonts, "sub", "gamma.TTF"),
      named([
        { platform: 3, encoding: 1, id: 6, bytes: utf16be("Gamma-Regular") },
        { platform: 3, encoding: 1, id: 1, bytes: utf16be("Gamma") },
      ]),
    );
    writeFileSync(
      join(fonts, "sub", "deeper", "toodeep", "nope", "delta.ttf"),
      named([{ platform: 3, encoding: 1, id: 6, bytes: utf16be("Delta-Regular") }]),
    );
    // not font files / not sfnt / no name table: all skipped without failing the scan
    writeFileSync(join(fonts, "notes.txt"), "not a font");
    writeFileSync(join(fonts, "broken.ttf"), Buffer.from("garbage garbage garbage"));
    writeFileSync(join(fonts, "tiny.ttf"), Buffer.from([0, 1]));
    writeFileSync(join(fonts, "noname.ttf"), buildSfnt(0x00010000, [["glyf", glyf]]));
    prevEnv = process.env.UNIWORK_PDF_ASSETS;
    process.env.UNIWORK_PDF_ASSETS = root;
    index = (await import("./sfnt")).getFontIndex();
  });
  afterAll(() => {
    if (prevEnv === undefined) delete process.env.UNIWORK_PDF_ASSETS;
    else process.env.UNIWORK_PDF_ASSETS = prevEnv;
    rmSync(root, { recursive: true, force: true });
  });

  it("indexes PostScript names from both Windows UTF-16 and Mac latin1 records", () => {
    expect(index.byPs.get("alphabolditalic")?.path).toBe(join(root, "fonts", "alpha.ttf"));
    expect(index.byPs.get("betaregular")?.path).toBe(join(root, "fonts", "beta.otf"));
  });

  it("indexes every family name (nameID 1 and 16) with the combined style text", () => {
    const legacy = index.byFamily.get("alphalegacy")?.[0];
    const typographic = index.byFamily.get("alpha")?.[0];
    expect(legacy).toEqual(typographic);
    expect(typographic?.offset).toBe(0);
    expect(typographic?.style).toBe(norm("Alpha Legacy Alpha Bold Italic"));
    expect(styleTokens(typographic!.style)).toEqual(["bold", "italic"]);
  });

  it("scans one nested directory level and matches extensions case-insensitively", () => {
    expect(index.byPs.get("gammaregular")?.path).toBe(join(root, "fonts", "sub", "gamma.TTF"));
  });

  it("skips non-font files, broken faces, faces without a name table and too-deep folders", () => {
    expect(index.byPs.has("deltaregular")).toBe(false);
    expect(index.byFamily.has("maccjkname")).toBe(false);
    const paths = new Set([...index.byPs.values()].map((f) => f.path));
    for (const bad of ["notes.txt", "broken.ttf", "tiny.ttf", "noname.ttf"]) {
      expect(paths.has(join(root, "fonts", bad))).toBe(false);
    }
  });
});
