import { describe, expect, it, vi } from "vitest";
import { PRINT_COPY_CSP } from "../../markdown/wysiwyg/print";
import { createPptxDeckRenderer } from "../canvas/deck-renderer";
import { shapeNode, slide } from "../canvas/pptx-render-fixtures";
import type { PptxRendererModule } from "../canvas/renderer-module";
import { buildPptxPrintHtml, collectPptxPrintSlides, pptxPrintPageId, pptxPrintPageSize, pptxPrintStyles, PPTX_PRINT_HEIGHT_IN } from "./pptx-print";

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

  it("builds one page per slide, each holding the slide as one data: image", () => {
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
    // Each page is one image of the slide's own SVG; no live slide markup reaches the copy.
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).not.toMatch(/<svg/);
    expect(html.match(/src="data:image\/svg\+xml;charset=utf-8,/g)).toHaveLength(2);
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

describe("pptx print copy safety (UNI-952)", () => {
  it("carries the shared print CSP as the first head child", () => {
    const html = buildPptxPrintHtml({ slides: [slide16x9] });
    expect(html).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${PRINT_COPY_CSP}">`);
    expect(html).toContain("img-src data:");
    expect(html).not.toMatch(/<script/i);
  });

  it("keeps slide markup inert: a script or link in a slide only exists inside an encoded data: image", () => {
    const hostile = { ...slide16x9, markup: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><a href="javascript:x"><text>t</text></a></svg>' };
    const html = buildPptxPrintHtml({ slides: [hostile] });
    expect(html).not.toMatch(/<script|<a /i);
    const src = /src="([^"]*)"/.exec(html)![1]!;
    expect(src.startsWith("data:image/svg+xml;")).toBe(true);
  });

  it("prints landscape at the deck aspect, keeps colours exact and breaks between pages", () => {
    const styles = pptxPrintStyles(pptxPrintPageSize(1280, 720));
    expect(styles).toContain("size: 13.333in 7.5in");
    expect(styles).toContain("print-color-adjust: exact");
    expect(styles).toContain("break-after: page");
  });

  it("uses a raster image for a slide only when it is an image data: URL", () => {
    const html = buildPptxPrintHtml({
      slides: [slide16x9, slide16x9, slide16x9],
      images: ["data:image/jpeg;base64,AAAA", "https://evil.example/x.png", null],
    });
    const sources = [...html.matchAll(/src="([^"]*)"/g)].map(([, src]) => src!);
    expect(sources[0]).toBe("data:image/jpeg;base64,AAAA");
    expect(sources[1]!.startsWith("data:image/svg+xml;")).toBe(true);
    expect(sources[2]!.startsWith("data:image/svg+xml;")).toBe(true);
    expect(html).not.toContain("evil.example");
  });

  it("labels each page with the slide label, escaped", () => {
    const html = buildPptxPrintHtml({ slides: [{ ...slide16x9, label: 'Trang "1"' }, slide16x9] });
    expect(html).toContain('alt="Trang &quot;1&quot;"');
    expect(html).toContain('alt="Slide 2"');
  });
});

describe("collectPptxPrintSlides", () => {
  const renderer = (built: (index: number, widthPx: number, title?: string) => unknown) => ({
    slideCount: 3,
    aspect: 9 / 16,
    viewport: () => ({ widthPx: 1280, heightPx: 720, scale: 1 }),
    buildSlide: () => null,
    buildSlideMarkup: (index: number, widthPx: number, title?: string) => built(index, widthPx, title) as never,
    buildThumbnail: () => null,
  });

  it("skips the slides the caller leaves out and the ones that cannot be built", () => {
    const slides = collectPptxPrintSlides(renderer(() => null), { skip: () => false });
    expect(slides).toEqual([]);
    const skipped = vi.fn(() => null);
    collectPptxPrintSlides(renderer(skipped), { skip: (index) => index !== 1 });
    expect(skipped).toHaveBeenCalledTimes(1);
    expect(skipped).toHaveBeenCalledWith(1, 1280, "Slide 2");
  });

  it("prints what the canvas draws: a pattern fill reaches the copy as a pattern, not its background colour", () => {
    const module: PptxRendererModule = {
      makeViewport: (size, fitWidthPx) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
      buildRenderSlide: () => slide([shapeNode({ fill: { kind: "pattern", preset: "pct50", fg: "#111111", bg: "#eeeeee", cellPx: 8 } })]),
      patternGrid: () => [[true]],
    };
    const palette = { pageFill: "#ffffff", chipFill: "#f4f4f5", chipStroke: "#e4e4e7", chipText: "#646464" };
    const deckRenderer = createPptxDeckRenderer(module, { deck: { slides: [{ id: "s1" }] } }, { idPrefix: "p", palette });
    const printed = collectPptxPrintSlides(deckRenderer, { title: () => "Trang 1" });
    expect(printed).toHaveLength(1);
    expect(printed[0]).toMatchObject({ label: "Trang 1" });
    const html = buildPptxPrintHtml({ slides: printed });
    const src = /src="(data:image\/svg\+xml;charset=utf-8,[^"]*)"/.exec(html)![1]!;
    const svg = decodeURIComponent(src.slice(src.indexOf(",") + 1).replace(/&amp;/g, "&"));
    expect(svg).toContain("<pattern");
    expect(svg).toContain("<title>Trang 1</title>");
  });
});
