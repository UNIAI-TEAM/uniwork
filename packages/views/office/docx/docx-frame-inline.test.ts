import { describe, expect, it, vi } from "vitest";
import { buildPaginationFrame, createDocxPaginationSpec } from "./docx-pagination";

vi.mock("@uniwork/office-upstream/docs-renderer-editor", async (original) => ({
  ...await original<typeof import("@uniwork/office-upstream/docs-renderer-editor")>(),
  // jsdom has no line boxes; emulate a measured second line at the cut.
  lineStartAnchor: (el: HTMLElement) => ({ node: el.firstChild, charOffset: 6 }),
}));

describe("mid-paragraph page boundary", () => {
  it("keeps the line cut without adding block underflow to the next page", () => {
    const parsed = { blocks: [{ type: "paragraph", runs: [{ text: "first second" }] }] };
    const spec = createDocxPaginationSpec(parsed);
    const settings = spec.sections[0]!.settings;
    const capacity = (settings.pageHeight - settings.marginTop - settings.marginBottom) / 15;
    const cut = capacity - 15;
    const paragraph = document.createElement("p");
    paragraph.textContent = "first second";
    const frame = buildPaginationFrame({
      spec, live: spec.sections,
      blocks: [{ el: paragraph, top: 0, height: capacity + 50, docxIndex: 0 }],
      hfHeights: [{ headerPx: 0, footerPx: 0 }],
      // A line ends 15px before the body's capacity, as in the hf fixture.
      slices: [{ start: 0, end: cut, section: 0 }, { start: cut, end: capacity + 50, section: 0 }],
      view: { posAtDOM: () => 7 } as unknown as NonNullable<Parameters<typeof buildPaginationFrame>[0]["view"]>,
    });
    expect(frame.gaps).toHaveLength(1);
    expect(frame.gaps[0]).toMatchObject({ pos: 7, kind: "inline" });
    expect(frame.gaps[0]!.metrics?.marginBottom).toBeCloseTo(settings.marginBottom / 15, 5);
  });
});
