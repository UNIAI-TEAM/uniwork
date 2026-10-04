// T-02 (UNI-823 g3-04c): close the coverage gap the Tester r2 flagged — the
// pagination driver was proven only by the visual stage. These tests drive it
// in jsdom: buildPaginationFrame (page gaps, per-page header/footer strips,
// section metrics, page numbers) and attachDocxPagination on a mounted surface
// with synthetic geometry (page count, .page-gap widgets, strip text, paper
// variables).
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { blocksToDoc } from "./docx-doc-convert";
import { docxExtensions } from "./docx-schema";
import {
  attachDocxPagination,
  buildPaginationFrame,
  createDocxPaginationSpec,
  docxPageGeometryVars,
  docxPaperMinHeightPx,
  type DocxPaginationSpec,
} from "./docx-pagination";
import { DOCX_ZOOM_CSS_VAR } from "./view/zoom-factor";

// A6-wire review F2: pin the live zoom factor the driver reads from `.doc-zoom`
// into measurement and the frame — a regression back to a hard-coded factor of
// 1 must fail here. Both wrappers delegate to the real implementations.
const zoomProbe = vi.hoisted(() => ({ measured: [] as number[], framed: [] as number[] }));

vi.mock("@uniwork/office-upstream/docs-renderer-editor", async (original) => {
  const mod = await original<typeof import("@uniwork/office-upstream/docs-renderer-editor")>();
  return {
    ...mod,
    measureBlocks: (...args: Parameters<typeof mod.measureBlocks>) => {
      zoomProbe.measured.push(args[2]);
      return mod.measureBlocks(...args);
    },
  };
});

vi.mock("./docx-frame", async (original) => {
  const mod = await original<typeof import("./docx-frame")>();
  return {
    ...mod,
    buildPaginationFrame: (input: Parameters<typeof mod.buildPaginationFrame>[0]) => {
      zoomProbe.framed.push(input.zoomFactor ?? 1);
      return mod.buildPaginationFrame(input);
    },
  };
});

// jsdom implements neither Range.getClientRects nor Element.getClientRects on
// this version — the vendored line sampler treats an empty list as "no line
// boxes" (block-granular slices), but a missing method throws.
const noRects = () => [] as unknown as DOMRectList;
for (const proto of [Range.prototype, Element.prototype]) {
  Object.defineProperty(proto, "getClientRects", { configurable: true, value: noRects });
}

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

const section = (overrides: Record<string, unknown> = {}) => ({
  settings: { ...A4 },
  firstBlockIndex: 0,
  lastBlockIndex: 3,
  ...overrides,
});

const parsedDoc = () => ({
  blocks: [
    { type: "paragraph", docxIndex: 0, runs: [{ text: "alpha" }] },
    { type: "paragraph", docxIndex: 1, runs: [{ text: "bravo" }] },
    { type: "paragraph", docxIndex: 2, runs: [{ text: "charlie" }] },
    { type: "paragraph", docxIndex: 3, runs: [{ text: "delta" }] },
  ],
  headerText: "Doc header",
  headerParas: [],
  headerHasPageNumber: false,
  footerText: "Doc footer",
  footerParas: [],
  footerHasPageNumber: true,
});

function blockEls(count: number): HTMLElement[] {
  return Array.from({ length: count }, () => document.createElement("p"));
}

