// B6 page-decoration tests: page colour, text watermark and theme pair reach
// SaveOptions untouched when the editor never touched them; page borders have
// no save option and rewrite one section's w:sectPr through the section seam
// (trailingSectPr for the final section, the break paragraph otherwise).
import { describe, expect, it } from "vitest";
import {
  createDocxAdapter,
  DocxSessionModel,
  isPageDecorEdit,
  readPageBorders,
  readPageDecor,
  type DocxBlock,
  type DocxParsed,
  type DocxSaveOptions,
} from "../src/docx";
import { createFakeDocxEngine, decodeFakeDocx, makeFakeDocxBytes } from "./fake-docx-engine";

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

const P = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const SECT_PR = (extra = "") =>
  `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>${extra}</w:sectPr>`;
const breakPara = (sectPr: string) => `<w:p><w:pPr>${sectPr}</w:pPr></w:p>`;

/** Two sections: block 1 carries section 0's sectPr, block 3 the trailing one. */
const twoSectionParsed = (extra: { documentXml?: string; sectPr0?: string } = {}): DocxParsed => ({
  blocks: [
    { type: "paragraph", docxIndex: 0, runs: [{ text: "first" }], originalXml: P("first") },
    { type: "paragraph", docxIndex: 1, runs: [], originalXml: breakPara(extra.sectPr0 ?? SECT_PR()) },
    { type: "paragraph", docxIndex: 2, runs: [{ text: "second" }], originalXml: P("second") },
    { type: "sectPr", docxIndex: 3, hidden: true, originalXml: SECT_PR() },
  ] as DocxBlock[],
  ...(extra.documentXml !== undefined ? { internal: { documentXml: extra.documentXml } } : {}),
});

const singleSectionParsed = (sectPr = SECT_PR()): DocxParsed => ({
  blocks: [
    { type: "paragraph", docxIndex: 0, runs: [{ text: "only" }], originalXml: P("only") },
    { type: "sectPr", docxIndex: 1, hidden: true, originalXml: sectPr },
  ] as DocxBlock[],
});

describe("readPageDecor", () => {
  it("reads the page colour from document.xml, the watermark, the theme and every section's box", () => {
    const parsed: DocxParsed = {
      ...twoSectionParsed({
        documentXml: '<w:document><w:background w:color="f2f2f2"/><w:body/></w:document>',
        sectPr0: SECT_PR('<w:pgBorders w:offsetFrom="page"><w:top w:val="double" w:sz="12" w:space="8" w:color="44546A"/><w:left w:val="none"/></w:pgBorders>'),
      }),
      watermarkText: "CONFIDENTIAL",
      watermarkPicture: null,
      themeFonts: { major: "Calibri Light", minor: "Calibri", eastAsia: "等线" },
      themeColors: { name: "Office", dk2: "44546A", accent1: "4472C4", hlink: "0563C1" },
    };
    const snapshot = readPageDecor(parsed);
    expect(snapshot.pageColor).toBe("F2F2F2");
    expect(snapshot.watermarkText).toBe("CONFIDENTIAL");
    expect(snapshot.hasPictureWatermark).toBe(false);
    expect(snapshot.themeFonts).toEqual({ major: "Calibri Light", minor: "Calibri", eastAsia: "等线" });
    // read-only slots (hlink) are not part of the writeable snapshot
    expect(snapshot.themeColors).toEqual({ name: "Office", dk2: "44546A", accent1: "4472C4" });
    expect(snapshot.sections).toEqual([
      { index: 0, firstBlockIndex: 0, lastBlockIndex: 1, borders: { style: "double", widthEighths: 12, colorHex: "44546A", spacePt: 8, offsetFrom: "page" } },
      { index: 1, firstBlockIndex: 2, lastBlockIndex: 3, borders: null },
    ]);
  });

  it("treats explicit w:val=none sides as no box and a missing parse state as null", () => {
    expect(readPageBorders('<w:sectPr><w:pgBorders><w:top w:val="none"/><w:left w:val="nil"/></w:pgBorders></w:sectPr>')).toBeNull();
    expect(readPageBorders("<w:sectPr/>")).toBeNull();
    const snapshot = readPageDecor(singleSectionParsed());
    expect(snapshot.pageColor).toBeNull();
    expect(snapshot.watermarkText).toBeNull();
    expect(snapshot.themeFonts).toBeNull();
    expect(snapshot.themeColors).toBeNull();
    expect(snapshot.sections[0]!.borders).toBeNull();
  });
});

