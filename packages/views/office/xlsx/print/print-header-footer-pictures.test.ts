// UNI-952 D4: `&G` header/footer pictures in the XLSX print copy - the picture
// the engine read for a section prints in its margin box, sized like the DOCX
// pictures, defined once on :root.
import { describe, expect, it } from "vitest";
import type { XlsxRenderHeaderFooter } from "@uniwork/office-engine/xlsx";
import { buildXlsxPrintCopy, type XlsxPrintSheet } from "./print-copy";
import { parseHeaderFooter } from "./print-header-footer";
import { resolvePrintSetup } from "./print-setup";

const CONTEXT = { sheetName: "Data", fileName: "Book.xlsx", date: "06/10/2026", time: "19:30" };

/** A PNG whose header carries the given pixel size (enough for the size probe). */
const pngBase64 = (width: number, height: number): string => {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString("base64");
};
const LOGO = `data:image/png;base64,${pngBase64(96, 48)}`;
const SMALL = `data:image/png;base64,${pngBase64(10, 10)}`;
const BIG = `data:image/png;base64,${pngBase64(96, 96)}`;

function htmlOf(headerFooter: XlsxRenderHeaderFooter): string {
  const used = { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 };
  const setup = resolvePrintSetup({ file: { headerFooter, margins: { left: 0.7, right: 0.7, top: 1, bottom: 1, header: 0.3, footer: 0.3 } }, sheetIndex: 0, used });
  const sheet: XlsxPrintSheet = {
    title: "Book - Data", setup, areas: [used], cells: new Map(), styles: [], columns: new Map(), rows: new Map(),
    defaultColumnWidth: 48, defaultRowHeight: 15, merges: [], headerContext: CONTEXT,
  };
  const result = buildXlsxPrintCopy(sheet);
  if (!result.ok) throw new Error(result.reason);
  return result.html;
}

describe("header/footer pictures (&G)", () => {
  it("parses &G as a picture part that starts no font", () => {
    expect(parseHeaderFooter("&L&G&20x", CONTEXT).left.parts).toEqual([{ picture: true }, { text: "x" }]);
    expect(parseHeaderFooter("&L&G", CONTEXT).left.font).toEqual({ bold: false, italic: false, underline: "none", strike: false });
  });

  it("prints the section's picture in its margin box, sized from the VML shape and defined once", () => {
    const html = htmlOf({
      oddHeader: "&L&G&Rp. &P",
      oddFooter: "&C&G",
      pictures: { LH: { media: "xl/media/logo.png", widthPt: 48, heightPt: 24 }, CF: { media: "xl/media/logo.png" } },
      pictureMedia: { "xl/media/logo.png": LOGO },
    });
    // 48pt = 64px wide for a 96px picture -> 1.5x; the footer picture has no size -> intrinsic.
    expect(html).toMatch(/@top-left\{content:image-set\(var\(--docx-hf-img-0\) 1\.5x\);/);
    expect(html).toMatch(/@bottom-center\{content:var\(--docx-hf-img-0\);/);
    expect(html).toMatch(/@top-right\{content:"p\. " counter\(page\);/);
    expect(html.match(/--docx-hf-img-0:\s*url\("/g)).toHaveLength(1);
    expect(html).not.toContain("--docx-hf-img-1");
  });

  it("scales a picture taller than its margin box down to the box", () => {
    // 1in top margin, 0.3in header distance -> 0.7in = ~67px of box for a 96px picture.
    const html = htmlOf({ oddHeader: "&C&G", pictures: { CH: { media: "big.png", widthPt: 72, heightPt: 72 } }, pictureMedia: { "big.png": BIG } });
    expect(html).toMatch(/@top-center\{content:image-set\(var\(--docx-hf-img-0\) 1\.4\d*x\);/);
  });

  it("keeps odd, even and first pictures apart", () => {
    const html = htmlOf({
      oddHeader: "&L&G",
      evenHeader: "&L&G",
      firstHeader: "&L&G",
      differentOddEven: true,
      differentFirst: true,
      pictures: {
        LH: { media: "logo.png" },
        LHEVEN: { media: "small.png" },
      },
      pictureMedia: { "logo.png": LOGO, "small.png": SMALL },
    });
    const even = html.indexOf("@page:left{");
    const first = html.indexOf("@page:first{");
    expect(html.slice(0, even)).toMatch(/@top-left\{content:var\(--docx-hf-img-0\)/);
    expect(html.slice(even, first)).toMatch(/@top-left\{content:var\(--docx-hf-img-1\)/);
    // No FIRST picture was read: the first page's &G prints nothing.
    expect(html.slice(first)).toMatch(/@top-left\{content:none;/);
  });

  it("defines a logo shared by every section and page variant once and references it from each margin box", () => {
    const shared = { media: "xl/media/logo.png" };
    const html = htmlOf({
      oddHeader: "&L&G&C&G&R&G",
      evenHeader: "&L&G",
      firstHeader: "&L&G",
      differentOddEven: true,
      differentFirst: true,
      pictures: { LH: shared, CH: shared, RH: shared, LHEVEN: shared, LHFIRST: shared },
      pictureMedia: { "xl/media/logo.png": LOGO },
    });
    expect(html.match(/--docx-hf-img-0:\s*url\("/g)).toHaveLength(1);
    expect(html).not.toContain("--docx-hf-img-1");
    expect(html.match(/content:var\(--docx-hf-img-0\)/g)).toHaveLength(5);
    expect(html.split(LOGO.slice(22))).toHaveLength(2);
  });

  it("prints nothing for a skipped picture, an absent one, a media path nothing holds or a URL that is not a raster data: URL", () => {
    const named = { LH: { media: "m.png" } };
    const cases: { pictures: NonNullable<XlsxRenderHeaderFooter["pictures"]>; pictureMedia?: Record<string, string> }[] = [
      { pictures: { LH: { skipped: "no_reader" } } },
      { pictures: {} },
      { pictures: named },
      { pictures: named, pictureMedia: { "other.png": LOGO } },
      { pictures: named, pictureMedia: { "m.png": "https://example.com/logo.png" } },
      { pictures: named, pictureMedia: { "m.png": 'data:image/svg+xml;base64,PHN2Zy8+' } },
      { pictures: named, pictureMedia: { "m.png": 'data:image/png;base64,AA"};</style><script>x</script>' } },
    ];
    for (const { pictures, pictureMedia } of cases) {
      const html = htmlOf({ oddHeader: "&L&G", pictures, ...(pictureMedia ? { pictureMedia } : {}) });
      expect(html).toMatch(/@top-left\{content:none;/);
      expect(html).not.toContain("--docx-hf-img-0");
      expect(html).not.toContain("<script>");
    }
  });
});
