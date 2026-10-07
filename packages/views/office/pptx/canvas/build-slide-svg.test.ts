import { describe, expect, it } from "vitest";
import { buildSlideSvg, collectRenderNodeBoxes } from "./build-slide-svg";
import type { PptxCanvasPalette } from "./paint";
import { reactSvgProps, serializeSvgNode, slideSvgMarkup, svgDataUrl } from "./svg-node";
import { box, byTag, chartNode, elementGroup, run, shapeNode, slide, tableNode, textContent, textLayout } from "./pptx-render-fixtures";

const palette: PptxCanvasPalette = { pageFill: "#ffffff", chipFill: "#f4f4f5", chipStroke: "#e4e4e7", chipText: "#646464" };
const build = (nodes: Parameters<typeof slide>[0], overrides: Parameters<typeof slide>[1] = {}, options: Partial<Parameters<typeof buildSlideSvg>[1]> = {}) =>
  buildSlideSvg(slide(nodes, overrides), { idPrefix: "test", palette, ...options });

describe("buildSlideSvg: background", () => {
  it("paints the deck background first, in page coordinates", () => {
    const doc = build([], { background: { kind: "solid", color: "#102030" } });
    const rects = byTag(doc.root, "rect");
    expect(rects[0]?.attrs).toMatchObject({ x: 0, y: 0, width: 960, height: 540, fill: "#102030" });
  });

  it("falls back to the page fill when the deck declares no background", () => {
    const doc = build([], { background: { kind: "none" } });
    expect(byTag(doc.root, "rect")[0]?.attrs?.fill).toBe("#ffffff");
  });

  it("keeps a gradient background in defs and references it", () => {
    const doc = build([], { background: { kind: "gradient", stops: [{ pos: 0, color: "#FF0000" }, { pos: 1, color: "#0000FF" }], angleDeg: 90 } });
    const gradient = byTag(doc.root, "linearGradient")[0];
    expect(gradient?.attrs?.id).toBe("test-grad-1");
    expect(byTag(doc.root, "rect")[0]?.attrs?.fill).toBe("url(#test-grad-1)");
    expect(byTag(doc.root, "stop").length).toBeGreaterThanOrEqual(2);
  });
});