describe("set_page_color", () => {
  it("sets, normalizes and removes the background; untouched saves stay byte-clean", () => {
    const model = new DocxSessionModel(singleSectionParsed());
    expect(model.savePlan().options).toEqual({});
    model.setPageColor("#fff9e6");
    expect(model.isDirty).toBe(true);
    expect(model.savePlan().options.pageColor).toBe("FFF9E6");
    model.setPageColor(null);
    expect(model.savePlan().options.pageColor).toBeNull();
    expect(model.revision).toBe(2);
  });

  it("refuses a non-hex colour without dirtying the model", () => {
    const model = new DocxSessionModel(singleSectionParsed());
    expect(errCode(() => model.setPageColor("yellow"))).toBe("bad_page_color");
    expect(errCode(() => model.setPageColor("#FFF"))).toBe("bad_page_color");
    expect(model.isDirty).toBe(false);
    expect(model.savePlan().options).toEqual({});
  });
});

describe("set_watermark", () => {
  it("carries the spec into SaveOptions and null removes it", () => {
    const model = new DocxSessionModel(singleSectionParsed());
    model.setWatermark({ text: "DRAFT", fontFamily: "Arial", colorHex: "#aabbcc", opacity: 0.4, diagonal: false });
    expect(model.savePlan().options.watermark).toEqual({
      text: "DRAFT",
      fontFamily: "Arial",
      colorHex: "AABBCC",
      opacity: 0.4,
      diagonal: false,
    });
    model.setWatermark(null);
    expect(model.savePlan().options.watermark).toBeNull();
  });

  it("refuses blank text, an out-of-range opacity and a bad colour", () => {
    const model = new DocxSessionModel(singleSectionParsed());
    expect(errCode(() => model.setWatermark({ text: "   " }))).toBe("empty_watermark_text");
    expect(errCode(() => model.setWatermark({ text: "DRAFT", opacity: 2 }))).toBe("bad_watermark_opacity");
    expect(errCode(() => model.setWatermark({ text: "DRAFT", colorHex: "red" }))).toBe("bad_watermark");
    expect(errCode(() => model.setWatermark({ text: "DRAFT", fontFamily: "" }))).toBe("bad_watermark");
    expect(model.isDirty).toBe(false);
  });
});

describe("theme fonts / colours", () => {
  it("writes the pair and the scheme slots into SaveOptions", () => {
    const model = new DocxSessionModel(singleSectionParsed());
    model.setThemeFonts({ major: "Trebuchet MS", minor: "Trebuchet MS" });
    model.setThemeColors({ name: "Facet", dk2: "#3E3D2D", accent1: "90C226" });
    const options = model.savePlan().options;
    expect(options.themeFonts).toEqual({ major: "Trebuchet MS", minor: "Trebuchet MS" });
    expect(options.themeColors).toEqual({ name: "Facet", dk2: "3E3D2D", accent1: "90C226" });
  });

  it("refuses an incomplete font pair, an unknown colour slot and an empty scheme", () => {
    const model = new DocxSessionModel(singleSectionParsed());
    expect(errCode(() => model.setThemeFonts({ major: "Arial", minor: " " }))).toBe("bad_theme_fonts");
    expect(errCode(() => model.setThemeFonts({ major: "", minor: "Arial" }))).toBe("bad_theme_fonts");
    expect(errCode(() => model.setThemeColors({ accent7: "000000" } as never))).toBe("bad_theme_colors");
    expect(errCode(() => model.setThemeColors({}))).toBe("empty_theme_colors");
    expect(errCode(() => model.setThemeColors({ accent1: "blue" }))).toBe("bad_theme_colors");
    expect(model.isDirty).toBe(false);
  });
});

