import { describe, expect, it, vi } from "vitest";
import { buildPptxPrintHtml, pptxPrintPageId, pptxPrintPageSize, pptxPrintStyles, PPTX_PRINT_HEIGHT_IN } from "./pptx-print";

const slide16x9 = { markup: "<svg viewBox=\"0 0 1280 720\"><rect width=\"10\" height=\"10\"/></svg>", widthPx: 1280, heightPx: 720 };

describe("pptx print document", () => {
  it("sizes the page from the slide ratio at a fixed 7.5in height", () => {
    expect(pptxPrintPageSize(1280, 720)).toEqual({ widthIn: 13.333, heightIn: PPTX_PRINT_HEIGHT_IN });
    expect(pptxPrintPageSize(960, 720)).toEqual({ widthIn: 10, heightIn: PPTX_PRINT_HEIGHT_IN });
  });

  it("falls back to 16:9 for a degenerate slide size instead of emitting NaN inches", () => {
    expect(pptxPrintPageSize(0, 0).widthIn).toBe(13.333);
    expect(pptxPrintPageSize(Number.NaN, 720).widthIn).toBe(13.333);
    expect(pptxPrintPageSize(Number.POSITIVE_INFINITY, 720).widthIn).toBe(13.333);
    expect(pptxPrintPageSize(-10, 720).widthIn).toBe(13.333);
  });

  it("clamps an absurd ratio so the @page rule stays printable", () => {
    expect(pptxPrintPageSize(100000, 1).widthIn).toBe(37.5);
    expect(pptxPrintPageSize(1, 100000).widthIn).toBe(1.5);
  });

  it("builds one page per slide, each holding the slide SVG", () => {
    const html = buildPptxPrintHtml({
      title: "Quarterly deck",
      slides: [slide16x9, { ...slide16x9, id: "slide-2", markup: "<svg viewBox=\"0 0 1280 720\"></svg>" }],
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Quarterly deck</title>");
    expect(html.match(/class="page"/g)).toHaveLength(2);
    expect(html).toContain(`id="${pptxPrintPageId(0)}"`);
    expect(html).toContain(`id="${pptxPrintPageId(1)}"`);
    expect(html).toContain('data-slide-id="slide-2"');
    // Each page carries the slide's own SVG markup, unescaped.
    expect(html.match(/<svg /g)).toHaveLength(2);
  });

  it("escapes the title so a quote or angle bracket cannot break the document", () => {
    const html = buildPptxPrintHtml({ title: 'A <b>"deck"</b> & more', slides: [slide16x9] });
    expect(html).toContain("<title>A &lt;b&gt;&quot;deck&quot;&lt;/b&gt; &amp; more</title>");
  });

  it("emits no page box at all for an empty deck", () => {
    const html = buildPptxPrintHtml({ slides: [] });
    expect(html).not.toContain('class="page"');
    expect(html).toContain("@page");
  });

  it("prints every page at the deck page size with no browser margin", () => {
    const styles = pptxPrintStyles({ widthIn: 13.333, heightIn: 7.5 });
    expect(styles).toContain("@page { size: 13.333in 7.5in; margin: 0; }");
    expect(styles).toContain("page-break-after: always");
    expect(styles).toContain(".page:last-child { page-break-after: auto;");
  });

  it("keeps the deck title out of the document when it is blank", () => {
    expect(buildPptxPrintHtml({ title: "   ", slides: [slide16x9] })).toContain("<title></title>");
  });

  it("numbers pages from one, matching the genoffice anchor convention", () => {
    expect(pptxPrintPageId(0)).toBe("pg1");
    expect(pptxPrintPageId(4)).toBe("pg5");
  });

  it("does not touch the DOM or the window (pure builder)", () => {
    const printSpy = vi.fn();
    (globalThis as { print?: unknown }).print = printSpy;
    buildPptxPrintHtml({ slides: [slide16x9] });
    expect(printSpy).not.toHaveBeenCalled();
    delete (globalThis as { print?: unknown }).print;
  });
});
