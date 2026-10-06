import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PptxRendererModule } from "./canvas/renderer-module";
import { slide } from "./canvas/pptx-render-fixtures";
import { usePptxEditorRender, type PptxEditorRenderInput } from "./use-pptx-editor-render";

const { buildSlideSvg } = vi.hoisted(() => ({ buildSlideSvg: vi.fn() }));
vi.mock("./canvas/build-slide-svg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./canvas/build-slide-svg")>();
  buildSlideSvg.mockImplementation(actual.buildSlideSvg);
  return { ...actual, buildSlideSvg };
});

const module: PptxRendererModule = {
  makeViewport: (size, fitWidthPx) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
  buildRenderSlide: () => slide([]),
};
const loadRendererModule = async () => module;
const deckAt = (revision: number, imageSize: () => undefined) => ({ deck: { slides: [{ id: "s1" }], size: { cx: 12192000, cy: 6858000 } }, revision, imageSize });

describe("usePptxEditorRender (UNI-927 W9)", () => {
  it("builds the SVG with the resolver of the render that bumped the revision (W5 review F6)", async () => {
    const first = () => undefined;
    const swapped = () => undefined;
    const input = (deck: PptxEditorRenderInput["deck"]): PptxEditorRenderInput => ({ deck, loadRendererModule, idPrefix: "t", selectedIndex: 0, fitWidthPx: 960, presenterOpen: false });
    const { result, rerender } = renderHook((props: PptxEditorRenderInput) => usePptxEditorRender(props), { initialProps: input(deckAt(1, first)) });
    await waitFor(() => expect(result.current.svgBuild.document).not.toBeNull());
    expect(buildSlideSvg.mock.lastCall?.[1]).toMatchObject({ imageSize: first });
    rerender(input(deckAt(2, swapped)));
    await waitFor(() => expect(buildSlideSvg.mock.lastCall?.[1]).toMatchObject({ imageSize: swapped }));
  });
});