describe("set_page_borders", () => {
  it("writes the box into the final section's trailingSectPr at its schema slot", () => {
    const model = new DocxSessionModel(singleSectionParsed(SECT_PR('<w:cols w:num="2" w:space="425"/>')));
    // the fixture has one section; the product's section index is 0-based
    // (docxSections/readSections order, like setSectionProperties)
    model.setPageBorders(0, { style: "single", widthEighths: 8, colorHex: "#44546a", spacePt: 24, offsetFrom: "page" });
    const trailing = model.savePlan().options.trailingSectPr;
    expect(trailing).toContain('<w:pgBorders w:offsetFrom="page">');
    const box = /<w:pgBorders[\s\S]*?<\/w:pgBorders>/.exec(trailing ?? "")?.[0] ?? "";
    expect(box.match(/<w:(top|left|bottom|right)\b/g)).toHaveLength(4);
    expect(box).toContain('<w:top w:val="single" w:sz="8" w:space="24" w:color="44546A"/>');
    // still before w:cols, and the rest of the slice is untouched
    expect(trailing).toContain('</w:pgBorders><w:cols w:num="2" w:space="425"/>');
    expect(trailing).toContain('<w:pgMar w:top="1440"');
  });

  it("replaces an existing box and null removes it", () => {
    const existing = '<w:pgBorders w:offsetFrom="text"><w:top w:val="single" w:sz="4" w:space="24" w:color="auto"/></w:pgBorders>';
    const model = new DocxSessionModel(singleSectionParsed(SECT_PR(existing)));
    model.setPageBorders(0, { style: "double", widthEighths: 12, offsetFrom: "page" });
    const replaced = model.savePlan().options.trailingSectPr ?? "";
    expect(replaced).not.toContain('w:val="single"');
    expect(replaced).toContain('<w:top w:val="double" w:sz="12" w:space="24" w:color="auto"/>');
    model.setPageBorders(0, null);
    expect(model.savePlan().options.trailingSectPr ?? "").not.toContain("<w:pgBorders");
  });

  it("rewrites an earlier section's break paragraph and leaves the trailing section alone", () => {
    const model = new DocxSessionModel(twoSectionParsed());
    model.setPageBorders(0, { style: "dashed", offsetFrom: "page" });
    const { finalBlocks, options } = model.savePlan();
    expect(options.trailingSectPr).toBeUndefined();
    const entry = finalBlocks[1];
    expect(entry?.kind).toBe("xml");
    if (entry?.kind !== "xml") throw new Error("expected xml entry");
    expect(entry.xml).toContain('<w:pgBorders w:offsetFrom="page">');
    expect(entry.xml).toContain('<w:top w:val="dashed" w:sz="4" w:space="24" w:color="auto"/>');
    expect(finalBlocks[0]).toEqual({ kind: "original", docxIndex: 0 });
  });

  it("combines with a B4 page-setup edit on the same section", () => {
    const model = new DocxSessionModel(singleSectionParsed());
    model.setSectionProperties(0, { marginTop: 720 });
    model.setPageBorders(0, { style: "single" });
    const trailing = model.savePlan().options.trailingSectPr ?? "";
    expect(trailing).toContain('w:top="720"');
    expect(trailing).toContain("<w:pgBorders>");
    expect(trailing).toContain('<w:bottom w:val="single" w:sz="4" w:space="24" w:color="auto"/>');
  });

  it("inserts the box before w:sectPrChange and expands a self-closing sectPr", () => {
    const changed = new DocxSessionModel(singleSectionParsed(SECT_PR('<w:sectPrChange w:id="1"/>')));
    changed.setPageBorders(0, { style: "double", widthEighths: 8 });
    const withChange = changed.savePlan().options.trailingSectPr ?? "";
    expect(withChange).toContain('</w:pgBorders><w:sectPrChange w:id="1"/>');

    const bare = new DocxSessionModel(singleSectionParsed("<w:sectPr/>"));
    bare.setPageBorders(0, { style: "single", widthEighths: 4 });
    const expanded = bare.savePlan().options.trailingSectPr ?? "";
    expect(expanded).toContain("<w:sectPr><w:pgBorders>");
    expect(expanded).toContain("</w:pgBorders></w:sectPr>");
  });

  it("refuses a bad section index, a section without sectPr and bad border values", () => {
    const model = new DocxSessionModel(twoSectionParsed());
    expect(errCode(() => model.setPageBorders(-1, { style: "single" }))).toBe("bad_section_index");
    expect(errCode(() => model.setPageBorders(9, { style: "single" }))).toBe("bad_section_index");
    const noSectPr: DocxParsed = { blocks: [{ type: "paragraph", docxIndex: 0, originalXml: P("a") }] as DocxBlock[] };
    const bare = new DocxSessionModel(noSectPr);
    expect(errCode(() => bare.setPageBorders(0, { style: "single" }))).toBe("no_section_sectPr");
    expect(errCode(() => model.setPageBorders(0, { style: "scribble" }))).toBe("bad_border_style");
    expect(errCode(() => model.setPageBorders(0, { style: "single", widthEighths: 1 }))).toBe("bad_border_size");
    expect(errCode(() => model.setPageBorders(0, { style: "single", widthEighths: 100 }))).toBe("bad_border_size");
    expect(errCode(() => model.setPageBorders(0, { style: "single", spacePt: -1 }))).toBe("bad_border_space");
    expect(errCode(() => model.setPageBorders(0, { style: "single", spacePt: 40 }))).toBe("bad_border_space");
    expect(errCode(() => model.setPageBorders(0, { style: "single", colorHex: "nope" }))).toBe("bad_page_borders");
    expect(model.isDirty).toBe(false);
  });

  it("drains the edits on rebase (a two-save chain does not replay them)", () => {
    const model = new DocxSessionModel(singleSectionParsed());
    model.setPageColor("E8F1FB");
    model.setPageBorders(0, { style: "single" });
    expect(model.savePlan().options.trailingSectPr).toBeDefined();
    model.rebase(singleSectionParsed(SECT_PR('<w:pgBorders><w:top w:val="single" w:sz="4" w:space="24" w:color="auto"/></w:pgBorders>')));
    expect(model.savePlan().options).toEqual({});
    expect(model.isDirty).toBe(false);
  });
});

