// B4 / real-deck proof: click, shift-click, marquee, move and resize against REAL render
// trees of two decks with different slide sizes (16:9 and 4:3), each at two zoom levels.
// The overlay's pointer mapping reads its real box, so a mocked getBoundingClientRect at
// page * zoom stands in for the browser layout.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as artifact from "@uniwork/office-upstream/pptx-renderer";
import { bindPptxEngine, bindPptxOps, createPptxAdapter, type OpenedPptxLike } from "@uniwork/office-engine/pptx";
import { collectRenderNodeBoxes } from "../canvas/build-slide-svg";
import type { PptxNodeBox, PptxRenderSlide } from "../canvas/render-tree";
import { handlePosition } from "./geometry";
import { PptxSelectionOverlay } from "./pptx-selection-overlay";
import { usePptxSelection } from "./use-pptx-selection";

// vitest runs with cwd = packages/views; import.meta.url is a vite fs url under jsdom.
const slidePath = (name: string) => resolve(process.cwd(), "../../docs/office/g0/fixtures/files/slides", `${name}.pptx`);

interface LoadedSlide {
  page: { widthPx: number; heightPx: number };
  boxes: PptxNodeBox[];
  title: PptxNodeBox;
  subtitle: PptxNodeBox;
}

/** The text of a node's first run; the title/subtitle are found by it, never by id. */
function firstText(slide: PptxRenderSlide, sourceId: string): string {
  const node = slide.nodes.find((candidate) => candidate.sourceId === sourceId) as { text?: { lines: { runs: { text: string }[] }[] } } | undefined;
  return node?.text?.lines[0]?.runs[0]?.text ?? "";
}

async function loadSlide(file: string, titleStart: string, subtitleStart: string): Promise<LoadedSlide> {
  const adapter = createPptxAdapter({ engine: bindPptxEngine(artifact as never), ops: bindPptxOps(artifact as never) });
  const opened = await adapter.open({ bytes: new Uint8Array(readFileSync(slidePath(file))), format: "pptx", document_id: file });
  if (opened.outcome !== "opened") throw new Error("fixture did not open");
  const deck = (adapter.sessionOf(opened.document_model_ref).model.opened as OpenedPptxLike).deck as { slides: unknown[]; size: unknown };
  const slide = artifact.buildRenderSlide(deck.slides[0] as never, deck.size as never, { fitWidthPx: 960, slideNo: 1 }) as unknown as PptxRenderSlide;
  const boxes = collectRenderNodeBoxes(slide);
  const byText = (start: string) => {
    const node = slide.nodes.find((candidate) => firstText(slide, candidate.sourceId).startsWith(start));
    const found = boxes.find((entry) => entry.sourceId === node?.sourceId);
    if (!found) throw new Error(`no node starting with ${start}`);
    return found;
  };
  return { page: { widthPx: slide.widthPx, heightPx: slide.heightPx }, boxes, title: byText(titleStart), subtitle: byText(subtitleStart) };
}

// Different slide sizes: 12191695 x 6858000 EMU (16:9) and 9144000 x 6858000 EMU (4:3).
const DECKS = [
  { name: "pptx-standard-business", title: "Q3", subtitle: "Fiscal" },
  { name: "pptx-vietnamese", title: "Báo", subtitle: "Công" },
] as const;
const ZOOMS = [1, 1.6875] as const;
const loaded = new Map<string, LoadedSlide>();

beforeAll(async () => {
  for (const deck of DECKS) loaded.set(deck.name, await loadSlide(deck.name, deck.title, deck.subtitle));
}, 60_000);
afterEach(() => vi.restoreAllMocks());

function mount(slide: LoadedSlide, zoom: number) {
  const commit = vi.fn(async (_request: unknown) => undefined);
  function Harness() {
    const controller = usePptxSelection({
      slideIndex: 0,
      boxes: slide.boxes,
      page: slide.page,
      fitWidthPx: 960,
      scale: zoom,
      interactive: true,
      commitTransform: commit as never,
    });
    return <PptxSelectionOverlay page={slide.page} controller={controller} />;
  }
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: slide.page.widthPx * zoom, bottom: slide.page.heightPx * zoom,
    width: slide.page.widthPx * zoom, height: slide.page.heightPx * zoom, x: 0, y: 0, toJSON: () => ({}),
  });
  const view = render(<Harness />);
  const overlay = view.container.querySelector("[data-pptx-selection-overlay]") as HTMLElement;
  const at = (x: number, y: number, shiftKey = false) => ({ button: 0, clientX: x * zoom, clientY: y * zoom, shiftKey });
  return {
    view,
    commit,
    down: (x: number, y: number, shiftKey = false) => fireEvent.pointerDown(overlay, at(x, y, shiftKey)),
    move: (x: number, y: number) => fireEvent.pointerMove(overlay, at(x, y)),
    up: (x: number, y: number) => fireEvent.pointerUp(overlay, at(x, y)),
    outline: () => view.container.querySelector<HTMLElement>("[data-pptx-selection-outline]"),
  };
}

