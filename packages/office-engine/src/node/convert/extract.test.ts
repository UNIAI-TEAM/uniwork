import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  extractDocumentText,
  ExtractTypedError,
  MAX_EXTRACT_CODE_POINTS,
  MAX_EXTRACT_UTF8_BYTES,
  truncateExtractedText,
  type ExtractFailureReason,
} from "./extract.ts";
import { writeZip, type ZipInput } from "./zip.ts";

const enc = new TextEncoder();

function zipEntries(entries: Record<string, string | Uint8Array>): Uint8Array {
  const inputs: ZipInput[] = Object.entries(entries).map(([path, val]) => ({
    path,
    data: typeof val === "string" ? enc.encode(val) : val,
  }));
  return writeZip(inputs);
}

/** Build a custom zip with control over flags, compression method and claimed sizes. */
function buildRawZip(
  entries: {
    name: string;
    data: Uint8Array;
    method?: number;
    flags?: number;
    localFlags?: number;
    claimedUncompressed?: number;
  }[],
): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const method = entry.method ?? 0;
    const flags = entry.flags ?? 0;
    const localFlags = entry.localFlags ?? flags;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(6, localFlags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, entry.data.length, true);
    lv.setUint32(22, entry.claimedUncompressed ?? entry.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.claimedUncompressed ?? entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);

    parts.push(local, entry.data);
    central.push(cd);
    offset += local.length + entry.data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const SECTOR = 512;
const MINI = 64;
const FREE = 0xffffffff;
const EOC = 0xfffffffe;

/** Minimal v3 CFB builder for encrypted and legacy compound file tests. */
function buildCfb(streams: { name: string; data: Uint8Array; type?: number }[]): Uint8Array {
  const small = streams.filter((s) => s.data.length > 0 && s.data.length < 4096);
  const big = streams.filter((s) => s.data.length >= 4096);
  const dirSectors = Math.ceil((streams.length + 1) / 4);
  const miniChunks = small.map((s) => Math.ceil(s.data.length / MINI));
  const miniTotal = miniChunks.reduce((a, b) => a + b, 0);
  const miniFatSectors = miniTotal > 0 ? Math.ceil(miniTotal / 128) : 0;
  const miniStreamSectors = Math.ceil((miniTotal * MINI) / SECTOR);
  const bigSectors = big.map((s) => Math.ceil(s.data.length / SECTOR));
  const firstDir = 1;
  const firstMiniFat = firstDir + dirSectors;
  const firstMiniStream = firstMiniFat + miniFatSectors;
  const firstBig = firstMiniStream + miniStreamSectors;
  const total = firstBig + bigSectors.reduce((a, b) => a + b, 0);

  const out = new Uint8Array((total + 1) * SECTOR);
  const view = new DataView(out.buffer);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  view.setUint16(24, 0x3e, true);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, firstDir, true);
  view.setUint32(56, 4096, true);
  view.setUint32(60, miniFatSectors > 0 ? firstMiniFat : EOC, true);
  view.setUint32(64, miniFatSectors, true);
  view.setUint32(68, EOC, true);
  for (let i = 0; i < 109; i++) view.setUint32(76 + i * 4, i === 0 ? 0 : FREE, true);

  const at = (sector: number): number => (sector + 1) * SECTOR;
  const fat = new DataView(out.buffer, at(0), SECTOR);
  for (let i = 0; i < 128; i++) fat.setUint32(i * 4, FREE, true);
  fat.setUint32(0, 0xfffffffd, true);
  const chain = (first: number, count: number): void => {
    for (let k = 0; k < count; k++) fat.setUint32((first + k) * 4, k === count - 1 ? EOC : first + k + 1, true);
  };
  chain(firstDir, dirSectors);
  if (miniFatSectors > 0) chain(firstMiniFat, miniFatSectors);
  if (miniStreamSectors > 0) chain(firstMiniStream, miniStreamSectors);

  const miniFat = new DataView(out.buffer, at(firstMiniFat), Math.max(miniFatSectors, 1) * SECTOR);
  const dirEntry = (index: number, name: string, type: number, start: number, size: number): void => {
    const base = at(firstDir) + index * 128;
    for (let i = 0; i < name.length; i++) view.setUint16(base + i * 2, name.charCodeAt(i), true);
    view.setUint16(base + 64, (name.length + 1) * 2, true);
    out[base + 66] = type;
    view.setUint32(base + 116, start, true);
    view.setBigUint64(base + 120, BigInt(size), true);
  };
  dirEntry(0, "Root Entry", 5, miniStreamSectors > 0 ? firstMiniStream : EOC, miniTotal * MINI);

  let miniCursor = 0;
  let bigCursor = firstBig;
  let smallIndex = 0;
  let bigIndex = 0;
  streams.forEach((stream, index) => {
    const type = stream.type ?? 2;
    if (stream.data.length === 0) {
      dirEntry(index + 1, stream.name, type, EOC, 0);
    } else if (stream.data.length < 4096) {
      const chunks = miniChunks[smallIndex++]!;
      dirEntry(index + 1, stream.name, type, miniCursor, stream.data.length);
      out.set(stream.data, at(firstMiniStream) + miniCursor * MINI);
      for (let k = 0; k < chunks; k++) {
        miniFat.setUint32((miniCursor + k) * 4, k === chunks - 1 ? EOC : miniCursor + k + 1, true);
      }
      miniCursor += chunks;
    } else {
      const sectors = bigSectors[bigIndex++]!;
      dirEntry(index + 1, stream.name, type, bigCursor, stream.data.length);
      out.set(stream.data, at(bigCursor));
      chain(bigCursor, sectors);
      bigCursor += sectors;
    }
  });
  return out;
}