describe("buildSlideSvg: shapes", () => {
  it("rotates on the box centre and keeps the local origin at the box top-left", () => {
    const doc = build([shapeNode({ box: box({ x: 100, y: 50, w: 200, h: 100, rotationDeg: 90 }) })]);
    const group = elementGroup(doc.root, "shape-1");
    expect(group?.attrs?.transform).toBe("translate(200 100) rotate(90) translate(-100 -50)");
  });

  it("draws fill, stroke, dash and the round-rect radius", () => {
    const doc = build([
      shapeNode({
        cornerRadiusPx: 12,
        stroke: { color: "#112233", widthPx: 2, widthPt: 1.5, dash: [4, 2], cap: "round", join: "bevel" },
      }),
    ]);
    expect(byTag(doc.root, "rect")[1]?.attrs).toMatchObject({
      width: 200,
      height: 120,
      rx: 12,
      ry: 12,
      fill: "#3366CC",
      stroke: "#112233",
      "stroke-width": 2,
      "stroke-dasharray": "4 2",
      "stroke-linecap": "round",
      "stroke-linejoin": "bevel",
    });
  });

  it("emits polygon, fill-only, stroke-only and custGeom paths", () => {
    const polygon = build([shapeNode({ polygonPoints: [0, 0, 100, 0, 50, 50] })]);
    expect(byTag(polygon.root, "polygon")[0]?.attrs?.points).toBe("0 0 100 0 50 50");
    const paths = build([shapeNode({ pathData: "M 0 0 L 10 10", fillPathData: "M 0 0 L 5 5", strokePathData: "M 1 1 L 2 2" })]);
    const d = byTag(paths.root, "path").map((node) => node.attrs?.d);
    expect(d).toEqual(["M 0 0 L 5 5", "M 0 0 L 10 10", "M 1 1 L 2 2"]);
    expect(byTag(paths.root, "path")[2]?.attrs?.fill).toBe("none");
    const ellipse = build([shapeNode({ presetGeometry: "ellipse" })]);
    expect(byTag(ellipse.root, "ellipse")[0]?.attrs).toMatchObject({ cx: 100, cy: 60, rx: 100, ry: 60 });
  });

  it("falls back to the artifact preset geometry for a hand-built node, and to a rect without one", () => {
    const presetPath = (preset: string | undefined) => (preset === "round2SameRect" ? { d: "M 0 0 L 10 0 Z" } : null);
    const presetPolygon = (preset: string | undefined) => (preset === "star5" ? [0, 0, 100, 0, 50, 50] : null);
    const polygon = build([shapeNode({ presetGeometry: "star5" })], {}, { presetPath, presetPolygon });
    expect(byTag(polygon.root, "polygon")[0]?.attrs?.points).toBe("0 0 100 0 50 50");
    const path = build([shapeNode({ presetGeometry: "round2SameRect" })], {}, { presetPath, presetPolygon });
    expect(byTag(path.root, "path")[0]?.attrs?.d).toBe("M 0 0 L 10 0 Z");
    const degraded = build([shapeNode({ presetGeometry: "star5" })]);
    expect(byTag(degraded.root, "polygon")).toHaveLength(0);
    expect(byTag(degraded.root, "rect")[1]?.attrs?.width).toBe(200);
  });

  it("draws a connector polyline with its arrow heads", () => {
    const doc = build([
      shapeNode({
        fill: { kind: "none" },
        stroke: { color: "#000000", widthPx: 1.5, widthPt: 1 },
        line: {
          points: [0, 0, 100, 0],
          tailEnd: { type: "triangle", widthPx: 8, lengthPx: 10 },
          headEnd: { type: "arrow", widthPx: 8, lengthPx: 10 },
        },
      }),
    ]);
    expect(byTag(doc.root, "polyline")[0]?.attrs?.points).toBe("0 0 100 0");
    expect(byTag(doc.root, "polygon").length).toBe(1);
    expect(byTag(doc.root, "path").length).toBe(1);
  });

  it("draws a pinned-side connector exactly to the engine-routed sites and keeps its colour, width and dash", () => {
    // UNI-939 T03: bottom of one shape (50, 0) down to the top of another (50, 120) is a vertical run.
    const doc = build([
      shapeNode({
        fill: { kind: "none" },
        stroke: { color: "#C00000", widthPx: 4, widthPt: 3, dash: [12, 8] },
        line: { points: [50, 0, 50, 120] },
      }),
    ]);
    const polyline = byTag(doc.root, "polyline")[0];
    expect(polyline?.attrs?.points).toBe("50 0 50 120");
    expect(polyline?.attrs?.stroke).toBe("#C00000");
    expect(polyline?.attrs?.["stroke-width"]).toBe(4);
    expect(polyline?.attrs?.["stroke-dasharray"]).toBe("12 8");
  });

  it("substitutes a transparent or solid paint for image fills and references defs", () => {
    const doc = build([shapeNode({ fill: { kind: "image", dataUrl: "data:image/png;base64,AAAA", mode: "stretch" } })]);
    const pattern = byTag(doc.root, "pattern")[0];
    expect(pattern?.attrs?.patternUnits).toBe("userSpaceOnUse");
    expect(byTag(doc.root, "image")[0]?.attrs?.href).toBe("data:image/png;base64,AAAA");
    expect(byTag(doc.root, "rect")[1]?.attrs?.fill).toBe(`url(#${String(pattern?.attrs?.id)})`);
  });

  it("degrades pattern fills without a pattern grid and tiles them with one", () => {
    const fill = { kind: "pattern", preset: "pct50", fg: "#000000", bg: "#FFFFFF", cellPx: 8 } as const;
    const degraded = build([shapeNode({ fill })]);
    expect(byTag(degraded.root, "pattern")).toHaveLength(0);
    expect(byTag(degraded.root, "rect")[1]?.attrs?.fill).toBe("#FFFFFF");
    const grid: boolean[][] = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (x + y) % 2 === 0));
    const tiled = build([shapeNode({ fill })], {}, { patternGrid: () => grid });
    // The cell grid is page-locked, not node-anchored: the shape sits at page (40, 30), so the
    // first cell boundary snaps back to the page multiple (40 % 8 = 0, 30 % 8 = 6 -> -6).
    expect(byTag(tiled.root, "pattern")[0]?.attrs).toMatchObject({ width: 8, height: 8, x: 0, y: -6 });
    expect(byTag(tiled.root, "path").some((node) => typeof node.attrs?.d === "string" && String(node.attrs.d).includes("M0 0h1v1h-1z"))).toBe(true);
  });

  it("replaces the flat geometry with scene3d faces", () => {
    const doc = build([
      shapeNode({
        extrusion: {
          faces: [
            { path: "M 0 0 L 100 0 L 100 50 Z", color: "#222222" },
            { path: "M 0 0 L 100 0 L 100 50 Z", color: "transparent", front: true },
          ],
        },
      }),
    ]);
    expect(byTag(doc.root, "rect")).toHaveLength(1);
    const paths = byTag(doc.root, "path");
    expect(paths).toHaveLength(2);
    expect(paths[0]?.attrs?.fill).toBe("#222222");
    expect(paths[1]?.attrs?.fill).toBe("#3366CC");
  });

  it("applies an outer shadow as a filter and skips inner/perspective shadows", () => {
    const outer = build([shapeNode({ shadow: { color: "#000000", blurPx: 8, offsetX: 2, offsetY: 3 } })]);
    expect(byTag(outer.root, "filter")[0]?.attrs?.id).toBe("test-shadow-1");
    expect(byTag(outer.root, "feDropShadow")[0]?.attrs).toMatchObject({ dx: 2, dy: 3, stdDeviation: 4 });
    const inner = build([shapeNode({ shadow: { color: "#000000", blurPx: 8, offsetX: 2, offsetY: 3, inner: true } })]);
    expect(byTag(inner.root, "filter")).toHaveLength(0);
  });
});

