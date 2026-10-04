// B7 field tests: the model turns a heading list into a TOC field fragment
// (one plan row, begin/end fldChars paired, dirty begin for Word's rebuild)
// and a caption paragraph carrying a SEQ field whose number continues the
// document's own captions. Every op goes through the model's edit channel;
// every refusal is typed — callers branch on `code`, never on message text.
// The fake engine carries arbitrary block fields, so a block's own XML can
// stand in for the parse's originalXml.
import { describe, expect, it } from "vitest";
import {
  createDocxAdapter,
  DocxSessionModel,
  isDocxCaptionInstr,
  type DocxSaveOptions,
  type DocxTocEntry,
  type DocxTocOptions,
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

const HEADINGS: DocxTocEntry[] = [
  { level: 1, text: "Introduction", anchor: "_Toc100" },
  { level: 2, text: "Details" },
];

function insertToc(model: DocxSessionModel, index: number, entries: DocxTocEntry[], options?: DocxTocOptions): void {
  model.applyEdit({ op: "insert_toc", index, entries, options });
}

function updateToc(model: DocxSessionModel, entries: DocxTocEntry[], options?: DocxTocOptions): void {
  model.applyEdit({ op: "update_toc", entries, options });
}

function insertCaption(model: DocxSessionModel, index: number, label: string, text: string): void {
  model.applyEdit({ op: "insert_caption", index, label, text });
}

function docxWith(blocks: Array<Record<string, unknown>>): Uint8Array {
  return makeFakeDocxBytes({ blocks });
}

function bodyBlocks(): Array<Record<string, unknown>> {
  return [
    { type: "paragraph", runs: [{ text: "intro" }] },
    { type: "paragraph", runs: [{ text: "outro" }] },
  ];
}

async function openModel(blocks: Array<Record<string, unknown>> = bodyBlocks()) {
  const engine = createFakeDocxEngine();
  const parsed = await engine.parseDocx(docxWith(blocks));
  return { model: new DocxSessionModel(parsed), engine };
}

function xmlBlockAt(model: DocxSessionModel, at: number): string {
  const block = model.savePlan().finalBlocks[at];
  if (!block || block.kind !== "xml") throw new Error("block " + at + " is not xml");
  return block.xml;
}

function tocXml(model: DocxSessionModel): string {
  const blocks = model.savePlan().finalBlocks;
  const at = blocks.findIndex((block) => block.kind === "xml" && block.xml.includes("instrText"));
  if (at < 0) throw new Error("no TOC xml block in the plan");
  return xmlBlockAt(model, at);
}

describe("docx TOC model", () => {
  it("inserts one field fragment at a plan position with paired fldChars", async () => {
    const { model } = await openModel();
    insertToc(model, 1, HEADINGS, { maxLevel: 3, pageNumbers: true, hyperlinks: true });
    const plan = model.savePlan();
    expect(plan.finalBlocks.map((block) => block.kind)).toEqual(["original", "xml", "original"]);
    const xml = xmlBlockAt(model, 1);
    // instruction + dirty begin + separate + end, exactly once each
    expect(xml).toContain('\\o "1-3" \\h \\z \\u');
    expect(xml).toContain('w:fldCharType="begin" w:dirty="true"');
    expect(xml.match(/fldCharType="begin"/g)).toHaveLength(1);
    expect(xml.match(/fldCharType="separate"/g)).toHaveLength(1);
    expect(xml.match(/fldCharType="end"/g)).toHaveLength(1);
    expect(xml.match(/<w:p>/g)).toHaveLength(2);
    // first line carries the begin, last line closes the field
    expect(xml.indexOf('fldCharType="begin"')).toBeLessThan(xml.indexOf("Introduction"));
    expect(xml.lastIndexOf('fldCharType="end"')).toBeGreaterThan(xml.indexOf("Details"));
    // TOCn styles, page column and the hyperlink anchor
    expect(xml).toContain('<w:pStyle w:val="TOC1"/>');
    expect(xml).toContain('<w:pStyle w:val="TOC2"/>');
    expect(xml).toContain('<w:tab w:val="right" w:leader="dot" w:pos="9350"/>');
    expect(xml).toContain('<w:hyperlink w:anchor="_Toc100">');
    expect(xml).toContain('<w:t xml:space="preserve">Details</w:t>');
  });

  it("counts only levels inside maxLevel and filters the rest out", async () => {
    const { model } = await openModel();
    insertToc(model, 0, [...HEADINGS, { level: 3, text: "Deep" }, { level: 4, text: "Too deep" }], { maxLevel: 3 });
    const xml = tocXml(model);
    expect(xml).toContain('\\o "1-3"');
    expect(xml).toContain("Deep");
    expect(xml).not.toContain("Too deep");
    expect(xml.match(/<w:p>/g)).toHaveLength(3);
  });

  it("escapes entry text and the hyperlink anchor", async () => {
    const { model } = await openModel();
    insertToc(model, 0, [{ level: 1, text: 'A & B <"quoted">', anchor: '_Toc"A&B' }], { pageNumbers: false });
    const xml = tocXml(model);
    expect(xml).toContain("A &amp; B &lt;&quot;quoted&quot;&gt;");
    expect(xml).toContain('w:anchor="_Toc&quot;A&amp;B"');
  });

  it("writes the page column with the cached number and drops it when off", async () => {
    const { model } = await openModel();
    insertToc(model, 0, [{ level: 1, text: "Intro", pageNo: 3 }], { pageNumbers: true });
    const xml = tocXml(model);
    expect(xml).toContain("<w:tab/>");
    expect(xml).toContain("<w:t>3</w:t>");
    const { model: plain } = await openModel();
    insertToc(plain, 0, [{ level: 1, text: "Intro", pageNo: 3 }], { pageNumbers: false });
    expect(tocXml(plain)).not.toContain("<w:tab");
  });

  it("omits the hyperlink for an entry without an anchor or with hyperlinks off", async () => {
    const { model } = await openModel();
    insertToc(model, 0, [{ level: 1, text: "No anchor" }], { hyperlinks: true });
    expect(tocXml(model)).not.toContain("<w:hyperlink");
    const { model: off } = await openModel();
    insertToc(off, 0, HEADINGS, { hyperlinks: false });
    expect(tocXml(off)).not.toContain("<w:hyperlink");
  });

  it("refuses malformed payloads with typed codes and leaves the plan untouched", async () => {
    const { model } = await openModel();
    expect(errCode(() => insertToc(model, 0, []))).toBe("empty_toc");
    expect(errCode(() => insertToc(model, 0, [{ level: 5, text: "Deep" }], { maxLevel: 3 }))).toBe("empty_toc");
    expect(errCode(() => insertToc(model, 0, [{ level: 0, text: "Body" }]))).toBe("bad_toc_level");
    expect(errCode(() => insertToc(model, 0, [{ level: 1, text: "  " }]))).toBe("empty_toc_entry");
    expect(errCode(() => insertToc(model, 0, HEADINGS, { maxLevel: 10 }))).toBe("bad_toc_level");
    expect(errCode(() => insertToc(model, 0, [{ level: 1, text: "x", pageNo: 0 }]))).toBe("bad_toc_page");
    expect(errCode(() => insertToc(model, -1, HEADINGS))).toBe("bad_index");
    expect(errCode(() => insertToc(model, 3, HEADINGS))).toBe("bad_index");
    expect(errCode(() => insertToc(model, 0, Array.from({ length: 201 }, () => ({ level: 1, text: "h" }))))).toBe("toc_too_large");
    expect(model.isDirty).toBe(false);
    expect(model.savePlan().finalBlocks.map((block) => block.kind)).toEqual(["original", "original"]);
  });

  it("applies through the adapter op channel and serializes the fragment", async () => {
    const engine = createFakeDocxEngine();
    const adapter = createDocxAdapter({ engine });
    const opened = await adapter.open({ bytes: docxWith(bodyBlocks()), format: "docx", document_id: "doc-toc" });
    if (opened.outcome !== "opened") throw new Error("open failed");
    const result = adapter.edit(opened.document_model_ref, { op: "insert_toc", index: 0, entries: HEADINGS });
    expect(result.applied).toBe(true);
    expect(result.revision).toBe(1);
    const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "docx" });
    const planBlock = decodeFakeDocx(saved.bytes).blocks[0] as { type: string; xml?: string };
    expect(planBlock.type).toBe("xml-fragment");
    expect(planBlock.xml).toContain('\\o "1-3"');
  });

  it("skips entries above maxLevel when maxLevel is the default", async () => {
    const { model } = await openModel();
    insertToc(model, 0, [{ level: 1, text: "One" }, { level: 4, text: "Four" }]);
    const xml = tocXml(model);
    expect(xml).toContain('\\o "1-3"');
    expect(xml).not.toContain("Four");
  });
});