describe("buildPaginationFrame", () => {
  it("maps slices to page gaps carrying the previous footer and next header", () => {
    const spec = createDocxPaginationSpec(parsedDoc());
    const els = blockEls(3);
    const blocks = els.map((el, index) => ({ top: index * 400, height: 380, el, docxIndex: index }));
    const slices = [
      { start: 0, end: 400, section: 0 },
      { start: 400, end: 800, section: 0 },
      { start: 800, end: 1200, section: 0 },
    ];
    const frame = buildPaginationFrame({
      spec,
      live: [section()],
      blocks,
      hfHeights: [{ headerPx: 20, footerPx: 24 }],
      slices,
    });

    expect(frame.pages).toBe(3);
    expect(frame.nums).toEqual([1, 2, 3]);
    expect(frame.gaps).toHaveLength(2);
    // Block-anchored gaps point at the page's first block.
    expect(frame.gaps[0]?.el).toBe(els[1]);
    expect(frame.gaps[1]?.el).toBe(els[2]);
    // Section metrics: A4 top/bottom margins (75.6px) with header/footer push.
    expect(frame.gaps[0]?.metrics.marginTop).toBeCloseTo(75.6, 1);
    // R3 (g3-04d): page 1 ends at 400px of its A4 body (pageHeight − margins),
    // so the gap absorbs the shortfall and the frame still paints a full sheet.
    const bodyH = 16838 / 15 - 75.6 - 75.6;
    const pad = Math.round(bodyH - 400);
    expect(pad).toBeGreaterThan(0);
    expect(frame.gaps[0]?.metrics.marginBottom).toBeCloseTo(75.6 + pad, 5);
    expect(frame.gaps[0]?.metrics.sectionMarginTop).toBeCloseTo(75.6, 1);
    // Each gap carries the document's real footer text and the next header.
    const gapTexts = (frame.gaps[0]?.hfEls ?? []).map((el) => el.textContent ?? "");
    expect(gapTexts.some((text) => text.includes("Doc footer"))).toBe(true);
    expect(gapTexts.some((text) => text.includes("Doc header"))).toBe(true);
    expect(frame.gaps[0]?.hfKey).toContain("1·2·3");
    // Edge strips: page 1's header on the top edge, the LAST page's footer on
    // the bottom edge (D-01).
    expect(frame.edgeHf?.header.piece.value?.text).toBe("Doc header");
    expect(frame.edgeHf?.header.pageNo).toBe("1");
    expect(frame.edgeHf?.footer.piece.value).toMatchObject({ text: "Doc footer", pageNumber: true });
    expect(frame.edgeHf?.footer.pageNo).toBe("3");
    expect(frame.edgeHf?.pageTotal).toBe(3);
  });

  it("uses the titlePg first-page variant for page 1 and the default for later pages", () => {
    const spec: DocxPaginationSpec = {
      sections: [
        {
          settings: { ...A4 },
          firstBlockIndex: 0,
          lastBlockIndex: 1,
          titlePg: true,
          headerRefs: { default: "h-def", first: "h-first" },
          footerRefs: { default: "f-def" },
        },
      ],
      hfParts: {
        "h-def": { text: "Default header", hasPageNumber: false, paras: [] },
        "h-first": { text: "First header", hasPageNumber: false, paras: [] },
        "f-def": { text: "Default footer", hasPageNumber: false, paras: [] },
      },
      evenAndOddHeaders: false,
      defaultHeader: null,
      defaultFooter: null,
    };
    const els = blockEls(2);
    const blocks = els.map((el, index) => ({ top: index * 600, height: 560, el, docxIndex: index }));
    const slices = [
      { start: 0, end: 600, section: 0 },
      { start: 600, end: 1200, section: 0 },
    ];
    const frame = buildPaginationFrame({ spec, live: spec.sections, blocks, hfHeights: [{ headerPx: 10, footerPx: 10 }], slices });
    expect(frame.edgeHf?.header.piece.value?.text).toBe("First header");
    // The gap carries page 1's footer (default variant) and page 2's header.
    const gapTexts = (frame.gaps[0]?.hfEls ?? []).map((el) => el.textContent ?? "");
    expect(gapTexts.some((text) => text.includes("Default footer"))).toBe(true);
    expect(gapTexts.some((text) => text.includes("Default header"))).toBe(true);
  });

  it("carries the last page's even variant in the bottom edge strip", () => {
    const spec: DocxPaginationSpec = {
      sections: [
        {
          settings: { ...A4 },
          firstBlockIndex: 0,
          lastBlockIndex: 1,
          headerRefs: { default: "h-def", even: "h-even" },
          footerRefs: { default: "f-def", even: "f-even" },
        },
      ],
      hfParts: {
        "h-def": { text: "Odd header", hasPageNumber: false, paras: [] },
        "h-even": { text: "Even header", hasPageNumber: false, paras: [] },
        "f-def": { text: "Odd footer", hasPageNumber: false, paras: [] },
        "f-even": { text: "Even footer", hasPageNumber: false, paras: [] },
      },
      evenAndOddHeaders: true,
      defaultHeader: null,
      defaultFooter: null,
    };
    const els = blockEls(2);
    const blocks = els.map((el, index) => ({ top: index * 600, height: 560, el, docxIndex: index }));
    const slices = [
      { start: 0, end: 600, section: 0 },
      { start: 600, end: 1200, section: 0 },
    ];
    const frame = buildPaginationFrame({ spec, live: spec.sections, blocks, hfHeights: [{ headerPx: 10, footerPx: 10 }], slices });
    expect(frame.edgeHf?.header.pageNo).toBe("1");
    expect(frame.edgeHf?.header.piece.value?.text).toBe("Odd header");
    expect(frame.edgeHf?.footer.pageNo).toBe("2");
    expect(frame.edgeHf?.footer.piece.value?.text).toBe("Even footer");
  });

  it("computes the last-page canvas height from the last gap (paperTop + pageHeight)", () => {
    // A4: 16838 twips = 1122.53px, marginTop 75.6px, no header reservation
    expect(
      docxPaperMinHeightPx({ lastGapBottom: 1700, paperTop: 0, factor: 1, settings: { ...A4 }, headerPx: 0 }),
    ).toBe(Math.round(1700 - 75.6 + 16838 / 15));
    // an over-tall header (48px headerDist + 40px strip > 75.6px margin) pushes
    // the content start down; the canvas still reaches the page bottom
    expect(
      docxPaperMinHeightPx({ lastGapBottom: 1000, paperTop: 100, factor: 1, settings: { ...A4 }, headerPx: 40 }),
    ).toBe(Math.round(1000 - 100 - 88 + 16838 / 15));
  });
});