function expectExtractFailure(run: () => unknown): ExtractFailureReason {
  try {
    run();
  } catch (error) {
    if (error instanceof ExtractTypedError) {
      expect(error.code).toBe("engine_result_invalid");
      return error.reason;
    }
    throw error;
  }
  throw new Error("expected ExtractTypedError");
}

describe("extractDocumentText: DOCX", () => {
  it("extracts headings, paragraphs and tables with cells joined by ' | ', skipping media entries", () => {
    const docx = buildRawZip([
      {
        name: "word/document.xml",
        method: 8,
        data: deflateRawSync(
          enc.encode(
            `<?xml version="1.0" encoding="UTF-8"?>` +
              `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
              `<w:body>` +
              `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Báo cáo Q4 &amp; Tổng kết</w:t></w:r></w:p>` +
              `<w:p><w:r><w:t>Đoạn mở đầu</w:t><w:tab/><w:t>chi tiết</w:t><w:br/><w:t>dòng 2</w:t></w:r></w:p>` +
              `<w:tbl>` +
              `<w:tr><w:tc><w:p><w:r><w:t>Hạng mục</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Giá trị</w:t></w:r></w:p></w:tc></w:tr>` +
              `<w:tr><w:tc><w:p><w:r><w:t>Doanh thu</w:t></w:r></w:p><w:p><w:r><w:t>(VNĐ)</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1200</w:t></w:r></w:p></w:tc></w:tr>` +
              `</w:tbl>` +
              `</w:body></w:document>`,
          ),
        ),
        claimedUncompressed: 1024,
      },
      // Corrupt deflate payload inside media/ proves selective reader skips non-text entries
      {
        name: "word/media/image1.png",
        method: 8,
        data: new Uint8Array([0xff, 0x00, 0x11, 0x22]),
        claimedUncompressed: 100,
      },
    ]);

    const res = extractDocumentText("docx", docx);
    expect(res).toEqual({
      format: "docx",
      truncated: false,
      text: [
        "# Báo cáo Q4 & Tổng kết",
        "Đoạn mở đầu\tchi tiết\ndòng 2",
        "Hạng mục | Giá trị",
        "Doanh thu (VNĐ) | 1200",
      ].join("\n"),
    });
  });

  it("resolves a non-default main document part through _rels/.rels", () => {
    const docx = zipEntries({
      "_rels/.rels":
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/word/document2.xml"/>` +
        `</Relationships>`,
      "word/document2.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Custom target</w:t></w:r></w:p></w:body></w:document>`,
    });
    expect(extractDocumentText("docx", docx).text).toBe("Custom target");
  });
});

describe("extractDocumentText: XLSX", () => {
  it("extracts ONLY the first worksheet in workbook order as RFC 4180 CSV with shared strings, inline strings, booleans and numbers", () => {
    const xlsx = zipEntries({
      "xl/workbook.xml":
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>` +
        `<sheet name="FirstSheet" sheetId="1" r:id="rId2"/>` +
        `<sheet name="SecondSheet" sheetId="2" r:id="rId1"/>` +
        `</sheets></workbook>`,
      "xl/_rels/workbook.xml.rels":
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `</Relationships>`,
      "xl/sharedStrings.xml":
        `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<si><t>Tên, "Đơn vị"</t></si>` +
        `<si><r><t>Dòng 1_x000A_</t></r><r><t>Dòng 2</t></r></si>` +
        `</sst>`,
      "xl/worksheets/sheet1.xml":
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
        `<row r="1">` +
        `<c r="A1" t="s"><v>0</v></c>` +
        `<c r="B1" t="inlineStr"><is><t>Ghi chú, có phẩy</t></is></c>` +
        `<c r="C1"><v>42.5</v></c>` +
        `<c r="D1" t="b"><v>1</v></c>` +
        `</row>` +
        `<row r="2">` +
        `<c r="A2" t="s"><v>1</v></c>` +
        `<c r="C2"><v>99</v></c>` +
        `</row>` +
        `</sheetData></worksheet>`,
      "xl/worksheets/sheet2.xml":
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
        `<row r="1"><c r="A1" t="inlineStr"><is><t>MUST_NOT_APPEAR</t></is></c></row>` +
        `</sheetData></worksheet>`,
    });

    const res = extractDocumentText("xlsx", xlsx);
    expect(res.format).toBe("xlsx");
    expect(res.truncated).toBe(false);
    expect(res.text).toBe(
      [
        `"Tên, ""Đơn vị""","Ghi chú, có phẩy",42.5,TRUE`,
        `"Dòng 1\nDòng 2",,99`,
      ].join("\n"),
    );
    expect(res.text).not.toContain("MUST_NOT_APPEAR");
  });
});

describe("extractDocumentText: PPTX", () => {
  it("extracts slides in presentation sldIdLst order and includes speaker notes when present", () => {
    const pptx = zipEntries({
      "ppt/presentation.xml":
        `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<p:sldIdLst>` +
        `<p:sldId id="256" r:id="rIdSlideB"/>` +
        `<p:sldId id="257" r:id="rIdSlideA"/>` +
        `</p:sldIdLst></p:presentation>`,
      "ppt/_rels/presentation.xml.rels":
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rIdSlideA" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>` +
        `<Relationship Id="rIdSlideB" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>` +
        `</Relationships>`,
      "ppt/slides/slide2.xml":
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
        `<p:cSld><p:spTree><p:sp><p:txBody>` +
        `<a:p><a:r><a:t>Mở đầu chiến lược</a:t></a:r></a:p>` +
        `<a:p><a:r><a:t>Mục tiêu Q1</a:t></a:r></a:p>` +
        `</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
      "ppt/slides/_rels/slide2.xml.rels":
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide2.xml"/>` +
        `</Relationships>`,
      "ppt/notesSlides/notesSlide2.xml":
        `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
        `<p:cSld><p:spTree>` +
        `<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></p:txBody></p:sp>` +
        `<p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Ghi chú người thuyết trình slide 1</a:t></a:r></a:p></p:txBody></p:sp>` +
        `</p:spTree></p:cSld></p:notes>`,
      "ppt/slides/slide1.xml":
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
        `<p:cSld><p:spTree><p:sp><p:txBody>` +
        `<a:p><a:r><a:t>Slide thứ hai không có ghi chú</a:t></a:r></a:p>` +
        `</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    });

    const res = extractDocumentText("pptx", pptx);
    expect(res).toEqual({
      format: "pptx",
      truncated: false,
      text: [
        "## Slide 1\nMở đầu chiến lược\nMục tiêu Q1\nNotes:\nGhi chú người thuyết trình slide 1",
        "## Slide 2\nSlide thứ hai không có ghi chú",
      ].join("\n\n"),
    });
  });
});

describe("extractDocumentText: failure classification", () => {
  it("classifies CFB container with EncryptedPackage or EncryptionInfo as password_required", () => {
    const encryptedPackage = buildCfb([
      { name: "EncryptionInfo", data: new Uint8Array([1, 2, 3, 4]) },
      { name: "EncryptedPackage", data: new Uint8Array(128).fill(0xaa) },
    ]);
    for (const fmt of ["docx", "xlsx", "pptx"] as const) {
      expect(expectExtractFailure(() => extractDocumentText(fmt, encryptedPackage))).toBe("password_required");
    }
  });

  it("classifies ZIP with encrypted general-purpose flag bit 0 or method 99 as password_required", () => {
    const flagBit0 = buildRawZip([
      { name: "word/document.xml", data: enc.encode("<w:document><w:body/></w:document>"), flags: 0x01 },
    ]);
    expect(expectExtractFailure(() => extractDocumentText("docx", flagBit0))).toBe("password_required");

    const winZipAes = buildRawZip([
      { name: "word/document.xml", data: enc.encode("encrypted"), method: 99 },
    ]);
    expect(expectExtractFailure(() => extractDocumentText("docx", winZipAes))).toBe("password_required");
  });

  it("classifies legacy unencrypted CFB container (.doc/.xls/.ppt) as not_office_file", () => {
    const legacyDoc = buildCfb([{ name: "WordDocument", data: new Uint8Array(64).fill(0x11) }]);
    const legacyXls = buildCfb([{ name: "Workbook", data: new Uint8Array(64).fill(0x22) }]);
    expect(expectExtractFailure(() => extractDocumentText("docx", legacyDoc))).toBe("not_office_file");
    expect(expectExtractFailure(() => extractDocumentText("xlsx", legacyXls))).toBe("not_office_file");
  });

  it("classifies garbage, truncated zip, bad deflate, missing main part, zero slides and zip-bomb as corrupted", () => {
    // Non-ZIP garbage
    expect(expectExtractFailure(() => extractDocumentText("docx", enc.encode("not a zip at all")))).toBe("corrupted");

    // Truncated ZIP (PK prefix but no EOCD)
    expect(expectExtractFailure(() => extractDocumentText("docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])))).toBe(
      "corrupted",
    );

    // Truncated CFB
    expect(
      expectExtractFailure(() =>
        extractDocumentText("docx", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 1])),
      ),
    ).toBe("corrupted");

    // Missing main part for each format
    const emptyZip = zipEntries({ "other.xml": "<root/>" });
    expect(expectExtractFailure(() => extractDocumentText("docx", emptyZip))).toBe("corrupted");
    expect(expectExtractFailure(() => extractDocumentText("xlsx", emptyZip))).toBe("corrupted");
    expect(expectExtractFailure(() => extractDocumentText("pptx", emptyZip))).toBe("corrupted");

    // XLSX workbook with no sheets or missing first sheet
    const noSheets = zipEntries({ "xl/workbook.xml": "<workbook><sheets/></workbook>" });
    expect(expectExtractFailure(() => extractDocumentText("xlsx", noSheets))).toBe("corrupted");
    const missingSheetXml = zipEntries({
      "xl/workbook.xml": '<workbook><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    });
    expect(expectExtractFailure(() => extractDocumentText("xlsx", missingSheetXml))).toBe("corrupted");

    // PPTX with zero slides
    const zeroSlides = zipEntries({
      "ppt/presentation.xml": "<p:presentation><p:sldIdLst/></p:presentation>",
    });
    expect(expectExtractFailure(() => extractDocumentText("pptx", zeroSlides))).toBe("corrupted");

    // Corrupt deflate stream
    const badDeflate = buildRawZip([
      {
        name: "word/document.xml",
        method: 8,
        data: new Uint8Array([0xff, 0xff, 0xff, 0xff]),
        claimedUncompressed: 64,
      },
    ]);
    expect(expectExtractFailure(() => extractDocumentText("docx", badDeflate))).toBe("corrupted");

    // Zip-bomb bound hit (declared uncompressed > 512 MiB fixed bound)
    const bomb = buildRawZip([
      {
        name: "word/document.xml",
        method: 8,
        data: deflateRawSync(new Uint8Array(16)),
        claimedUncompressed: 600 << 20,
      },
    ]);
    expect(expectExtractFailure(() => extractDocumentText("docx", bomb))).toBe("corrupted");
  });
});

describe("truncateExtractedText & end-to-end truncation", () => {
  it("truncates at 200,000 Unicode code points when byte size is still under 512 KiB", () => {
    const input = "a".repeat(MAX_EXTRACT_CODE_POINTS + 500);
    const out = truncateExtractedText(input);
    expect(out.truncated).toBe(true);
    expect([...out.text].length).toBe(MAX_EXTRACT_CODE_POINTS);
    expect(out.text.length).toBe(MAX_EXTRACT_CODE_POINTS);

    const exact = "b".repeat(MAX_EXTRACT_CODE_POINTS);
    expect(truncateExtractedText(exact)).toEqual({ text: exact, truncated: false });
  });

  it("truncates at 512 KiB UTF-8 before 200,000 code points without splitting a multi-byte or astral code point", () => {
    // "Ấ" is 3 UTF-8 bytes (U+1EA4). 180,000 code points = 540,000 bytes > 524,288 bytes (512 KiB).
    // 524,288 / 3 = 174,762.66 -> must keep exactly 174,762 code points (524,286 bytes).
    const viet = "Ấ".repeat(180_000);
    const outViet = truncateExtractedText(viet);
    expect(outViet.truncated).toBe(true);
    const vietBytes = enc.encode(outViet.text);
    expect(vietBytes.byteLength).toBe(174_762 * 3);
    expect(vietBytes.byteLength).toBeLessThanOrEqual(MAX_EXTRACT_UTF8_BYTES);
    expect([...outViet.text].length).toBe(174_762);
    expect(outViet.text.endsWith("Ấ")).toBe(true);

    // 4-byte emoji U+1F680 ("🚀"): 1 byte ASCII prefix + 131,072 emojis (524,288 B) -> last emoji at 524,285..524,289 must not split
    const astral = "x" + "🚀".repeat(131_072);
    const outAstral = truncateExtractedText(astral);
    expect(outAstral.truncated).toBe(true);
    const astralBytes = enc.encode(outAstral.text);
    expect(astralBytes.byteLength).toBe(1 + 131_071 * 4);
    expect(astralBytes.byteLength).toBeLessThanOrEqual(MAX_EXTRACT_UTF8_BYTES);
    // Ensure no lone surrogate at the end
    const lastCodePoint = outAstral.text.codePointAt(outAstral.text.length - 2);
    expect(lastCodePoint).toBe(0x1f680);
  });

  it("marks truncated=true on extractDocumentText when document text exceeds the cap", () => {
    const bigPara = "A".repeat(MAX_EXTRACT_CODE_POINTS + 10);
    const docx = zipEntries({
      "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${bigPara}</w:t></w:r></w:p></w:body></w:document>`,
    });
    const res = extractDocumentText("docx", docx);
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBe(MAX_EXTRACT_CODE_POINTS);
  });
});