describe("docx TOC update", () => {
  it("regenerates the session TOC with the new entries and keeps the dirty flag", async () => {
    const { model } = await openModel();
    insertToc(model, 0, HEADINGS);
    const before = model.revision;
    updateToc(model, [{ level: 1, text: "Renamed" }]);
    const xml = tocXml(model);
    expect(xml).toContain("Renamed");
    expect(xml).not.toContain("Introduction");
    expect(xml).toContain('w:fldCharType="begin" w:dirty="true"');
    expect(model.savePlan().finalBlocks.filter((block) => block.kind === "xml")).toHaveLength(1);
    expect(model.revision).toBeGreaterThan(before);
  });

  it("is atomic: a malformed payload leaves the previous fragment in place", async () => {
    const { model } = await openModel();
    insertToc(model, 0, HEADINGS);
    const before = tocXml(model);
    const revision = model.revision;
    expect(errCode(() => updateToc(model, [{ level: 1, text: " " }]))).toBe("empty_toc_entry");
    expect(tocXml(model)).toBe(before);
    expect(model.revision).toBe(revision);
  });

  it("refuses when no TOC was inserted in this session", async () => {
    const { model } = await openModel();
    expect(errCode(() => updateToc(model, HEADINGS))).toBe("no_toc");
  });

  it("never rewrites a parse-loaded TOC: those blocks stay original", async () => {
    const { model } = await openModel([
      {
        type: "passthrough",
        fieldDisplay: { kind: "tocLine", left: "Introduction", right: "1", level: 1 },
        originalXml: '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" </w:instrText></w:r></w:p>',
      },
      { type: "paragraph", runs: [{ text: "body" }] },
    ]);
    expect(errCode(() => updateToc(model, HEADINGS))).toBe("no_toc");
    const plan = model.savePlan();
    expect(plan.finalBlocks.map((block) => block.kind)).toEqual(["original", "original"]);
    expect(model.isDirty).toBe(false);
  });

  it("drains with rebase: the next session starts without a TOC", async () => {
    const { model, engine } = await openModel();
    insertToc(model, 0, HEADINGS);
    model.rebase(await engine.parseDocx(docxWith(bodyBlocks())));
    expect(errCode(() => updateToc(model, HEADINGS))).toBe("no_toc");
    expect(model.isDirty).toBe(false);
  });
});

