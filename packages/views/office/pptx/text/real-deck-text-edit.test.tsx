import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import * as artifact from "@uniwork/office-upstream/pptx-renderer";
import { bindPptxEngine, bindPptxOps, createPptxAdapter, type OpenedPptxLike } from "@uniwork/office-engine/pptx";
import type { PptxRenderSlide } from "../canvas/render-tree";
import type { PptxSelectionController } from "../selection/use-pptx-selection";
import { PptxTextEditLayer } from "./pptx-text-editor";
import { collectTextTargets, type PptxTextTarget } from "./text-model";

initI18n();
beforeEach(async () => { await setLocale("en"); });

const FIXTURE = resolve(import.meta.dirname, "../../../../../docs/office/g0/fixtures/files/slides/pptx-standard-business.pptx");
const FIT_WIDTH = 960;

let slide: PptxRenderSlide;
let targets: PptxTextTarget[];

beforeAll(async () => {
  const adapter = createPptxAdapter({ engine: bindPptxEngine(artifact as never), ops: bindPptxOps(artifact as never) });
  const opened = await adapter.open({ bytes: new Uint8Array(readFileSync(FIXTURE)), format: "pptx", document_id: "dbl" });
  if (opened.outcome !== "opened") throw new Error("fixture did not open");
  const deck = (adapter.sessionOf(opened.document_model_ref).model.opened as OpenedPptxLike).deck as { slides: unknown[]; size: { cx: number; cy: number } };
  slide = artifact.buildRenderSlide(deck.slides[0] as never, deck.size as never, { fitWidthPx: FIT_WIDTH, slideNo: 1 }) as unknown as PptxRenderSlide;
  targets = collectTextTargets(slide);
});

function controller(): PptxSelectionController {
  return {
    selection: { ids: [] }, bounds: null, previews: [], marquee: null, canDelete: false,
    clear: vi.fn(), selectAll: vi.fn(), deleteSelection: vi.fn(),
    onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(), onPointerCancel: vi.fn(),
    onContextPointerDown: vi.fn(),
  } as PptxSelectionController;
}

function overlaps(a: PptxTextTarget["box"], b: PptxTextTarget["box"]): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe.each([{ display: 1000 }, { display: 1687 }])("real deck text edit at display width $display", ({ display }) => {
  it("opens the title, not the subtitle, and maps pointers into the title box", () => {
    const title = targets.find((target) => target.text.includes("Q3 Business Review"));
    const subtitle = targets.find((target) => target.text.includes("Fiscal Year 2026"));
    expect(title).toBeDefined();
    expect(subtitle).toBeDefined();
    expect(overlaps(title!.box, subtitle!.box)).toBe(false);

    const page = { widthPx: slide.widthPx, heightPx: slide.heightPx };
    const displayHeight = (display * page.heightPx) / page.widthPx;
    const c = controller();
    const onOpen = vi.fn();
    const { container } = render(
      <PptxTextEditLayer slideIndex={0} targets={targets} page={page} displayWidthPx={display} displayHeightPx={displayHeight} controller={c} activeId={null} onOpen={onOpen} />,
    );
    const layer = container.querySelector("[data-pptx-text-layer]") as HTMLElement;
    layer.getBoundingClientRect = () => ({ left: 10, top: 20, width: display, height: displayHeight, right: 10 + display, bottom: 20 + displayHeight, x: 10, y: 20, toJSON: () => ({}) });

    const hit = container.querySelector(`[data-pptx-text-target='${title!.sourceId}']`) as HTMLElement;
    fireEvent.doubleClick(hit);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![0].sourceId).toBe(title!.sourceId);
    expect(onOpen.mock.calls[0]![0].sourceId).not.toBe(subtitle!.sourceId);

    // A click at the title box centre, in client px of the displayed (scaled) slide.
    const cx = 10 + ((title!.box.x + title!.box.w / 2) / page.widthPx) * display;
    const cy = 20 + ((title!.box.y + title!.box.h / 2) / page.heightPx) * displayHeight;
    fireEvent.pointerDown(hit, { button: 0, clientX: cx, clientY: cy });
    const point = (c.onPointerDown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { x: number; y: number };
    expect(point.x).toBeGreaterThan(title!.box.x);
    expect(point.x).toBeLessThan(title!.box.x + title!.box.w);
    expect(point.y).toBeGreaterThan(title!.box.y);
    expect(point.y).toBeLessThan(title!.box.y + title!.box.h);

    fireEvent.pointerDown(hit, { button: 2, clientX: cx, clientY: cy });
    expect(c.onContextPointerDown).toHaveBeenCalledWith(point);
  });
});