describe("buildSlideSvg: text", () => {
  it("positions runs on their baseline with per-run styling", () => {
    const doc = build([
      shapeNode({
        text: textLayout({
          lines: [
            { runs: [run({ text: "Bold ", bold: true }), run({ x: 60, text: "under", underline: true, strike: true, highlight: "#FFFF00", fontSizePx: 18, letterSpacingPx: 1.5, kerningOff: true })], top: 8, height: 32 },
          ],
        }),
      }),
    ]);
    const texts = byTag(doc.root, "text");
    expect(texts).toHaveLength(2);
    expect(texts[0]?.attrs).toMatchObject({ x: 8, y: 30, "font-size": 24, "font-weight": "bold", fill: "#000000" });
    expect(texts[1]?.attrs).toMatchObject({ x: 60, y: 30, "font-size": 18, "text-decoration": "underline line-through", "letter-spacing": 1.5, "font-kerning": "none" });
    expect(texts[0]?.attrs?.["xml:space"]).toBe("preserve");
    const highlight = byTag(doc.root, "rect").find((node) => node.attrs?.fill === "#FFFF00");
    expect(highlight?.attrs).toMatchObject({ x: 60, y: 8, width: 60, height: 32 });
  });

  it("rotates vertical-script runs and draws picture bullets", () => {
    const doc = build([
      shapeNode({
        text: textLayout({
          lines: [
            { runs: [run({ text: "縦", rotate90: true })], top: 0, height: 24 },
            { runs: [run({ text: "", image: "data:image/png;base64,BBBB", ascentPx: 12, widthPx: 12, baselineY: 60 })], top: 40, height: 24 },
          ],
        }),
      }),
    ]);
    expect(byTag(doc.root, "text")[0]?.attrs?.transform).toBe("rotate(90 8 30)");
    const bullet = byTag(doc.root, "image")[0];
    expect(bullet?.attrs).toMatchObject({ x: 8, y: 48, width: 12, height: 12, href: "data:image/png;base64,BBBB" });
  });

  it("counter-flips glyphs inside a mirrored box but keeps the geometry flipped", () => {
    const doc = build([shapeNode({ box: box({ x: 10, y: 10, w: 100, h: 50, flipH: true }), text: textLayout() })]);
    const group = elementGroup(doc.root, "shape-1");
    expect(group?.attrs?.transform).toContain("scale(-1 1)");
    const textGroup = byTag(doc.root, "g").find((node) => typeof node.attrs?.transform === "string" && String(node.attrs.transform).startsWith("translate(100 0) scale(-1 1)"));
    expect(textGroup).toBeDefined();
  });

  it("draws WordArt extrusion copies behind the glyphs", () => {
    const doc = build([shapeNode({ text: textLayout({ extrusion: { color: "#880000", dx: 2, dy: 3 } }) })]);
    const copies = byTag(doc.root, "text");
    expect(copies).toHaveLength(2);
    expect(copies[0]?.attrs?.fill).toBe("#880000");
    expect(copies[0]?.attrs?.x).toBe(8);
  });
});

