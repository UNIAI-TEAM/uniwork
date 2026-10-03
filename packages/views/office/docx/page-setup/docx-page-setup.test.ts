import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import {
  activeSectionIndex,
  applyPropertiesToSection,
  cmFromTwips,
  formatCm,
  marginPresetKey,
  marginsFit,
  paperSizeKey,
  propertiesFromDraft,
  sectionIndexAtDocxIndex,
  sectionsFromParsed,
  twipsFromCm,
  type DocxPageSetupSection,
} from "./docx-page-setup";

const P = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const SECT_PR = (opts: { landscape?: boolean; margins?: string; cols?: string; type?: string } = {}) =>
  "<w:sectPr>" +
  (opts.type ? `<w:type w:val="${opts.type}"/>` : "") +
  (opts.landscape ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' : '<w:pgSz w:w="11906" w:h="16838"/>') +
  (opts.margins ?? '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>') +
  (opts.cols ?? "") +
  "</w:sectPr>";

/** Two sections: block 1 closes section 0 (landscape), the hidden block closes
 * section 1 (portrait A4, two columns). */
const parsedFixture = () => ({
  blocks: [
    { docxIndex: 0, type: "paragraph", originalXml: P("first") },
    { docxIndex: 1, type: "paragraph", originalXml: `<w:p><w:pPr>${SECT_PR({ landscape: true, type: "continuous" })}</w:pPr></w:p>` },
    { docxIndex: 2, type: "paragraph", originalXml: P("second") },
    { docxIndex: 3, type: "sectPr", hidden: true, originalXml: SECT_PR({ cols: '<w:cols w:num="2" w:space="425"/>' }) },
  ],
});

/** A minimal Editor stand-in: the model only reads state.doc's top-level
 * blocks and the selection position. */
function fakeEditor(attrs: Array<Record<string, unknown>>, from = 0): Editor {
  return {
    isDestroyed: false,
    state: {
      selection: { from },
      doc: {
        childCount: attrs.length,
        content: { size: attrs.length * 2 },
        child: (index: number) => ({ attrs: attrs[index], nodeSize: 2 }),
        resolve: () => ({ index: () => 0 }),
      },
    },
  } as unknown as Editor;
}

describe("sectionsFromParsed", () => {
  it("maps the parse's readSections output into dialog sections", () => {
    const sections = sectionsFromParsed(parsedFixture());
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({
      index: 0,
      firstBlockIndex: 0,
      lastBlockIndex: 1,
      orientation: "landscape",
      pageWidth: 16838,
      pageHeight: 11906,
      marginTop: 1440,
      columns: 1,
      startType: "continuous",
    });
    expect(sections[1]).toMatchObject({
      index: 1,
      firstBlockIndex: 2,
      lastBlockIndex: 3,
      orientation: "portrait",
      pageWidth: 11906,
      pageHeight: 16838,
      columns: 2,
      columnSpace: 425,
      startType: "nextPage",
    });
  });
});

describe("section targeting", () => {
  const sections = sectionsFromParsed(parsedFixture());

  it("resolves a block's section by its docxIndex range", () => {
    expect(sectionIndexAtDocxIndex(sections, 0)).toBe(0);
    expect(sectionIndexAtDocxIndex(sections, 1)).toBe(0);
    expect(sectionIndexAtDocxIndex(sections, 2)).toBe(1);
    expect(sectionIndexAtDocxIndex(sections, 3)).toBe(1);
  });

  it("keeps the nearest preceding section for a block beyond the last range", () => {
    expect(sectionIndexAtDocxIndex(sections, 99)).toBe(1);
    expect(sectionIndexAtDocxIndex([], 0)).toBe(0);
  });

  it("reads the section at the cursor and falls back to the first block's section", () => {
    expect(activeSectionIndex(null, sections)).toBe(0);
    expect(activeSectionIndex(fakeEditor([{ docxIndex: 2 }]), sections)).toBe(1);
    expect(activeSectionIndex(fakeEditor([{ docxIndex: null }, { docxIndex: 0 }]), sections)).toBe(0);
  });
});

describe("units", () => {
  it("converts between twips and cm with two-decimal display", () => {
    expect(cmFromTwips(1440)).toBe(2.54);
    expect(cmFromTwips(11906)).toBe(21);
    expect(twipsFromCm(2.54)).toBe(1440);
    expect(twipsFromCm(21)).toBe(11906);
    expect(formatCm(16838)).toBe("29.7");
  });

  it("recognises the margin and paper presets", () => {
    expect(marginPresetKey({ marginTop: 1440, marginRight: 1440, marginBottom: 1440, marginLeft: 1440 })).toBe("normal");
    expect(marginPresetKey({ marginTop: 1, marginRight: 1, marginBottom: 1, marginLeft: 1 })).toBeNull();
    expect(paperSizeKey({ pageWidth: 11906, pageHeight: 16838 })).toBe("a4");
    expect(paperSizeKey({ pageWidth: 16838, pageHeight: 11906 })).toBe("a4");
    expect(paperSizeKey({ pageWidth: 1000, pageHeight: 2000 })).toBe("custom");
  });

  it("refuses margins that leave no content box", () => {
    expect(marginsFit(11906, 16838, { marginTop: 1440, marginRight: 1440, marginBottom: 1440, marginLeft: 1440 })).toBe(true);
    expect(marginsFit(11906, 16838, { marginTop: 9000, marginRight: 1440, marginBottom: 9000, marginLeft: 1440 })).toBe(false);
  });
});

describe("section merges", () => {
  const section: DocxPageSetupSection = {
    index: 0,
    firstBlockIndex: 0,
    lastBlockIndex: 0,
    pageWidth: 11906,
    pageHeight: 16838,
    orientation: "portrait",
    marginTop: 1440,
    marginRight: 1440,
    marginBottom: 1440,
    marginLeft: 1440,
    columns: 1,
    columnSpace: 720,
    startType: "nextPage",
  };

  it("an orientation-only change swaps the paper, explicit dimensions win", () => {
    const landscape = applyPropertiesToSection(section, { orientation: "landscape" });
    expect(landscape).toMatchObject({ orientation: "landscape", pageWidth: 16838, pageHeight: 11906 });
    const explicit = applyPropertiesToSection(section, { orientation: "landscape", pageWidth: 1000, pageHeight: 2000 });
    expect(explicit).toMatchObject({ orientation: "landscape", pageWidth: 1000, pageHeight: 2000 });
  });

  it("merges every field it is given and leaves the others alone", () => {
    const next = applyPropertiesToSection(section, { marginTop: 720, columns: 3, columnSpace: 425, startType: "evenPage" });
    expect(next).toMatchObject({ marginTop: 720, marginRight: 1440, columns: 3, columnSpace: 425, startType: "evenPage" });
  });

  it("diffs a resolved draft down to the changed fields only", () => {
    const draft = {
      pageWidth: section.pageWidth,
      pageHeight: section.pageHeight,
      orientation: section.orientation,
      marginTop: 720,
      marginRight: section.marginRight,
      marginBottom: section.marginBottom,
      marginLeft: section.marginLeft,
      columns: section.columns,
      columnSpace: section.columnSpace,
      startType: "continuous" as const,
    };
    expect(propertiesFromDraft(draft, section)).toEqual({ marginTop: 720, startType: "continuous" });
    expect(propertiesFromDraft({ ...draft, marginTop: section.marginTop, startType: section.startType }, section)).toEqual({});
  });
});
