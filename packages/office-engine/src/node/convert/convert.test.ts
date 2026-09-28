import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConvertTypedError, convertDocument, convertLegacySpreadsheet, convertOdfText } from "./index.ts";
import { BiffError, readBiff8Workbook } from "./biff8.ts";
import { readZip } from "./zip.ts";

// The oracles are the frozen G0 fixtures themselves:
//   F-LEGACY-XLS   sheets/legacy-xls.xls   -> three sheet names, Sheet1!A1='replaceMe'
//   F-UNSUPPORTED-ODT legacy/unsupported-sample.odt -> the ODT's own heading + body text
const fixture = (relative: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL("../../../../../docs/office/g0/fixtures/files/" + relative, import.meta.url)));

const textOf = (pkg: Map<string, Uint8Array>, path: string): string => {
  const entry = pkg.get(path);
  if (!entry) throw new Error("missing package entry " + path);
  return new TextDecoder().decode(entry);
};

describe("convertLegacySpreadsheet (BIFF8 .xls -> .xlsx)", () => {
  it("converts the Apache POI Simple.xls fixture into the manifest oracle", () => {
    const result = convertLegacySpreadsheet(fixture("sheets/legacy-xls.xls"));
    expect(result.sourceFormat).toBe("xls");
    expect(result.targetFormat).toBe("xlsx");
    expect(result.fidelity.level).toBe("limited");
    // The change list the caller shows before accepting the copy: exactly what
    // the converted workbook will carry (manifest F-LEGACY-XLS expected.content).
    expect(result.content.sheets).toEqual(["Sheet1", "Sheet2", "Sheet3"]);
    expect(result.content.cells).toEqual({ "Sheet1!A1": "replaceMe" });
    expect(result.fidelity.lost.length).toBeGreaterThan(0);
  });

  it("writes a real OOXML package the engine can reopen", () => {
    const result = convertLegacySpreadsheet(fixture("sheets/legacy-xls.xls"));
    const pkg = readZip(result.bytes);
    expect([...pkg.keys()]).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/styles.xml",
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml",
        "xl/worksheets/sheet3.xml",
      ]),
    );
    const workbook = textOf(pkg, "xl/workbook.xml");
    for (const name of ["Sheet1", "Sheet2", "Sheet3"]) expect(workbook).toContain(`name="${name}"`);
    const sheet1 = textOf(pkg, "xl/worksheets/sheet1.xml");
    expect(sheet1).toContain('r="A1"');
    expect(sheet1).toContain("replaceMe");
    const sheet2 = textOf(pkg, "xl/worksheets/sheet2.xml");
    expect(sheet2).not.toContain("<c r=");
    const types = textOf(pkg, "[Content_Types].xml");
    expect(types).toContain("spreadsheetml.sheet.main+xml");
    // Reopen through the same reader the writer promises: every sheet parses.
    for (let i = 1; i <= 3; i++) expect(() => textOf(pkg, `xl/worksheets/sheet${i}.xml`)).not.toThrow();
  });

  it("is deterministic: the same source converts to byte-identical output", () => {
    const source = fixture("sheets/legacy-xls.xls");
    const a = convertLegacySpreadsheet(source);
    const b = convertLegacySpreadsheet(source);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });

  it("refuses bytes that are not a compound file with a typed error", () => {
    const error = expectTyped(() => convertLegacySpreadsheet(new TextEncoder().encode("not an xls")));
    expect(error.code).toBe("engine_result_invalid");
    expect(error.reason).toBe("not_compound_file");
  });
});

describe("convertOdfText (.odt -> .docx)", () => {
  it("converts the generated ODT fixture into a docx carrying its text", () => {
    const source = fixture("legacy/unsupported-sample.odt");
    const odt = readZip(source);
    const contentXml = textOf(odt, "content.xml");
    const title = /<text:h[^>]*>([^<]+)<\/text:h>/.exec(contentXml)?.[1] ?? "";
    const body = /<text:p[^>]*>([^<]+)<\/text:p>/.exec(contentXml)?.[1] ?? "";
    expect(title.length).toBeGreaterThan(0);
    expect(body.length).toBeGreaterThan(0);

    const result = convertOdfText(source);
    expect(result.sourceFormat).toBe("odt");
    expect(result.targetFormat).toBe("docx");
    expect(result.fidelity.level).toBe("limited");
    expect(result.content.paragraphs).toEqual([title, body]);
    const pkg = readZip(result.bytes);
    expect([...pkg.keys()]).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"]),
    );
    const document = textOf(pkg, "word/document.xml");
    expect(document).toContain(title);
    expect(document).toContain(body);
    expect(document).toContain("Heading1");
  });

  it("is deterministic and refuses a non-ODT package", () => {
    const source = fixture("legacy/unsupported-sample.odt");
    const a = convertOdfText(source);
    const b = convertOdfText(source);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);

    const error = expectTyped(() => convertOdfText(fixture("sheets/xlsx-compatibility-basic.xlsx")));
    expect(error.code).toBe("engine_result_invalid");
    expect(error.reason).toBe("not_odt");
  });
});

