// T-02 (UNI-823 g3-04c): the pagination host maps the parse's section and
// header/footer data onto the surface. jsdom has no layout, so the actual page
// turning is exercised by the browser stages; these tests pin the mapping
// decisions (paper variables, variant selection, document-level fallback).
import { describe, expect, it } from "vitest";
import { createDocxPaginationSpec, docxPageGeometryVars, resolvePageHf, type DocxPaginationSpec } from "./docx-pagination";

const A4 = {
  pageWidth: 11906,
  pageHeight: 16838,
  marginTop: 1134,
  marginRight: 1134,
  marginBottom: 1134,
  marginLeft: 1418,
  headerDist: 720,
  footerDist: 720,
};

const px = (value: string | undefined) => Number.parseFloat(value ?? "");

describe("docxPageGeometryVars", () => {
  it("translates the section's twips into the paper variables", () => {
    const vars = docxPageGeometryVars(A4);
    expect(px(vars["--page-w"])).toBeCloseTo(793.73, 1);
    expect(px(vars["--page-h"])).toBeCloseTo(1122.53, 1);
    expect(px(vars["--section-content-w"])).toBeCloseTo(623.6, 1);
    expect(px(vars["--header-dist"])).toBeCloseTo(48, 5);
    expect(px(vars["--footer-dist"])).toBeCloseTo(48, 5);
    const pad = (vars["--page-pad"] ?? "").split(" ").map((part) => px(part));
    expect(pad.map((value) => Number(value.toFixed(1)))).toEqual([75.6, 75.6, 75.6, 94.5]);
  });
});

const section = (overrides: Partial<DocxPaginationSpec["sections"][number]> = {}) => ({
  settings: A4,
  firstBlockIndex: 0,
  lastBlockIndex: 0,
  ...overrides,
});

const spec = (overrides: Partial<DocxPaginationSpec> = {}): DocxPaginationSpec => ({
  sections: [section()],
  hfParts: undefined,
  titlePg: false,
  evenAndOddHeaders: false,
  defaultHeader: null,
  defaultFooter: null,
  ...overrides,
});

describe("resolvePageHf", () => {
  const hfParts = {
    "h-default": { text: "Header", hasPageNumber: false, paras: [] },
    "h-first": { text: "First header", hasPageNumber: false, paras: [] },
    "f-default": { text: "Footer", hasPageNumber: false, paras: [] },
  };

  it("resolves the variant ref, then the default ref", () => {
    const withRefs = spec({
      sections: [section({ titlePg: true, headerRefs: { default: "h-default", first: "h-first" }, footerRefs: { default: "f-default" } })],
      hfParts,
    });
    expect(resolvePageHf(withRefs, 0, "header", "first", true).value?.text).toBe("First header");
    expect(resolvePageHf(withRefs, 0, "header", "even", true).value?.text).toBe("Header");
    expect(resolvePageHf(withRefs, 0, "footer", "default", true).value?.text).toBe("Footer");
  });

  it("falls back to the document-level header/footer only on the final section", () => {
    const defaults = spec({
      sections: [section(), section()],
      defaultHeader: { text: "Doc header" },
      defaultFooter: { text: "Doc footer" },
    });
    expect(resolvePageHf(defaults, 0, "header", "default", false).value).toBeNull();
    expect(resolvePageHf(defaults, 1, "header", "default", true).value?.text).toBe("Doc header");
    expect(resolvePageHf(defaults, 1, "footer", "default", true).value?.text).toBe("Doc footer");
  });
});

describe("createDocxPaginationSpec", () => {
  it("reads sections, hf parts, toggles and the document-level fallbacks", () => {
    const parsed = {
      blocks: [{ type: "paragraph", docxIndex: 0, runs: [{ text: "body" }] }],
      titlePg: true,
      evenAndOddHeaders: true,
      hfParts: { "h1": { text: "H", hasPageNumber: false, paras: [] } },
      headerText: "Doc header",
      headerParas: [],
      headerHasPageNumber: true,
      footerText: "",
      footerParas: [],
      footerHasPageNumber: false,
    };
    const result = createDocxPaginationSpec(parsed);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.settings.pageWidth).toBeGreaterThan(0);
    expect(result.titlePg).toBe(true);
    expect(result.evenAndOddHeaders).toBe(true);
    expect(result.hfParts).toBe(parsed.hfParts);
    expect(result.defaultHeader).toMatchObject({ text: "Doc header", pageNumber: true });
    expect(result.defaultFooter).toBeNull();
  });
});