describe("docx caption model", () => {
  const labelRun = (label: string, number: number) => ({ text: String(number), instrField: ' SEQ "' + label + '" \\* ARABIC ', fldDirty: true });

  it("inserts a generated caption paragraph with a dirty SEQ field", async () => {
    const { model } = await openModel();
    insertCaption(model, 1, "Figure", "System architecture");
    const block = model.savePlan().finalBlocks[1];
    expect(block).toMatchObject({ kind: "generated" });
    if (block?.kind !== "generated") throw new Error("not generated");
    expect(block.block).toMatchObject({ type: "paragraph" });
    expect(block.block.runs).toEqual([
      { text: "Figure " },
      labelRun("Figure", 1),
      { text: " System architecture" },
    ]);
  });

  it("numbers from the document's own captions and counts per label", async () => {
    const seqParagraph = (label: string) => ({
      type: "paragraph",
      runs: [{ text: "Figure " }, { text: "1" }],
      originalXml: '<w:p><w:r><w:instrText xml:space="preserve"> SEQ ' + label + ' \\* ARABIC </w:instrText></w:r></w:p>',
    });
    const { model } = await openModel([seqParagraph("Figure"), seqParagraph("Table")]);
    // each insert goes at the plan position it is given, so appending three
    // captions in document order takes the growing end index each time
    insertCaption(model, 2, "Figure", "one");
    insertCaption(model, 3, "Figure", "two");
    insertCaption(model, 4, "Table", "t");
    const runs = model
      .savePlan()
      .finalBlocks.filter((block) => block.kind === "generated")
      .map((block) => (block.kind === "generated" ? block.block.runs : []));
    expect(runs.map((list) => list[1])).toEqual([
      labelRun("Figure", 2),
      labelRun("Figure", 3),
      labelRun("Table", 2),
    ]);
  });

  it("quotes a multi-word label so Word keeps one SEQ identifier", async () => {
    const { model } = await openModel();
    insertCaption(model, 0, "Công thức", "Định luật");
    insertCaption(model, 1, "Công thức", "Hệ quả");
    const runs = model
      .savePlan()
      .finalBlocks.filter((block) => block.kind === "generated")
      .map((block) => (block.kind === "generated" ? block.block.runs : []));
    expect(runs).toEqual([
      [{ text: "Công thức " }, labelRun("Công thức", 1), { text: " Định luật" }],
      [{ text: "Công thức " }, labelRun("Công thức", 2), { text: " Hệ quả" }],
    ]);
  });

  it("counts quoted and switch-bearing Word instructions in parsed XML", async () => {
    const wordInstr = (instr: string) => ({
      type: "paragraph",
      runs: [{ text: "caption" }],
      originalXml: '<w:p><w:r><w:instrText xml:space="preserve">' + instr + "</w:instrText></w:r></w:p>",
    });
    const { model } = await openModel([
      wordInstr(" SEQ Figure \\* ARABIC \\s 1 "),
      wordInstr('  SEQ "Figure" \\* MERGEFORMAT  '),
      wordInstr(' SEQ "Công thức" \\* ARABIC '),
    ]);
    insertCaption(model, 3, "Figure", "next");
    insertCaption(model, 4, "Công thức", "next");
    const runs = model
      .savePlan()
      .finalBlocks.filter((block) => block.kind === "generated")
      .map((block) => (block.kind === "generated" ? block.block.runs : []));
    expect(runs).toEqual([
      [{ text: "Figure " }, labelRun("Figure", 3), { text: " next" }],
      [{ text: "Công thức " }, labelRun("Công thức", 2), { text: " next" }],
    ]);
  });

  it("trims a padded label before it reaches the instruction", async () => {
    const { model } = await openModel();
    insertCaption(model, 0, "  Figure  ", "");
    const block = model.savePlan().finalBlocks[0];
    if (block?.kind !== "generated") throw new Error("not generated");
    expect(block.block.runs).toEqual([{ text: "Figure " }, labelRun("Figure", 1)]);
  });

  it("refuses labels that cannot be quoted and leaves the plan untouched", async () => {
    const { model } = await openModel();
    expect(errCode(() => insertCaption(model, 0, 'Fi"gure', "x"))).toBe("bad_caption_label");
    expect(errCode(() => insertCaption(model, 0, "Fig\\ure", "x"))).toBe("bad_caption_label");
    expect(errCode(() => insertCaption(model, 0, "Fig\nure", "x"))).toBe("bad_caption_label");
    expect(model.isDirty).toBe(false);
    expect(model.savePlan().finalBlocks.map((block) => block.kind)).toEqual(["original", "original"]);
  });

  it("inserts a label-only caption when the text is empty", async () => {
    const { model } = await openModel();
    insertCaption(model, 0, "Equation", "");
    const block = model.savePlan().finalBlocks[0];
    if (block?.kind !== "generated") throw new Error("not generated");
    expect(block.block.runs).toEqual([{ text: "Equation " }, labelRun("Equation", 1)]);
  });

  it("refuses a blank label without touching the plan", async () => {
    const { model } = await openModel();
    expect(errCode(() => insertCaption(model, 0, "  ", "x"))).toBe("empty_caption_label");
    expect(errCode(() => insertCaption(model, -1, "Figure", "x"))).toBe("bad_index");
    expect(model.isDirty).toBe(false);
    expect(model.savePlan().finalBlocks.map((block) => block.kind)).toEqual(["original", "original"]);
  });

  it("keeps an untouched document out of SaveOptions", async () => {
    const { model } = await openModel();
    const plan = model.savePlan();
    const options: DocxSaveOptions = plan.options;
    expect(options).toEqual({});
    expect(model.isDirty).toBe(false);
  });
});

describe("docx caption instruction matcher", () => {
  it("accepts the quoted and bare forms and rejects near misses", () => {
    expect(isDocxCaptionInstr(' SEQ "Figure" \\* ARABIC ', "Figure")).toBe(true);
    expect(isDocxCaptionInstr(" SEQ Figure \\* ARABIC \\s 1 ", "Figure")).toBe(true);
    expect(isDocxCaptionInstr("   SEQ   Figure   \\* MERGEFORMAT ", "Figure")).toBe(true);
    expect(isDocxCaptionInstr(' SEQ "Công thức" \\* ARABIC ', "Công thức")).toBe(true);
    expect(isDocxCaptionInstr(' SEQ "Figure C" \\* ARABIC ', "Figure")).toBe(false);
    expect(isDocxCaptionInstr(" SEQ Figures \\* ARABIC ", "Figure")).toBe(false);
    expect(isDocxCaptionInstr(" SEQ Table \\* ARABIC ", "Figure")).toBe(false);
    expect(isDocxCaptionInstr(undefined, "Figure")).toBe(false);
  });
});