describe("attachDocxPagination on a mounted surface", () => {
  it("installs the paper geometry, page gaps and header/footer strips", async () => {
    const blocks = parsedDoc().blocks;
    const editor = new Editor({
      extensions: docxExtensions(),
      content: blocksToDoc(blocks),
      editorProps: { attributes: { class: "doc-page" } },
    });
    const view = render(
      createElement(
        "div",
        { className: "docx-surface" },
        createElement(
          "div",
          { className: "workspace" },
          createElement(
            "div",
            { className: "editor-scroll" },
            createElement(
              "div",
              { className: "doc-zoom view-print" },
              createElement(
                "div",
                { className: "page-wrap" },
                createElement(EditorContent, { editor }),
                createElement("div", { className: "docx-page-hf-host" }),
              ),
            ),
          ),
        ),
      ),
    );
    const container = view.container as HTMLElement;
    const spec = createDocxPaginationSpec(parsedDoc());
    const paginator = attachDocxPagination(editor, spec);
    try {
      const docZoom = container.querySelector(".doc-zoom") as HTMLElement;
      const pm = container.querySelector(".doc-page") as HTMLElement;
      // jsdom has no layout — stub a two-page flow whose first page overflows.
      stubRect(pm, { top: 0, width: 733, height: 1900 });
      Array.from(pm.children).forEach((child, index) => stubRect(child as HTMLElement, { top: index * 400, width: 733, height: 380 }));
      paginator.refresh();
      await frames(2);

      const expected = docxPageGeometryVars(spec.sections[0]!.settings);
      for (const [name, value] of Object.entries(expected)) {
        expect(docZoom.style.getPropertyValue(name)).toBe(value);
      }
      expect(paginator.pageCount()).toBeGreaterThan(1);
      const gaps = container.querySelectorAll(".page-gap");
      expect(gaps.length).toBe(paginator.pageCount() - 1);
      const strips = container.querySelectorAll(".page-hf");
      expect(strips.length).toBeGreaterThan(0);
      const text = Array.from(strips).map((el) => el.textContent ?? "").join(" ");
      expect(text).toContain("Doc header");
      expect(text).toContain("Doc footer");

      // R3 (g3-04d): the last page paints as a full sheet — the canvas
      // min-height reaches the last page's paper bottom. The exact math is
      // pinned by docxPaperMinHeightPx below; jsdom has no layout to measure.
      expect(pm.style.minHeight).toMatch(/^\d+px$/);
      expect(parseInt(pm.style.minHeight, 10)).toBeGreaterThan(0);
    } finally {
      paginator.dispose();
      view.unmount();
      editor.destroy();
    }
  });

  it("measures and frames with the live zoom factor from .doc-zoom", async () => {
    const editor = new Editor({
      extensions: docxExtensions(),
      content: blocksToDoc(parsedDoc().blocks),
      editorProps: { attributes: { class: "doc-page" } },
    });
    const view = render(
      createElement(
        "div",
        { className: "docx-surface" },
        createElement(
          "div",
          { className: "workspace" },
          createElement(
            "div",
            { className: "editor-scroll" },
            createElement(
              "div",
              { className: "doc-zoom view-print" },
              createElement(
                "div",
                { className: "page-wrap" },
                createElement(EditorContent, { editor }),
                createElement("div", { className: "docx-page-hf-host" }),
              ),
            ),
          ),
        ),
      ),
    );
    const container = view.container as HTMLElement;
    const docZoom = container.querySelector(".doc-zoom") as HTMLElement;
    docZoom.style.setProperty(DOCX_ZOOM_CSS_VAR, "1.25");
    const spec = createDocxPaginationSpec(parsedDoc());
    const paginator = attachDocxPagination(editor, spec);
    try {
      const pm = container.querySelector(".doc-page") as HTMLElement;
      stubRect(pm, { top: 0, width: 733, height: 1900 });
      Array.from(pm.children).forEach((child, index) => stubRect(child as HTMLElement, { top: index * 400, width: 733, height: 380 }));
      zoomProbe.measured.length = 0;
      zoomProbe.framed.length = 0;
      paginator.refresh();
      await frames(2);
      expect(zoomProbe.measured.at(-1)).toBe(1.25);
      expect(zoomProbe.framed.at(-1)).toBe(1.25);
    } finally {
      paginator.dispose();
      view.unmount();
      editor.destroy();
    }
  });
});

function stubRect(el: Element, rect: { top: number; width: number; height: number }): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: rect.top,
      top: rect.top,
      left: 0,
      right: rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      toJSON: () => ({}),
    }),
  });
}

const frames = (count: number): Promise<void> =>
  new Promise((resolve) => {
    const tick = (remaining: number) => {
      if (remaining <= 0) resolve();
      else requestAnimationFrame(() => tick(remaining - 1));
    };
    tick(count);
  });