describe("convertDocument dispatcher", () => {
  it("routes the bound pairs and refuses everything else", () => {
    const xls = convertDocument("xls", "xlsx", fixture("sheets/legacy-xls.xls"));
    expect(xls.targetFormat).toBe("xlsx");
    const odt = convertDocument("odt", "docx", fixture("legacy/unsupported-sample.odt"));
    expect(odt.targetFormat).toBe("docx");
    for (const [source, target] of [
      ["ods", "xlsx"],
      ["xlsb", "xlsx"],
      ["rtf", "docx"],
      ["xls", "docx"],
      ["docx", "pdf"],
    ]) {
      const error = expectTyped(() => convertDocument(source ?? "", target ?? "", new Uint8Array()));
      expect(error.code).toBe("unsupported_operation");
      expect(error.reason).toBe(`convert_not_bound:${source}->${target}`);
    }
  });
});

function expectTyped(run: () => unknown): ConvertTypedError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConvertTypedError) return error;
    throw error;
  }
  throw new Error("expected a ConvertTypedError, but the call returned");
}

describe("readBiff8Workbook refusals", () => {
  // BOF (BIFF8 workbook globals) followed by FILEPASS: everything after it is
  // ciphertext, so the reader must refuse by name instead of decoding cells.
  function record(type: number, body: number[]): number[] {
    return [type & 0xff, type >> 8, body.length & 0xff, body.length >> 8, ...body];
  }
  it("refuses a password-protected workbook as xls_encrypted", () => {
    const bof = record(0x0809, [0x00, 0x06, 0x05, 0x00, ...new Array<number>(12).fill(0)]);
    const filepass = record(0x002f, [0x01, 0x00, ...new Array<number>(52).fill(0)]);
    const stream = new Uint8Array([...bof, ...filepass]);
    try {
      readBiff8Workbook(stream);
      expect.unreachable("an encrypted workbook was read");
    } catch (error) {
      expect(error).toBeInstanceOf(BiffError);
      expect((error as BiffError).reason).toBe("xls_encrypted");
    }
  });
});

describe("compound-file bounds (review BE-R1-01)", () => {
  // Each case mutates F-LEGACY-XLS so one declared length lies; the reader
  // must answer a typed refusal fast instead of allocating from the lie.
  const u32 = (b: Uint8Array, at: number): number => new DataView(b.buffer, b.byteOffset).getUint32(at, true);
  const setU32 = (b: Uint8Array, at: number, v: number): void => new DataView(b.buffer, b.byteOffset).setUint32(at, v, true);
  const mutate = (edit: (b: Uint8Array, fatAt: (sector: number) => number) => void): Uint8Array => {
    const bytes = new Uint8Array(fixture("sheets/legacy-xls.xls"));
    const sectorSize = 1 << new DataView(bytes.buffer).getUint16(30, true);
    const firstFat = u32(bytes, 76);
    edit(bytes, (sector) => 512 + firstFat * sectorSize + sector * 4);
    return bytes;
  };
  const refuses = (bytes: Uint8Array): void => {
    const started = Date.now();
    const error = expectTyped(() => convertLegacySpreadsheet(bytes));
    expect(error.code).toBe("engine_result_invalid");
    expect(error.reason).toBe("not_compound_file");
    expect(Date.now() - started).toBeLessThan(2000);
  };

  it("refuses a FAT chain that loops on itself", () => {
    refuses(mutate((b, fatAt) => setU32(b, fatAt(u32(b, 48)), u32(b, 48))));
  });
  it("refuses a two-sector FAT cycle", () => {
    refuses(
      mutate((b, fatAt) => {
        const dir = u32(b, 48);
        setU32(b, fatAt(dir), dir + 1);
        setU32(b, fatAt(dir + 1), dir);
      }),
    );
  });
  it("refuses a chain that names a sector past the file", () => {
    refuses(mutate((b, fatAt) => setU32(b, fatAt(u32(b, 48)), 0x00ffffff)));
  });
  it("refuses an oversized sector shift and a forged mini-stream cutoff", () => {
    refuses(mutate((b) => new DataView(b.buffer).setUint16(30, 20, true)));
    refuses(mutate((b) => setU32(b, 56, 0xffffffff)));
  });
  it("refuses a DIFAT count larger than the file", () => {
    refuses(mutate((b) => setU32(b, 72, 0x7fffffff)));
  });
});