describe("buildSlideSvg: pictures", () => {
  it("crops through srcRect, clips, opacity and blip effects", () => {
    const doc = build([
      {
        id: "r_pic-1",
        type: "picture",
        sourceId: "pic-1",
        box: box({ x: 20, y: 20, w: 400, h: 200 }),
        dataUrl: "data:image/png;base64,CCCC",
        srcRect: { l: 0.25, t: 0.1, r: 0.25, b: 0.1 },
        clip: { cornerRadiusPx: 20 },
        opacity: 0.5,
        lum: { bright: 0.2, contrast: 0 },
      },
    ]);
    const image = byTag(doc.root, "image")[0];
    expect(image?.attrs).toMatchObject({ x: -200, y: -25, width: 800, height: 250, opacity: 0.5, preserveAspectRatio: "none" });
    expect(String(image?.attrs?.["clip-path"])).toMatch(/^url\(#test-picclip-1\)$/);
    expect(byTag(doc.root, "clipPath")[0]?.children?.[0]?.attrs).toMatchObject({ rx: 20, ry: 20 });
    expect(byTag(doc.root, "feComponentTransfer").length).toBeGreaterThan(0);
  });

  it("overlays a media badge on video and audio posters", () => {
    const doc = build([{ id: "r_m-1", type: "picture", sourceId: "m-1", box: box({ w: 300, h: 200 }), dataUrl: "data:image/png;base64,DDDD", media: "video" }]);
    expect(byTag(doc.root, "circle")).toHaveLength(1);
    expect(byTag(doc.root, "polygon")).toHaveLength(1);
    const audio = build([{ id: "r_m-2", type: "picture", sourceId: "m-2", box: box({ w: 300, h: 200 }), dataUrl: "data:image/png;base64,DDDD", media: "audio" }]);
    expect(byTag(audio.root, "circle")).toHaveLength(1);
    expect(byTag(audio.root, "path")).toHaveLength(1);
  });
});

describe("buildSlideSvg: groups", () => {
  it("nests children in group-local coordinates and flattens boxes for selection", () => {
    const child = shapeNode({ id: "r_child", sourceId: "child-1", box: box({ x: 10, y: 5, w: 40, h: 20 }) });
    const doc = build([{ id: "r_g", type: "group", sourceId: "group-1", box: box({ x: 100, y: 50, w: 200, h: 150 }), children: [child] }]);
    const group = elementGroup(doc.root, "group-1");
    expect(group?.attrs?.transform).toBe("translate(200 125) translate(-100 -75)");
    const childGroup = elementGroup(doc.root, "child-1");
    expect(childGroup).toBeDefined();
    // The child's selection attributes carry its absolute page offset (parent 100/50 + child 10/5).
    expect(childGroup?.attrs).toMatchObject({ "data-pptx-page-x": 110, "data-pptx-page-y": 55 });
    const boxes = collectRenderNodeBoxes(slide([{ id: "r_g", type: "group", sourceId: "group-1", box: box({ x: 100, y: 50, w: 200, h: 150 }), children: [child] }]));
    expect(boxes.map((entry) => [entry.sourceId, entry.box.x, entry.box.y])).toEqual([
      ["group-1", 100, 50],
      ["child-1", 110, 55],
    ]);
  });
});

describe("buildSlideSvg: tables and charts", () => {
  it("draws cell fills, per-side borders and cell text", () => {
    const doc = build([tableNode()]);
    const rects = byTag(doc.root, "rect");
    expect(rects.some((node) => node.attrs?.fill === "#EEEEEE" && node.attrs?.x === 0)).toBe(true);
    const borders = byTag(doc.root, "line");
    expect(borders).toHaveLength(2);
    expect(borders[0]?.attrs).toMatchObject({ x1: 0, y1: 0, x2: 0, y2: 50, stroke: "#000000", "stroke-width": 1 });
    expect(textContent(doc.root)).toEqual(["A1"]);
  });

  it("draws chart primitives in chart-local space", () => {
    const doc = build([
      chartNode({
        wedges: [{ cx: 100, cy: 100, outerR: 60, innerR: 0, startDeg: -90, sweepDeg: 120, color: "#FF0000" }],
        markers: [{ x: 10, y: 10, r: 3, color: "#00FF00" }],
        swatches: [{ x: 200, y: 10, w: 10, h: 10, color: "#0000FF" }],
        paths: [{ d: "M 0 0 L 5 5 Z", fill: "#123456", dy: 4 }],
      }),
    ]);
    expect(byTag(doc.root, "line")).toHaveLength(2);
    expect(byTag(doc.root, "rect").some((node) => node.attrs?.fill === "#4472C4")).toBe(true);
    const wedge = byTag(doc.root, "path").find((node) => typeof node.attrs?.d === "string" && String(node.attrs.d).startsWith("M 100 100 L 100 40"));
    expect(wedge?.attrs?.fill).toBe("#FF0000");
    expect(wedge?.attrs?.stroke).toBe("#ffffff");
    expect(byTag(doc.root, "circle")[0]?.attrs).toMatchObject({ cx: 10, cy: 10, r: 3 });
    const freeform = byTag(doc.root, "path").find((node) => node.attrs?.dy === undefined && node.attrs?.d === "M 0 0 L 5 5 Z");
    expect(freeform?.attrs?.transform).toBe("translate(0 4)");
    expect(textContent(doc.root)).toEqual(["Q1"]);
  });

  describe("legend swatch spacing (W8 F1)", () => {
    // Two legend entries on one row: swatch (half an em) + 4 + label, so the gap to the next swatch
    // recovers the measured width of "Series" (here 110 - 10 - 2 * 10 - 4 = 76). `drop` is the swatch offset
    // below the label top, in em: pie/doughnut legends use 0.25, every other builder 0.3.
    const legendNode = (kind: string, drop: number, wedges: [] | undefined) => {
      const fontSizePx = 20;
      const swatchY = 100 + fontSizePx * drop;
      return chartNode({
        styleInfo: { kind, legendPos: "b", dataLabels: false, gridlines: false },
        ...(wedges ? { wedges } : {}),
        labels: [{ text: "Series", x: 24, y: 100, fontSizePx, color: "#444444" }],
        swatches: [
          { x: 10, y: swatchY, w: 10, h: 10, color: "#FF0000" },
          { x: 110, y: swatchY, w: 10, h: 10, color: "#00FF00" },
        ],
      });
    };
    const legendTextLength = (node: ReturnType<typeof chartNode>) => byTag(build([node]).root, "text").find((text) => text.attrs?.["xml:space"] === "preserve")?.attrs?.textLength;

    it("pins a pie legend label on the pie swatch drop", () => {
      expect(legendTextLength(legendNode("pie", 0.25, []))).toBe(76);
      expect(legendTextLength(legendNode("doughnut", 0.25, []))).toBe(76);
    });

    it("does not give a sunburst-shaped node (empty wedges, no pie kind) the pie drop", () => {
      // buildSunburstNode also seeds `wedges = []`; only the chart kind marks a pie.
      expect(legendTextLength(legendNode("unknown", 0.25, []))).toBeUndefined();
      expect(legendTextLength(legendNode("unknown", 0.3, []))).toBe(76);
    });

    it("keeps the non-pie drop for a bar legend that carries no wedges", () => {
      expect(legendTextLength(legendNode("bar", 0.3, undefined))).toBe(76);
      expect(legendTextLength(legendNode("bar", 0.25, undefined))).toBeUndefined();
    });
  });
});

describe("buildSlideSvg: placeholder chips and element hooks", () => {
  it("uses the token palette for chips and exposes the selection seam", () => {
    const doc = build([{ id: "r_c", type: "placeholder-chip", sourceId: "chip-1", box: box({ w: 200, h: 90 }), kind: "chart", label: "Chart" }]);
    const chip = elementGroup(doc.root, "chip-1");
    expect(chip?.attrs?.["data-pptx-node-type"]).toBe("placeholder-chip");
    const rect = byTag(doc.root, "rect")[1];
    expect(rect?.attrs).toMatchObject({ fill: "#f4f4f5", stroke: "#e4e4e7", class: "fill-muted stroke-border" });
    expect(textContent(doc.root)).toEqual(["Chart"]);
  });

  it("marks decoration and background nodes and reports page offsets", () => {
    const doc = build([shapeNode({ sourceId: "deco-1", decoration: true, background: true })]);
    const group = elementGroup(doc.root, "deco-1");
    expect(group?.attrs).toMatchObject({ "data-pptx-decoration": "true", "data-pptx-background": "true", "data-pptx-page-x": 40, "data-pptx-page-y": 30 });
  });
});

describe("reactSvgProps", () => {
  it("keeps data-*/aria-* names verbatim, camel-cases known SVG attributes and passes unknown kebab ones through", () => {
    expect(
      reactSvgProps({
        "data-pptx-element-id": "shape-1",
        "data-pptx-page-x": 40,
        "aria-hidden": "true",
        "stroke-width": 2,
        "stroke-dasharray": "4 2",
        "font-family": "Calibri",
        "font-kerning": "none",
        "xml:space": "preserve",
        class: "fill-muted",
        viewBox: "0 0 960 540",
      }),
    ).toEqual({
      "data-pptx-element-id": "shape-1",
      "data-pptx-page-x": 40,
      "aria-hidden": "true",
      strokeWidth: 2,
      strokeDasharray: "4 2",
      fontFamily: "Calibri",
      "font-kerning": "none",
      xmlSpace: "preserve",
      className: "fill-muted",
      viewBox: "0 0 960 540",
    });
  });
});
describe("slide serialization", () => {
  it("emits a standalone SVG document with a title and escaped text", () => {
    const doc = build([shapeNode({ text: textLayout({ lines: [{ runs: [run({ text: "a < b & c" })], top: 0, height: 24 }] }) })]);
    const markup = slideSvgMarkup(doc.root, doc, { title: "Slide 1" });
    expect(markup.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540" role="img">')).toBe(true);
    expect(markup).toContain("<title>Slide 1</title>");
    expect(markup).toContain("a &lt; b &amp; c");
    expect(markup.endsWith("</svg>")).toBe(true);
  });

  it("produces a utf-8 data URL and keeps the serializer free of self-closing text nodes", () => {
    const doc = build([]);
    const url = svgDataUrl(slideSvgMarkup(doc.root, doc));
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(url.slice("data:image/svg+xml;charset=utf-8,".length))).toContain("<svg");
    expect(serializeSvgNode({ tag: "text", text: "" })).toBe("<text></text>");
    expect(serializeSvgNode({ tag: "rect", attrs: { fill: "#fff" } })).toBe('<rect fill="#fff"/>');
  });
});
