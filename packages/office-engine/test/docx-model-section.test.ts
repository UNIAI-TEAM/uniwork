// B4 section-properties tests: one typed op rewrites margins, orientation,
// paper size, columns and start type of one section; the final section rides
// SaveOptions.trailingSectPr, an earlier section's sectPr is rewritten inside
// its section-break paragraph. Untouched sections keep their exact bytes.
import { describe, expect, it } from "vitest";
import {
  createDocxAdapter,
  DocxSessionModel,
  docxSections,
  readSectionSnapshot,
  type DocxBlock,
  type DocxParsed,
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

const SECT_PR = (opts: { landscape?: boolean; margins?: string; cols?: string; type?: string; extra?: string } = {}) => {
  const size = opts.landscape ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' : '<w:pgSz w:w="11906" w:h="16838"/>';
  return (
    "<w:sectPr>" +
    (opts.type ? `<w:type w:val="${opts.type}"/>` : "") +
    size +
    (opts.margins ??
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>') +
    (opts.cols ?? "") +
    (opts.extra ?? "") +
    "</w:sectPr>"
  );
};

const breakPara = (sectPr: string) => `<w:p><w:pPr>${sectPr}</w:pPr></w:p>`;

/** Two sections: block 1 is the visible break paragraph (section 0), block 3
 * the hidden trailing sectPr (section 1). */
const twoSectionParsed = (sectPr = SECT_PR({ landscape: true }), trailing = SECT_PR()): DocxParsed => ({
  blocks: [
    { type: "paragraph", docxIndex: 0, runs: [{ text: "first" }], originalXml: P("first") },
    { type: "paragraph", docxIndex: 1, runs: [], originalXml: breakPara(sectPr) },
    { type: "paragraph", docxIndex: 2, runs: [{ text: "second" }], originalXml: P("second") },
    { type: "sectPr", docxIndex: 3, hidden: true, originalXml: trailing },
  ] as DocxBlock[],
});

const singleSectionParsed = (trailing = SECT_PR()): DocxParsed => ({
  blocks: [
    { type: "paragraph", docxIndex: 0, runs: [{ text: "only" }], originalXml: P("only") },
    { type: "sectPr", docxIndex: 1, hidden: true, originalXml: trailing },
  ] as DocxBlock[],
});

describe("docxSections", () => {
  it("enumerates every section in document order and marks the trailing target", () => {
    const sections = docxSections(twoSectionParsed());
    expect(sections.map((s) => [s.index, s.firstBlockIndex, s.lastBlockIndex, s.breakDocxIndex])).toEqual([
      [0, 0, 1, 1],
      [1, 2, 3, null],
    ]);
    expect(sections[0]!.sectPrXml).toContain('w:orient="landscape"');
    expect(sections[1]!.sectPrXml).toContain("<w:pgMar");
  });

  it("yields one uneditable section for a parse with no sectPr", () => {
    const parsed: DocxParsed = { blocks: [{ type: "paragraph", docxIndex: 0, originalXml: P("a") }] as DocxBlock[] };
    const sections = docxSections(parsed);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.sectPrXml).toBe("");
    const model = new DocxSessionModel(parsed);
    expect(errCode(() => model.setSectionProperties(0, { marginTop: 720 }))).toBe("no_section_sectPr");
  });

  it("reads the slice's own numbers with upstream defaults", () => {
    expect(readSectionSnapshot(SECT_PR({ landscape: true }))).toMatchObject({
      pageWidth: 16838,
      pageHeight: 11906,
      orientation: "landscape",
      columns: 1,
      columnSpace: 720,
      startType: "nextPage",
      marginTop: 1440,
    });
    expect(readSectionSnapshot("<w:sectPr/>")).toMatchObject({ pageWidth: 12240, pageHeight: 15840, orientation: "portrait", columns: 1 });
  });
});

describe("set_section_properties — final section via trailingSectPr", () => {
  it("rewrites margins in the hidden trailing block, leaving every other byte", () => {
    const trailing = SECT_PR({ cols: '<w:cols w:space="425"/>', extra: '<w:pgBorders w:offsetFrom="page"><w:top w:val="single" w:sz="4" w:space="24" w:color="auto"/></w:pgBorders>' });
    const parsed = twoSectionParsed(SECT_PR({ landscape: true }), trailing);
    const model = new DocxSessionModel(parsed);
    model.setSectionProperties(1, { marginTop: 720, marginLeft: 720 });
    const { finalBlocks, options } = model.savePlan();
    expect(finalBlocks.every((b) => b.kind === "original")).toBe(true);
    expect(options.section).toBeUndefined();
    expect(options.trailingSectPr).toContain('w:top="720"');
    expect(options.trailingSectPr).toContain('w:left="720"');
    expect(options.trailingSectPr).toContain('w:right="1440"');
    // unmodeled children survive: page borders and the column gap are kept
    expect(options.trailingSectPr).toContain("<w:pgBorders");
    expect(options.trailingSectPr).toContain('<w:cols w:space="425"/>');
    expect(options.trailingSectPr).toContain('w:gutter="0"');
  });

  it("applies paper size and orientation with explicit dimensions", () => {
    const model = new DocxSessionModel(singleSectionParsed());
    model.setSectionProperties(0, { pageWidth: 11906, pageHeight: 16838, orientation: "landscape" });
    const { options } = model.savePlan();
    expect(options.trailingSectPr).toContain('<w:pgSz w:w="11906" w:h="16838" w:orient="landscape"/>');
  });

  it("swaps w/h for an orientation-only edit and removes the attr going back to portrait", () => {
    const model = new DocxSessionModel(singleSectionParsed(SECT_PR({ landscape: true })));
    model.setSectionProperties(0, { orientation: "portrait" });
    expect(model.savePlan().options.trailingSectPr).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(model.savePlan().options.trailingSectPr).not.toContain("w:orient");
  });

  it("writes columns with equal widths and rebuilds on a count change", () => {
    const withColumns = SECT_PR({ cols: '<w:cols w:num="2" w:space="400"><w:col w:w="3000" w:space="400"/><w:col w:w="6000"/></w:cols>' });
    const model = new DocxSessionModel(singleSectionParsed(withColumns));
    model.setSectionProperties(0, { columnSpace: 425 });
    expect(model.savePlan().options.trailingSectPr).toContain('<w:cols w:num="2" w:space="425"><w:col w:w="3000" w:space="400"/><w:col w:w="6000"/></w:cols>');
    model.setSectionProperties(0, { columns: 3 });
    expect(model.savePlan().options.trailingSectPr).toContain('<w:cols w:num="3" w:space="425"/>');
    model.setSectionProperties(0, { columns: 1 });
    expect(model.savePlan().options.trailingSectPr).toContain('<w:cols w:space="425"/>');
  });

  it("inserts, replaces and removes the section start type at its schema slot", () => {
    const model = new DocxSessionModel(singleSectionParsed(SECT_PR({ type: "continuous" })));
    model.setSectionProperties(0, { startType: "evenPage" });
    expect(model.savePlan().options.trailingSectPr).toContain('<w:type w:val="evenPage"/><w:pgSz');
    model.setSectionProperties(0, { startType: "nextPage" });
    expect(model.savePlan().options.trailingSectPr).not.toContain("<w:type");
  });

  it("merges successive edits (margins then orientation) instead of losing the first", () => {
    const model = new DocxSessionModel(singleSectionParsed());
    model.setSectionProperties(0, { marginTop: 567 });
    model.setSectionProperties(0, { orientation: "landscape" });
    const { options } = model.savePlan();
    expect(options.trailingSectPr).toContain('w:top="567"');
    expect(options.trailingSectPr).toContain('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>');
  });
});

describe("set_section_properties — non-final section via the break paragraph", () => {
  it("rewrites the section's sectPr in its break paragraph and leaves the rest original", () => {
    const parsed = twoSectionParsed(SECT_PR({ landscape: true }), SECT_PR());
    const model = new DocxSessionModel(parsed);
    model.setSectionProperties(0, { orientation: "portrait", marginTop: 720 });
    const { finalBlocks, options } = model.savePlan();
    const entry = finalBlocks[1];
    expect(entry?.kind).toBe("xml");
    if (entry?.kind !== "xml") throw new Error("expected xml entry");
    expect(entry.docxIndex).toBe(1);
    expect(entry.xml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(entry.xml).toContain('w:top="720"');
    expect(entry.xml.startsWith("<w:p>")).toBe(true);
    expect(entry.xml.endsWith("</w:p>")).toBe(true);
    expect(finalBlocks[0]).toEqual({ kind: "original", docxIndex: 0 });
    expect(finalBlocks[2]).toEqual({ kind: "original", docxIndex: 2 });
    expect(options.trailingSectPr).toBeUndefined();
  });

  it("does not touch an untouched trailing section when only an earlier one changes", () => {
    const trailing = SECT_PR({ extra: '<w:pgNumType w:start="5"/>' });
    const model = new DocxSessionModel(twoSectionParsed(SECT_PR({ landscape: true }), trailing));
    model.setSectionProperties(0, { marginBottom: 999 });
    const { options } = model.savePlan();
    expect(options.trailingSectPr).toBeUndefined();
    expect(options).toEqual({});
  });

  it("keeps the rewrite when the editor replaced the break paragraph (generated rawPPr)", () => {
    const parsed = twoSectionParsed(SECT_PR({ landscape: true }), SECT_PR());
    const model = new DocxSessionModel(parsed);
    const section = docxSections(parsed)[0]!;
    model.removeBlock(1);
    model.insertGenerated(1, { type: "paragraph", runs: [{ text: "tail" }], rawPPr: section.sectPrXml });
    model.setSectionProperties(0, { marginTop: 111 });
    const entry = model.savePlan().finalBlocks[1];
    expect(entry?.kind).toBe("generated");
    if (entry?.kind !== "generated") throw new Error("expected generated entry");
    expect(String((entry.block as { rawPPr?: unknown }).rawPPr)).toContain('w:top="111"');
    expect(String((entry.block as { rawPPr?: unknown }).rawPPr)).toContain('w:orient="landscape"');
  });

  it("rewrites an xml plan entry that carries the section's sectPr", () => {
    const parsed = twoSectionParsed(SECT_PR({ landscape: true }), SECT_PR());
    const model = new DocxSessionModel(parsed);
    const section = docxSections(parsed)[0]!;
    model.replaceBlockXml(1, `<w:p><w:pPr>${section.sectPrXml}</w:pPr><w:r><w:t>edited</w:t></w:r></w:p>`);
    model.setSectionProperties(0, { columns: 2, columnSpace: 425 });
    const entry = model.savePlan().finalBlocks[1];
    expect(entry?.kind).toBe("xml");
    if (entry?.kind !== "xml") throw new Error("expected xml entry");
    expect(entry.xml).toContain('<w:cols w:num="2" w:space="425"/>');
    expect(entry.xml).toContain("edited");
  });
});

describe("set_section_properties — refusals and byte preservation", () => {
  it("refuses a bad section index, negative margins and bad numbers with typed codes", () => {
    const model = new DocxSessionModel(twoSectionParsed());
    expect(errCode(() => model.setSectionProperties(-1, { marginTop: 1 }))).toBe("bad_section_index");
    expect(errCode(() => model.setSectionProperties(1.5, { marginTop: 1 }))).toBe("bad_section_index");
    expect(errCode(() => model.setSectionProperties(9, { marginTop: 1 }))).toBe("bad_section_index");
    expect(errCode(() => model.setSectionProperties(0, { marginTop: -1 }))).toBe("bad_margin");
    expect(errCode(() => model.setSectionProperties(0, { marginLeft: Number.NaN }))).toBe("bad_margin");
    expect(errCode(() => model.setSectionProperties(0, { pageWidth: 0 }))).toBe("bad_page_size");
    expect(errCode(() => model.setSectionProperties(0, { columns: 0 }))).toBe("bad_columns");
    expect(errCode(() => model.setSectionProperties(0, { columns: 2.5 }))).toBe("bad_columns");
    expect(errCode(() => model.setSectionProperties(0, { columns: 99 }))).toBe("bad_columns");
    expect(errCode(() => model.setSectionProperties(0, { columnSpace: -5 }))).toBe("bad_column_space");
    expect(errCode(() => model.setSectionProperties(0, { orientation: "sideways" as "portrait" }))).toBe("bad_section_orientation");
    expect(errCode(() => model.setSectionProperties(0, { startType: "sometimes" as "nextPage" }))).toBe("bad_section_start_type");
    expect(errCode(() => model.setSectionProperties(0, {}))).toBe("empty_section_properties");
    expect(errCode(() => model.setSectionProperties(0, { nope: 1 } as never))).toBe("bad_section_properties");
    // a refused edit never dirties the model
    expect(model.isDirty).toBe(false);
    expect(model.revision).toBe(0);
    expect(model.savePlan().options).toEqual({});
  });

  it("an untouched document saves the all-original plan with no options", () => {
    const model = new DocxSessionModel(twoSectionParsed());
    expect(model.isDirty).toBe(false);
    const { finalBlocks, options } = model.savePlan();
    expect(options).toEqual({});
    expect(finalBlocks).toEqual([
      { kind: "original", docxIndex: 0 },
      { kind: "original", docxIndex: 1 },
      { kind: "original", docxIndex: 2 },
    ]);
  });

  it("applies through the adapter: a non-final section edit lands as an xml block", async () => {
    const source = makeFakeDocxBytes({
      blocks: [
        { type: "paragraph", runs: [{ text: "first" }] },
        { type: "paragraph", originalXml: breakPara(SECT_PR({ landscape: true })), runs: [] },
        { type: "paragraph", runs: [{ text: "second" }] },
        { type: "sectPr", hidden: true, originalXml: SECT_PR() },
      ],
    });
    const adapter = createDocxAdapter({ engine: createFakeDocxEngine() });
    const opened = await adapter.open({ bytes: source, format: "docx", document_id: "doc-sections" });
    if (opened.outcome !== "opened") throw new Error("open failed");
    const ref = opened.document_model_ref;
    expect(await (await adapter.serialize({ document_model_ref: ref, format: "docx" })).bytes).toEqual(source);

    adapter.edit(ref, { op: "set_section_properties", sectionIndex: 0, properties: { marginTop: 720 } });
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const pkg = decodeFakeDocx(saved.bytes);
    const fragment = pkg.blocks.find((b) => b.type === "xml-fragment");
    expect(fragment).toBeDefined();
    expect(String(fragment?.xml)).toContain('w:top="720"');
    expect(String(fragment?.xml)).toContain('w:orient="landscape"');
    expect(pkg.blocks.filter((b) => b.type === "paragraph")).toHaveLength(2);
  });

  it("rebase drains the section edits (a two-save chain does not replay them)", () => {
    const model = new DocxSessionModel(twoSectionParsed());
    model.setSectionProperties(1, { marginTop: 720 });
    expect(model.savePlan().options.trailingSectPr).toBeDefined();
    const rebased = twoSectionParsed(SECT_PR({ landscape: true }), SECT_PR({ margins: '<w:pgMar w:top="720" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>' }));
    model.rebase(rebased);
    expect(model.savePlan().options).toEqual({});
    expect(model.isDirty).toBe(false);
  });
});