describe("page-decor ops through applyEdit", () => {
  it("routes every op through the model and marks it dirty", () => {
    const model = new DocxSessionModel(twoSectionParsed());
    expect(isPageDecorEdit({ op: "set_page_color" })).toBe(true);
    expect(isPageDecorEdit({ op: "set_paragraph_text" })).toBe(false);
    model.applyEdit({ op: "set_page_color", color: "FFF9E6" });
    model.applyEdit({ op: "set_watermark", watermark: { text: "DRAFT" } });
    model.applyEdit({ op: "set_theme_fonts", fonts: { major: "Arial", minor: "Arial" } });
    model.applyEdit({ op: "set_theme_colors", colors: { accent1: "ED7D31" } });
    model.applyEdit({ op: "set_page_borders", sectionIndex: 0, borders: { style: "wave" } });
    expect(model.isDirty).toBe(true);
    expect(model.revision).toBe(5);
    const { finalBlocks, options } = model.savePlan();
    expect(options.pageColor).toBe("FFF9E6");
    expect(options.watermark).toEqual({ text: "DRAFT" });
    expect(options.themeFonts).toEqual({ major: "Arial", minor: "Arial" });
    expect(options.themeColors).toEqual({ accent1: "ED7D31" });
    expect(finalBlocks[1]?.kind).toBe("xml");
  });

  it("reaches the save through the adapter with the options and the rewritten section", async () => {
    const source = makeFakeDocxBytes({
      blocks: [
        { type: "paragraph", runs: [{ text: "first" }] },
        { type: "paragraph", originalXml: breakPara(SECT_PR()), runs: [] },
        { type: "paragraph", runs: [{ text: "second" }] },
        { type: "sectPr", hidden: true, originalXml: SECT_PR() },
      ],
    });
    const base = createFakeDocxEngine();
    let saved: DocxSaveOptions | undefined;
    const adapter = createDocxAdapter({
      engine: {
        ...base,
        saveDocx: (parsed, blocks, options) => {
          saved = options;
          return base.saveDocx(parsed, blocks, options);
        },
      },
    });
    const opened = await adapter.open({ bytes: source, format: "docx", document_id: "doc-decor" });
    if (opened.outcome !== "opened") throw new Error("open failed");
    const ref = opened.document_model_ref;

    adapter.edit(ref, { op: "set_page_color", color: "E8F1FB" });
    adapter.edit(ref, { op: "set_watermark", watermark: { text: "DRAFT" } });
    adapter.edit(ref, { op: "set_theme_colors", colors: { accent1: "4472C4" } });
    adapter.edit(ref, { op: "set_page_borders", sectionIndex: 0, borders: { style: "single", widthEighths: 8, offsetFrom: "page" } });
    const savedBytes = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    expect(saved?.pageColor).toBe("E8F1FB");
    expect(saved?.watermark).toEqual({ text: "DRAFT" });
    expect(saved?.themeColors).toEqual({ accent1: "4472C4" });
    const pkg = decodeFakeDocx(savedBytes.bytes);
    const fragment = pkg.blocks.find((b) => b.type === "xml-fragment");
    expect(fragment).toBeDefined();
    expect(String(fragment?.xml)).toContain('<w:pgBorders w:offsetFrom="page">');
    expect(String(fragment?.xml)).toContain('w:val="single"');
  });
});