const centre = (b: PptxNodeBox) => ({ x: b.box.x + b.box.w / 2, y: b.box.y + b.box.h / 2 });

describe.each(DECKS)("real deck $name", (deck) => {
  describe.each(ZOOMS)("at zoom %s", (zoom) => {
    const slide = () => loaded.get(deck.name)!;

    it("click selects only the title and the outline and handles land on its box", () => {
      const { title, subtitle, page } = slide();
      expect(title.sourceId).not.toBe(subtitle.sourceId);
      const h = mount(slide(), zoom);
      const c = centre(title);
      h.down(c.x, c.y);
      h.up(c.x, c.y);
      const outline = h.outline()!;
      expect(outline).not.toBeNull();
      expect(parseFloat(outline.style.left)).toBeCloseTo((title.box.x / page.widthPx) * 100, 3);
      expect(parseFloat(outline.style.top)).toBeCloseTo((title.box.y / page.heightPx) * 100, 3);
      expect(parseFloat(outline.style.width)).toBeCloseTo((title.box.w / page.widthPx) * 100, 3);
      expect(parseFloat(outline.style.height)).toBeCloseTo((title.box.h / page.heightPx) * 100, 3);
      const nw = outline.querySelector<HTMLElement>("[data-pptx-handle='nw']")!;
      const se = outline.querySelector<HTMLElement>("[data-pptx-handle='se']")!;
      expect(nw.style.left).toMatch(/^calc\(0%/);
      expect(se.style.left).toMatch(/^calc\(100%/);
    });

    it("shift-click adds the subtitle; a marquee over both selects both", () => {
      const { title, subtitle, page } = slide();
      const h = mount(slide(), zoom);
      const tc = centre(title);
      const sc = centre(subtitle);
      h.down(tc.x, tc.y);
      h.up(tc.x, tc.y);
      h.down(sc.x, sc.y, true);
      h.up(sc.x, sc.y);
      const top = Math.min(title.box.y, subtitle.box.y);
      const bottom = Math.max(title.box.y + title.box.h, subtitle.box.y + subtitle.box.h);
      expect(parseFloat(h.outline()!.style.top)).toBeCloseTo((top / page.heightPx) * 100, 3);
      expect(parseFloat(h.outline()!.style.height)).toBeCloseTo(((bottom - top) / page.heightPx) * 100, 3);

      // Marquee from an empty corner over both elements replaces the selection.
      h.down(0.5, 0.5);
      h.move(page.widthPx - 0.5, page.heightPx - 0.5);
      expect(h.view.container.querySelector("[data-pptx-marquee]")).not.toBeNull();
      h.up(page.widthPx - 0.5, page.heightPx - 0.5);
      expect(h.view.container.querySelector("[data-pptx-marquee]")).toBeNull();
      expect(parseFloat(h.outline()!.style.top)).toBeLessThanOrEqual((top / page.heightPx) * 100 + 1e-6);
      expect(parseFloat(h.outline()!.style.height)).toBeGreaterThanOrEqual(((bottom - top) / page.heightPx) * 100 - 1e-6);
    });

    it("a move drag commits exactly one transform for the title with the delta", async () => {
      const { title } = slide();
      const h = mount(slide(), zoom);
      const c = centre(title);
      h.down(c.x, c.y);
      h.move(c.x + 20, c.y + 10);
      h.move(c.x + 40, c.y + 20);
      expect(h.commit).not.toHaveBeenCalled();
      h.up(c.x + 40, c.y + 20);
      await Promise.resolve();
      expect(h.commit).toHaveBeenCalledTimes(1);
      expect(h.commit).toHaveBeenCalledWith(expect.objectContaining({
        slideIndex: 0,
        sourceId: title.sourceId,
        xPx: expect.closeTo(title.box.x + 40, 2),
        yPx: expect.closeTo(title.box.y + 20, 2),
        wPx: expect.closeTo(title.box.w, 2),
        hPx: expect.closeTo(title.box.h, 2),
      }));
    });

    it("an se handle drag at the real handle position resizes the title", async () => {
      const { title } = slide();
      const h = mount(slide(), zoom);
      const c = centre(title);
      h.down(c.x, c.y);
      h.up(c.x, c.y);
      const se = handlePosition(title.box, "se");
      h.down(se.x, se.y);
      h.move(se.x + 15, se.y + 10);
      h.move(se.x + 30, se.y + 20);
      h.up(se.x + 30, se.y + 20);
      await Promise.resolve();
      expect(h.commit).toHaveBeenCalledTimes(1);
      expect(h.commit).toHaveBeenCalledWith(expect.objectContaining({
        sourceId: title.sourceId,
        xPx: expect.closeTo(title.box.x, 2),
        yPx: expect.closeTo(title.box.y, 2),
        wPx: expect.closeTo(title.box.w + 30, 2),
        hPx: expect.closeTo(title.box.h + 20, 2),
      }));
    });
  });
});
