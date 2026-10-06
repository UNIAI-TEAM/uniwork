import { describe, expect, it, vi } from "vitest";
import type { OfficePrintOutcome, OfficePrintRequest } from "../../print";
import { buildPptxPrintCopy, PPTX_PRINT_MAX_BYTES, PPTX_PRINT_RASTER_WIDTHS, pptxPrintCapability, printPptxDeck } from "./pptx-print-run";
import type { PptxPrintSlide } from "./pptx-print";

const slide: PptxPrintSlide = { markup: '<svg viewBox="0 0 1280 720"><rect width="10" height="10"/></svg>', widthPx: 1280, heightPx: 720 };
/** A slide whose vector copy is big (an embedded picture stand-in). */
const heavy: PptxPrintSlide = { ...slide, markup: `<svg viewBox="0 0 1280 720"><image href="data:image/png;base64,${"A".repeat(4000)}"/></svg>` };

function port(outcome: OfficePrintOutcome = { outcome: "printed" }) {
  return { print: vi.fn<(request: OfficePrintRequest) => Promise<OfficePrintOutcome>>(async () => outcome) };
}

describe("printPptxDeck (UNI-952)", () => {
  it("hands the shared port the vector copy and the title, and returns its outcome unchanged", async () => {
    const target = port({ outcome: "cancelled" });
    const outcome = await printPptxDeck({ port: target, slides: [slide, slide], title: "Deck" });
    expect(outcome).toEqual({ outcome: "cancelled" });
    const request = target.print.mock.calls[0]![0];
    expect(request.title).toBe("Deck");
    expect(request.html.match(/class="page"/g)).toHaveLength(2);
  });

  it("caps the copy at the desktop IPC limit (16 MiB)", () => {
    expect(PPTX_PRINT_MAX_BYTES).toBe(16 * 1024 * 1024);
  });

  it("falls back to rasters at decreasing widths when the vector copy is over the cap", async () => {
    const target = port();
    const rasterize = vi.fn(async (_svg: string, widthPx: number, _heightPx: number) => `data:image/jpeg;base64,${"B".repeat(widthPx === 1600 ? 100 : 6000)}`);
    const outcome = await printPptxDeck({ port: target, slides: [heavy], title: "Deck", rasterize, maxBytes: 3000 });
    expect(outcome).toEqual({ outcome: "printed" });
    expect(rasterize.mock.calls.map(([, width]) => width)).toEqual([2400, 1600]);
    expect(rasterize.mock.calls[0]![0].startsWith("data:image/svg+xml;")).toBe(true);
    // Height follows the slide aspect.
    expect(rasterize.mock.calls[0]![2]).toBe(1350);
    const html = target.print.mock.calls[0]![0].html;
    expect(html).toContain('src="data:image/jpeg;base64,B');
    expect(html).not.toContain("image/svg+xml");
  });

  it("fails with print_too_large past the raster floor, never sending an over-cap copy", async () => {
    const target = port();
    const rasterize = vi.fn(async () => `data:image/jpeg;base64,${"B".repeat(6000)}`);
    const outcome = await printPptxDeck({ port: target, slides: [heavy], title: "Deck", rasterize, maxBytes: 3000 });
    expect(outcome).toEqual({ outcome: "failed", reason: "print_too_large" });
    expect(rasterize).toHaveBeenCalledTimes(PPTX_PRINT_RASTER_WIDTHS.length);
    expect(target.print).not.toHaveBeenCalled();
  });

  it("fails with print_too_large when there is no rasterizer or it cannot draw", async () => {
    expect(await buildPptxPrintCopy({ port: port(), slides: [heavy], title: "D", maxBytes: 3000 })).toEqual({ failed: "print_too_large" });
    const rasterize = vi.fn(async () => null);
    expect(await buildPptxPrintCopy({ port: port(), slides: [heavy], title: "D", maxBytes: 3000, rasterize })).toEqual({ failed: "print_too_large" });
    expect(rasterize).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty run (every slide hidden) instead of printing a blank page", async () => {
    const target = port();
    expect(await printPptxDeck({ port: target, slides: [], title: "Deck" })).toEqual({ outcome: "failed", reason: "print_empty" });
    expect(target.print).not.toHaveBeenCalled();
  });

  it("turns a throwing port into a typed failure", async () => {
    const outcome = await printPptxDeck({ port: { print: () => { throw new Error("bridge down"); } }, slides: [slide], title: "Deck" });
    expect(outcome).toEqual({ outcome: "failed", reason: "bridge down" });
    const odd = await printPptxDeck({ port: { print: () => Promise.reject("nope") }, slides: [slide], title: "Deck" });
    expect(odd).toEqual({ outcome: "failed", reason: "nope" });
  });
});

describe("pptxPrintCapability", () => {
  it("is available with a port and hidden with the given reason without one", () => {
    expect(pptxPrintCapability(port(), "k")).toEqual({ status: "available" });
    expect(pptxPrintCapability(null, "office.pptx.reasons.print_unbound")).toEqual({ status: "unavailable", reason: "office.pptx.reasons.print_unbound", hidden: true });
    expect(pptxPrintCapability(undefined, "k")).toEqual(expect.objectContaining({ hidden: true }));
  });
});
