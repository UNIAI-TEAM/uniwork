import { describe, expect, it, vi } from "vitest";
import { createPptxDeckRenderer } from "./deck-renderer";
import type { PptxCanvasPalette } from "./paint";
import { assertPptxRendererModule, type PptxRendererModule } from "./renderer-module";
import type { PptxSlideSize } from "./render-tree";
import { shapeNode, slide, textLayout, run } from "./pptx-render-fixtures";

const palette: PptxCanvasPalette = { pageFill: "#ffffff", chipFill: "#f4f4f5", chipStroke: "#e4e4e7", chipText: "#646464" };
const size: PptxSlideSize = { cx: 12192000, cy: 6858000 };

function fakeModule(): PptxRendererModule {
  return {
    makeViewport: (slideSize, fitWidthPx) => ({
      widthPx: fitWidthPx,
      heightPx: (slideSize.cy / slideSize.cx) * fitWidthPx,
      scale: fitWidthPx / (slideSize.cx / 9525),
    }),
    buildRenderSlide: vi.fn((_slide: unknown, _size: PptxSlideSize, options: { fitWidthPx: number }) =>
      slide([shapeNode({ text: textLayout({ lines: [{ runs: [run({ text: `w${options.fitWidthPx}` })], top: 0, height: 24 }] }) })], {
        widthPx: options.fitWidthPx,
        heightPx: options.fitWidthPx * 0.5625,
      }),
    ),
  };
}

describe("assertPptxRendererModule", () => {
  it("names every missing export", () => {
    expect(() => assertPptxRendererModule({})).toThrowError(/pptx_renderer_export_missing:buildRenderSlide,makeViewport/);
    expect(() => assertPptxRendererModule({ buildRenderSlide: () => undefined, makeViewport: "nope" })).toThrowError(/makeViewport/);
    expect(() => assertPptxRendererModule(null)).toThrowError(/buildRenderSlide/);
  });

  it("accepts a module that carries the render seam", () => {
    const module = fakeModule();
    expect(assertPptxRendererModule(module)).toBe(module);
  });
});

describe("createPptxDeckRenderer", () => {
  const input = { deck: { slides: [{ id: "s1" }, { id: "s2" }], size }, revision: 3 };

  it("derives the slide aspect from the artifact viewport", () => {
    const renderer = createPptxDeckRenderer(fakeModule(), input, { idPrefix: "t", palette });
    expect(renderer.slideCount).toBe(2);
    expect(renderer.aspect).toBeCloseTo(6858000 / 12192000, 6);
    expect(renderer.viewport(480)).toMatchObject({ widthPx: 480, heightPx: 480 * (6858000 / 12192000) });
  });

  it("builds slides at the requested fit width with the 1-based slide number and caches them", () => {
    const module = fakeModule();
    const renderer = createPptxDeckRenderer(module, input, { idPrefix: "t", palette });
    const first = renderer.buildSlide(1, 480);
    expect(first?.widthPx).toBe(480);
    expect(module.buildRenderSlide).toHaveBeenCalledTimes(1);
    expect(module.buildRenderSlide).toHaveBeenCalledWith({ id: "s2" }, size, expect.objectContaining({ fitWidthPx: 480, slideNo: 2 }));
    expect(renderer.buildSlide(1, 480)).toBe(first);
    expect(module.buildRenderSlide).toHaveBeenCalledTimes(1);
    expect(renderer.buildSlide(1, 481)).not.toBe(first);
    expect(renderer.buildSlide(9, 480)).toBeNull();
  });

  it("serializes a thumbnail data URL from the same SVG the canvas mounts", () => {
    const renderer = createPptxDeckRenderer(fakeModule(), input, { idPrefix: "t", palette });
    const url = renderer.buildThumbnail(0, 160, "Slide 1");
    expect(url?.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    const markup = decodeURIComponent(url!.slice("data:image/svg+xml;charset=utf-8,".length));
    expect(markup).toContain('viewBox="0 0 160 90"');
    expect(markup).toContain("<title>Slide 1</title>");
    expect(markup).toContain(">w160</text>");
    expect(renderer.buildThumbnail(7, 160)).toBeNull();
  });

  it("falls back to the Office 16:9 size when the deck declares none", () => {
    const module = fakeModule();
    const renderer = createPptxDeckRenderer(module, { deck: { slides: [{ id: "s1" }] } }, { idPrefix: "t", palette });
    expect(renderer.aspect).toBeCloseTo(6858000 / 12192000, 6);
    renderer.buildSlide(0, 320);
    expect(module.buildRenderSlide).toHaveBeenCalledWith(expect.anything(), { cx: 12192000, cy: 6858000 }, expect.objectContaining({ fitWidthPx: 320 }));
  });

  it("passes the media resolver through and honors the pattern grid option", () => {
    const module = fakeModule();
    const renderer = createPptxDeckRenderer(module, { ...input, resolveMedia: (ref) => `data:image/png;base64,${ref}` }, { idPrefix: "t", palette });
    renderer.buildSlide(0, 320);
    expect(module.buildRenderSlide).toHaveBeenCalledWith(expect.anything(), size, expect.objectContaining({ media: expect.any(Function) }));
  });

  it("degrades pattern fills without a grid and tiles them with one", () => {
    const module: PptxRendererModule = {
      ...fakeModule(),
      buildRenderSlide: () => slide([shapeNode({ fill: { kind: "pattern", preset: "pct50", fg: "#111111", bg: "#eeeeee", cellPx: 8 } })]),
    };
    const withoutGrid = decodeURIComponent(createPptxDeckRenderer(module, input, { idPrefix: "t", palette }).buildThumbnail(0, 120)!.split(",")[1]!);
    expect(withoutGrid).toContain('fill="#eeeeee"');
    expect(withoutGrid).not.toContain("<pattern");
    const withGrid = decodeURIComponent(
      createPptxDeckRenderer({ ...module, patternGrid: () => [[true]] }, input, { idPrefix: "t", palette }).buildThumbnail(0, 120)!.split(",")[1]!,
    );
    expect(withGrid).toContain("<pattern");
  });

  it("passes preset geometry resolvers through for a hand-built tree", () => {
    const module: PptxRendererModule = {
      ...fakeModule(),
      buildRenderSlide: () => slide([shapeNode({ presetGeometry: "star5" })]),
      presetPolygon: () => [0, 0, 10, 0, 5, 5],
    };
    const markup = decodeURIComponent(createPptxDeckRenderer(module, input, { idPrefix: "t", palette }).buildThumbnail(0, 120)!.split(",")[1]!);
    expect(markup).toContain('<polygon points="0 0 10 0 5 5"');
  });
});
