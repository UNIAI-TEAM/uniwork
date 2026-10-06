import { describe, expect, it } from "vitest";
import type { DocxEdit } from "@uniwork/office-engine/docx";
import { emptyHeaderFooterState } from "../header-footer/header-footer-state";
import {
  headerFooterPageRules,
  printedHfKey,
  readDocxPrintHeaderFooter,
  resolveDocxPrintHeaderFooter,
  sectionHeaderFooter,
  type DocxPrintSectionHf,
} from "./docx-print-header-footer";
import { DocxPrintHfImageDefs, hfImageContent, printableHfImages } from "./docx-print-hf-image";

function base64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

/** A PNG header (signature + IHDR) of the given size: enough for the size probe. */
function pngDataUrl(width: number, height: number): string {
  const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return `data:image/png;base64,${base64([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, ...be32(width), ...be32(height), 8, 2, 0, 0, 0])}`;
}

/** SOI, an APP0 segment, then SOF0 with the frame size. */
function jpegDataUrl(width: number, height: number): string {
  const app0 = [0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return `data:image/jpeg;base64,${base64([0xff, 0xd8, ...app0, ...sof])}`;
}

const LOGO = pngDataUrl(200, 50);

const SECT = (refs: string, extra = "") =>
  `<w:sectPr>${refs}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>${extra}</w:sectPr>`;
const REF = (kind: "header" | "footer", type: string, id: string) => `<w:${kind}Reference w:type="${type}" r:id="${id}"/>`;

/** Three sections: s0 has its own default + first header (titlePg), s1 inherits them, s2 (final) has none. */
function parsed() {
  return {
    blocks: [
      { docxIndex: 0, type: "paragraph", originalXml: "<w:p/>" },
      {
        docxIndex: 1,
        type: "paragraph",
        originalXml: `<w:p><w:pPr>${SECT(REF("header", "default", "rIdH1") + REF("header", "first", "rIdH1F") + REF("footer", "default", "rIdF1"), "<w:titlePg/>")}</w:pPr></w:p>`,
      },
      { docxIndex: 2, type: "paragraph", originalXml: `<w:p><w:pPr>${SECT(REF("header", "default", "rIdH2"))}</w:pPr></w:p>` },
      { docxIndex: 3, type: "sectPr", hidden: true, originalXml: SECT("") },
    ],
    hfParts: {
      rIdH1: { text: "Chương 1", hasPageNumber: false, paras: [] },
      rIdH1F: { text: "", hasPageNumber: false, paras: [], images: [{ dataUrl: LOGO, widthPx: 100, heightPx: 25, align: "right" }] },
      rIdF1: { text: "Trang \u{E001} / \u{E000}", hasPageNumber: true, paras: [] },
      rIdH2: { text: "  ", hasPageNumber: false, paras: [], images: [{ dataUrl: LOGO, widthPx: 200 }] },
    },
    headerText: "Tài liệu",
    footerText: "",
    footerHasPageNumber: true,
    evenAndOddHeaders: false,
  };
}

type HfPart = NonNullable<DocxPrintSectionHf["header"]["default"]>;

function part(id: string, overrides: Partial<HfPart> = {}): HfPart {
  return { id, text: id, pageNumber: false, images: [], ...overrides };
}

function sectionHf(overrides: Partial<DocxPrintSectionHf> = {}): DocxPrintSectionHf {
  return {
    index: 0,
    titlePg: false,
    header: { default: null, first: null, even: null },
    footer: { default: null, first: null, even: null },
    ...overrides,
  };
}

/** A page context with a 96 px (2.54 cm) margin above and below. */
type PageContext = Parameters<typeof headerFooterPageRules>[4];

function context(overrides: Partial<PageContext> = {}): PageContext {
  return { images: new DocxPrintHfImageDefs(), marginTopPx: 96, marginBottomPx: 96, ...overrides };
}

describe("readDocxPrintHeaderFooter", () => {
  it("resolves every section's parts the way the canvas does", () => {
    const hf = readDocxPrintHeaderFooter(parsed());
    expect(hf?.sections.map((section) => section.index)).toEqual([0, 1, 2]);
    const [s0, s1, s2] = hf?.sections ?? [];
    expect(s0?.titlePg).toBe(true);
    expect(s0?.header.default).toMatchObject({ id: "rIdH1", text: "Chương 1" });
    // An image-only first-page header is content.
    expect(s0?.header.first).toMatchObject({ id: "rIdH1F", text: "", images: [{ dataUrl: LOGO, widthPx: 100, heightPx: 25, align: "right" }] });
    // No even reference: the even variant falls back to the default reference.
    expect(s0?.header.even?.id).toBe("rIdH1");
    expect(s0?.footer.default).toMatchObject({ id: "rIdF1", pageNumber: true });
    // s1 changes the header reference and inherits the footer one.
    expect(s1?.titlePg).toBe(false);
    expect(s1?.header.default).toMatchObject({ id: "rIdH2", images: [{ align: "left", widthPx: 200 }] });
    expect(s1?.footer.default?.id).toBe("rIdF1");
    // The final section inherits too; only an unresolved final part falls back to the document-level one.
    expect(s2?.header.default?.id).toBe("rIdH2");
  });

  it("falls back to the document-level parts for the final section only", () => {
    const fixture = parsed();
    fixture.hfParts = {} as typeof fixture.hfParts;
    const hf = readDocxPrintHeaderFooter(fixture);
    expect(hf?.sections[0]?.header.default).toBeNull();
    expect(hf?.sections[2]?.header.default).toMatchObject({ id: "doc:header", text: "Tài liệu" });
    expect(hf?.sections[2]?.footer.default).toMatchObject({ id: "doc:footer", pageNumber: true });
  });

  it("returns null without a parse", () => {
    expect(readDocxPrintHeaderFooter(null)).toBeNull();
    expect(readDocxPrintHeaderFooter("x")).toBeNull();
  });
});

describe("resolveDocxPrintHeaderFooter", () => {
  it("overlays an edited slot on the final section and keeps the part's pictures", () => {
    const source = readDocxPrintHeaderFooter(parsed());
    const state = emptyHeaderFooterState();
    state.slots.header = { value: { text: "Đã sửa" }, hasImages: true };
    state.titlePg = true;
    state.evenAndOddHeaders = true;
    const edits: DocxEdit[] = [
      { op: "set_header_footer", slot: "header", hf: { text: "Đã sửa" } },
      { op: "set_title_pg", value: true },
    ];
    const hf = resolveDocxPrintHeaderFooter(source, state, edits);
    expect(hf?.evenAndOddHeaders).toBe(true);
    expect(hf?.sections[2]?.header.default).toMatchObject({ id: "edit:header", text: "Đã sửa", images: [{ widthPx: 200 }] });
    expect(hf?.sections[2]?.titlePg).toBe(true);
    // Other sections and the source are untouched.
    expect(hf?.sections[1]?.header.default?.id).toBe("rIdH2");
    expect(source?.sections[2]?.header.default?.id).toBe("rIdH2");
  });

  it("clears an edited slot to nothing, or to its pictures alone", () => {
    const source = readDocxPrintHeaderFooter(parsed());
    const state = emptyHeaderFooterState();
    const edits: DocxEdit[] = [
      { op: "set_header_footer", slot: "header", hf: null },
      { op: "set_header_footer", slot: "footer", hf: null },
    ];
    const hf = resolveDocxPrintHeaderFooter(source, state, edits);
    expect(hf?.sections[2]?.header.default).toMatchObject({ id: "edit:header", text: "", images: [{ widthPx: 200 }] });
    expect(hf?.sections[2]?.footer.default).toBeNull();
  });

  describe("a header part referenced by several sections", () => {
    /** Two sections that both name rIdH; the final one either repeats the reference (own) or inherits it. */
    function twoSections(finalRefs: string) {
      return {
        blocks: [
          { docxIndex: 0, type: "paragraph", originalXml: `<w:p><w:pPr>${SECT(REF("header", "default", "rIdH"))}</w:pPr></w:p>` },
          { docxIndex: 1, type: "sectPr", hidden: true, originalXml: SECT(finalRefs) },
        ],
        hfParts: { rIdH: { text: "Chung", hasPageNumber: false, paras: [], images: [{ dataUrl: LOGO, widthPx: 100 }] } },
        evenAndOddHeaders: false,
      };
    }
    const editHeader = (parse: unknown) => {
      const state = emptyHeaderFooterState();
      state.slots.header = { value: { text: "Mới" }, hasImages: true };
      const edits: DocxEdit[] = [{ op: "set_header_footer", slot: "header", hf: { text: "Mới" } }];
      return resolveDocxPrintHeaderFooter(readDocxPrintHeaderFooter(parse), state, edits);
    };

    it("edits every section that shares the part the final section's own reference names, as the save does", () => {
      // The save rewrites that part in place, so the earlier section prints the edit too, pictures kept.
      const hf = editHeader(twoSections(REF("header", "default", "rIdH")));
      expect(hf?.sections.map((section) => section.header.default?.text)).toEqual(["Mới", "Mới"]);
      expect(hf?.sections.map((section) => section.header.default?.images.length)).toEqual([1, 1]);
      // The even variant falls back to the same part, so it changed too.
      expect(hf?.sections[0]?.header.even?.text).toBe("Mới");
    });

    it("edits the final section alone when it only inherits the reference", () => {
      // No own reference: the save writes a new part for the final section and leaves the earlier one.
      const hf = editHeader(twoSections(""));
      expect(hf?.sections.map((section) => section.header.default?.text)).toEqual(["Chung", "Mới"]);
      expect(hf?.sections[0]?.header.even?.text).toBe("Chung");
    });

    it("keeps the source's own references so the edit can find the shared part", () => {
      const source = readDocxPrintHeaderFooter(twoSections(REF("header", "default", "rIdH")));
      expect(source?.finalOwnRefs).toEqual({ header: { default: "rIdH" }, footer: {} });
      expect(source?.sections.map((section) => section.refs?.header.default)).toEqual(["rIdH", "rIdH"]);
    });
  });

  it("uses the document-level state alone when the parse gave nothing", () => {
    const state = emptyHeaderFooterState();
    state.slots.footer = { value: { text: "Chân trang", pageNumber: true }, hasImages: false };
    const hf = resolveDocxPrintHeaderFooter(null, state, []);
    expect(hf?.sections).toHaveLength(1);
    expect(hf?.sections[0]?.footer.default).toMatchObject({ text: "Chân trang", pageNumber: true });
    // One document-level entry covers every section.
    expect(sectionHeaderFooter(hf, 4)).toBe(hf?.sections[0]);
    expect(resolveDocxPrintHeaderFooter(null, null, [])).toBeNull();
  });
});

describe("printedHfKey", () => {
  it("keys parts by what they print, so equal parts under different ids are one", () => {
    const logo = { dataUrl: LOGO, widthPx: 100, align: "left" as const };
    const a = sectionHf({ header: { default: part("rId1", { text: "Chương", images: [logo] }), first: null, even: null } });
    const same = sectionHf({ header: { default: part("edit:header", { text: "Chương", images: [{ ...logo }] }), first: null, even: null } });
    const other = sectionHf({ header: { default: part("rId1", { text: "Chương", images: [{ ...logo, widthPx: 50 }] }), first: null, even: null } });
    expect(printedHfKey(a, false)).toBe(printedHfKey(same, false));
    expect(printedHfKey(a, false)).not.toBe(printedHfKey(other, false));
    expect(printedHfKey(a, false)).not.toBe(printedHfKey(sectionHf(), false));
  });

  it("keys the parts a page prints on every page, not the first-page ones", () => {
    const a = sectionHf({ header: { default: part("h"), first: part("f1"), even: part("e") } });
    const b = sectionHf({ header: { default: part("h"), first: null, even: part("e2") } });
    expect(printedHfKey(a, false)).toBe(printedHfKey(b, false));
    expect(printedHfKey(a, true)).not.toBe(printedHfKey(b, true));
    expect(printedHfKey(null, true)).toBe("");
  });
});

describe("headerFooterPageRules", () => {
  it("prints text, page fields and pictures in the named page's margin boxes", () => {
    const hf = readDocxPrintHeaderFooter(parsed());
    const [s0, s1] = hf?.sections ?? [];
    const shared = context();
    const first = headerFooterPageRules("docx-s0", s0 ?? null, false, true, shared).join("\n");
    expect(first).toContain('@page docx-s0 {\n  @top-center { content: "Chương 1"; white-space: pre-wrap; font-size: 9pt; }');
    expect(first).toContain('@bottom-center { content: "Trang " counter(page) " / " counter(pages);');
    // The image-only first-page header: the logo at its display width (200px natural / 100px = 2x), right box; the default text is blanked.
    expect(first).toContain(`@page docx-s0:first {\n  @top-left { content: none; }\n  @top-center { content: none; }\n  @top-right { content: image-set(var(--docx-hf-img-0) 2x);`);
    const later = headerFooterPageRules("docx-s1", s1 ?? null, false, false, shared).join("\n");
    expect(later).toContain("@top-left { content: var(--docx-hf-img-0);");
    expect(later).not.toContain(":first");
  });

  it("defines a picture once for every rule that prints it", () => {
    const shared = context();
    const logo = { dataUrl: LOGO, widthPx: 100, align: "left" as const };
    const section = sectionHf({
      titlePg: true,
      header: { default: part("h", { images: [logo] }), first: part("f", { images: [logo] }), even: part("e", { images: [{ ...logo, align: "right" }] }) },
    });
    const rules = [
      ...headerFooterPageRules("docx-s0", section, true, true, shared),
      ...headerFooterPageRules("docx-s1", section, true, false, shared),
    ].join("\n");
    // The rules carry no picture bytes: they all name the one custom property.
    expect(rules).not.toContain("data:image");
    expect(rules.match(/var\(--docx-hf-img-0\)/g)).toHaveLength(5);
    expect(rules).not.toContain("--docx-hf-img-1");
    const root = shared.images.rootRule();
    expect(root).toBe(`:root {\n  --docx-hf-img-0: url("${LOGO}");\n}`);
    expect(new DocxPrintHfImageDefs().rootRule()).toBeNull();
  });

  it("scales a header picture taller than the top margin to the margin box", () => {
    const tall = { dataUrl: pngDataUrl(300, 200), widthPx: 300, align: "left" as const };
    const section = sectionHf({
      header: { default: part("h", { images: [tall] }), first: null, even: null },
      footer: { default: part("f", { images: [tall] }), first: null, even: null },
    });
    const rules = headerFooterPageRules("p", section, false, false, context({ marginTopPx: 100, marginBottomPx: 400 })).join("\n");
    // 200 px tall in a 100 px margin: half size. The footer margin is tall enough: unscaled.
    expect(rules).toContain("@top-left { content: image-set(var(--docx-hf-img-0) 2x);");
    expect(rules).toContain("@bottom-left { content: var(--docx-hf-img-0);");
  });

  it("prints the even parts on :left pages and blanks what they leave empty", () => {
    const section = sectionHf({
      header: { default: part("Odd"), first: null, even: part("Even") },
      footer: { default: part("Foot"), first: null, even: null },
    });
    const rules = headerFooterPageRules("docx-s1", section, true, false, context()).join("\n");
    expect(rules).toContain('@page docx-s1:left {\n  @top-left { content: none; }\n  @top-center { content: "Even";');
    expect(rules).toContain("  @bottom-center { content: none; }");
    expect(headerFooterPageRules("docx-s1", null, true, true, context())).toEqual([]);
    // A section without parts prints no base rule.
    expect(headerFooterPageRules("docx-s1", sectionHf(), false, false, context())).toEqual([]);
  });

  it("appends the page number after the text when the part has no PAGE field", () => {
    const section = sectionHf({ footer: { default: part("x", { text: "Trang", pageNumber: true }), first: null, even: null } });
    expect(headerFooterPageRules("p", section, false, false, context()).join("\n")).toContain('@bottom-center { content: "Trang" " " counter(page);');
  });
});

describe("header/footer pictures", () => {
  it("keeps raster data: pictures only and leaves page decoration out", () => {
    const images = printableHfImages([
      { dataUrl: LOGO, align: "center" },
      { dataUrl: "https://tracker.example/logo.png" },
      { dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
      { dataUrl: 'data:image/png;base64,AAAA");}body{x:url(' },
      { dataUrl: LOGO, watermark: true },
      { dataUrl: LOGO, behind: true },
      { dataUrl: "", wordArt: { text: "MẬT" } },
      { dataUrl: LOGO, posH: "right", widthPx: -1 },
      null,
    ]);
    expect(images).toEqual([
      { dataUrl: LOGO, align: "center" },
      { dataUrl: LOGO, align: "right" },
    ]);
  });

  it("scales a picture to its display size from the decoded natural size", () => {
    const at = (image: Parameters<typeof hfImageContent>[0], boxHeightPx = 1000): string => {
      const defs = new DocxPrintHfImageDefs();
      const content = hfImageContent(image, { defs, boxHeightPx });
      // Every picture is carried through the one definition, never inline.
      expect(content).not.toContain("data:");
      return content;
    };
    expect(at({ dataUrl: jpegDataUrl(300, 90), widthPx: 100, align: "left" })).toBe("image-set(var(--docx-hf-img-0) 3x)");
    expect(at({ dataUrl: LOGO, heightPx: 100, align: "left" })).toBe("image-set(var(--docx-hf-img-0) 0.5x)");
    expect(at({ dataUrl: LOGO, widthPx: 200, align: "left" })).toBe("var(--docx-hf-img-0)");
    // A picture taller than the margin box is scaled down to it, whatever size the part asks for.
    expect(at({ dataUrl: LOGO, widthPx: 200, align: "left" }, 25)).toBe("image-set(var(--docx-hf-img-0) 2x)");
    expect(at({ dataUrl: LOGO, align: "left" }, 10)).toBe("image-set(var(--docx-hf-img-0) 5x)");
    expect(at({ dataUrl: LOGO, widthPx: 100, align: "left" }, 25)).toBe("image-set(var(--docx-hf-img-0) 2x)");
    // An unreadable header keeps the intrinsic size.
    expect(at({ dataUrl: "data:image/webp;base64,UklGRg==", widthPx: 10, align: "left" }, 5)).toBe("var(--docx-hf-img-0)");
    expect(at({ dataUrl: "javascript:x", align: "left" })).toBe("");
  });
});
