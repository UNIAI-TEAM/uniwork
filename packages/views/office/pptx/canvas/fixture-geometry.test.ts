/** @vitest-environment node */
// UNI-927 visual-END F-08 / F-17, driven through the REAL generated renderer artifact and the
// real G0 fixture decks, so the assertions are on the geometry the canvas actually mounts.
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as artifact from "@uniwork/office-upstream/pptx-renderer";
import { bindPptxEngine, bindPptxOps, createPptxAdapter, type OpenedPptxLike } from "@uniwork/office-engine/pptx";
import { buildSlideSvg } from "./build-slide-svg";
import type { PptxChartRenderNode, PptxRenderSlide, PptxTableRenderNode } from "./render-tree";
import type { SvgNode } from "./svg-node";

const palette = { pageFill: "#ffffff", chipFill: "#f4f4f5", chipStroke: "#e4e4e7", chipText: "#646464" };

interface Deck {
  slides: unknown[];
  size: { cx: number; cy: number };
}

const fixtureBytes = (name: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../../docs/office/g0/fixtures/files/slides/${name}`, import.meta.url))));

async function loadDeck(name: string, bytes: Uint8Array = fixtureBytes(name)): Promise<Deck> {
  const adapter = createPptxAdapter({ engine: bindPptxEngine(artifact as never), ops: bindPptxOps(artifact as never) });
  const opened = await adapter.open({ bytes, format: "pptx", document_id: name });
  if (opened.outcome !== "opened") throw new Error(`${name} did not open`);
  return (adapter.sessionOf(opened.document_model_ref).model.opened as OpenedPptxLike).deck as Deck;
}

function build(deck: Deck, fitWidthPx: number): PptxRenderSlide {
  return artifact.buildRenderSlide(deck.slides[0] as never, deck.size as never, { fitWidthPx, slideNo: 1 }) as unknown as PptxRenderSlide;
}

function texts(node: SvgNode | string, out: SvgNode[] = []): SvgNode[] {
  if (typeof node === "string") return out;
  if (node.tag === "text") out.push(node);
  for (const child of node.children ?? []) texts(child, out);
  return out;
}

describe("pptx-table.pptx (F-08)", () => {
  // The fixture is internally inconsistent: a:gridCol sums to 9,000,000 EMU while the
  // graphicFrame ext is 7,000,000 and the slide is 9,144,000 wide. PowerPoint treats the grid
  // as authoritative (the engine documents the same), so the table legitimately runs 87 px past
  // the slide edge at 1000 px. The canvas must map that geometry faithfully and scale-stably
  // (never re-squeezing or double-scaling columns) and the slide viewport must clip it.
  it.each([1000, 200])("maps every column at the slide scale (fit width %i)", async (fit) => {
    const slide = build(await loadDeck("pptx-table.pptx"), fit);
    const table = slide.nodes.find((n): n is PptxTableRenderNode => n.type === "table")!;
    const emuToPx = fit / 9144000;
    const gridPx = 3000000 * emuToPx;
    const cols = [...new Set(table.cells.map((c) => c.x))].sort((a, b) => a - b);
    expect(cols).toHaveLength(3);
    for (const cell of table.cells) expect(cell.w).toBeCloseTo(gridPx, 1);
    expect(Math.max(...table.cells.map((c) => c.x + c.w))).toBeCloseTo(table.box.w, 1);
    expect(table.box.w).toBeCloseTo(9000000 * emuToPx, 1);
    expect(table.box.x).toBeCloseTo(800000 * emuToPx, 1);
  });

  it("emits cell rects in table-local coordinates that overflow identically at both widths", async () => {
    const deck = await loadDeck("pptx-table.pptx");
    const ratio = (fit: number): number => {
      const slide = build(deck, fit);
      const table = slide.nodes.find((n): n is PptxTableRenderNode => n.type === "table")!;
      return (table.box.x + table.box.w) / slide.widthPx;
    };
    expect(ratio(1000)).toBeCloseTo(ratio(200), 3);
  });
});

describe("pptx-chart.pptx legend (F-17)", () => {
  it.each([1000, 480])("keeps legend text inside its own legend cell (fit width %i)", async (fit) => {
    const slide = build(await loadDeck("pptx-chart.pptx"), fit);
    const chart = slide.nodes.find((n): n is PptxChartRenderNode => n.type === "chart")!;
    const doc = buildSlideSvg(slide, { idPrefix: "f17", palette });
    const legend = chart.swatches.filter((s) => chart.labels.some((l) => Math.abs(l.x - (s.x + s.w + 4)) < 0.01));
    expect(legend.length).toBeGreaterThanOrEqual(2);
    const drawn = texts(doc.root);
    legend.sort((a, b) => a.x - b.x);
    for (let i = 0; i < legend.length - 1; i += 1) {
      const swatch = legend[i]!;
      const label = chart.labels.find((l) => Math.abs(l.x - (swatch.x + swatch.w + 4)) < 0.01)!;
      const node = drawn.find((t) => t.text === label.text)!;
      const family = String(node.attrs?.["font-family"] ?? "");
      expect(family).toMatch(/calibri/i);
      const width = Number(node.attrs?.textLength);
      expect(width).toBeGreaterThan(0);
      expect(label.x + width).toBeLessThanOrEqual(legend[i + 1]!.x + 0.01);
    }
  });
});

// Pie/doughnut legends (build-chart.ts buildPieNode) drop the swatch 0.25em below the label top,
// bar/line/area legends 0.3em; the pin must follow whichever the engine used. No fixture deck
// holds a pie, so the real bar chart is rewritten to a pie/doughnut over the same categories.
async function pieDeckBytes(chartKind: "pieChart" | "doughnutChart"): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(fixtureBytes("pptx-chart.pptx"));
  const path = "ppt/charts/chart1.xml";
  const xml = await zip.file(path)!.async("string");
  const series = /<c:ser>.*<\/c:ser>/s.exec(xml)![0];
  const hole = chartKind === "doughnutChart" ? '<c:holeSize val="50"/>' : "";
  const body = `<c:${chartKind}><c:varyColors val="1"/>${series}${hole}</c:${chartKind}>`;
  zip.file(path, xml.replace(/<c:barChart>.*<\/c:barChart>/s, () => body).replace(/<c:catAx>.*<\/c:valAx>/s, ""));
  return zip.generateAsync({ type: "uint8array" });
}

describe("pie / doughnut legend (W3 review F1)", () => {
  it.each(["pieChart", "doughnutChart"] as const)("pins %s legend labels to their measured width", async (kind) => {
    const slide = build(await loadDeck("pptx-chart.pptx", await pieDeckBytes(kind)), 1000);
    const chart = slide.nodes.find((n): n is PptxChartRenderNode => n.type === "chart")!;
    expect(chart.wedges?.length).toBeGreaterThan(0);
    const legend = chart.swatches.filter((s) => chart.labels.some((l) => Math.abs(l.x - (s.x + s.w + 4)) < 0.01)).sort((a, b) => a.x - b.x);
    expect(legend.length).toBeGreaterThanOrEqual(3);
    const drawn = texts(buildSlideSvg(slide, { idPrefix: "pie", palette }).root);
    for (let i = 0; i < legend.length - 1; i += 1) {
      const swatch = legend[i]!;
      const label = chart.labels.find((l) => Math.abs(l.x - (swatch.x + swatch.w + 4)) < 0.01)!;
      expect(swatch.y).toBeCloseTo(label.y + label.fontSizePx * 0.25, 2);
      const width = Number(drawn.find((t) => t.text === label.text)?.attrs?.textLength);
      expect(width).toBeGreaterThan(0);
      expect(width).toBeCloseTo(legend[i + 1]!.x - swatch.x - swatch.w * 2 - 4, 2);
    }
  });
});
