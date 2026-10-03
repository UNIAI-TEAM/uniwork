import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PptxDeckRenderer } from "./deck-renderer";
import { clearPptxThumbnailCache, pptxThumbnailKey, usePptxThumbnails } from "./use-pptx-thumbnails";

type ThumbnailBuilder = PptxDeckRenderer["buildThumbnail"];

function fakeRenderer(build: ThumbnailBuilder): PptxDeckRenderer {
  return {
    buildThumbnail: build,
    buildSlide: () => null,
    viewport: (fitWidthPx) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx / 2, scale: 1 }),
    slideCount: 3,
    aspect: 0.5,
  };
}

afterEach(() => {
  clearPptxThumbnailCache();
});

describe("usePptxThumbnails", () => {
  it("fills each slide's thumbnail incrementally and keys the cache by slide, revision and width", async () => {
    const url = (index: number, widthPx: number) => `data:image/svg+xml;charset=utf-8,slide-${index}-${widthPx}`;
    const buildThumbnail = vi.fn((index: number, widthPx: number) => url(index, widthPx));
    const { result } = renderHook(() => usePptxThumbnails({ renderer: fakeRenderer(buildThumbnail), slides: [{ id: "s1" }, { id: "s2" }], revision: 4 }));
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get("s1")).toBe(url(0, 160));
    expect(result.current.get("s2")).toBe(url(1, 160));
    expect(buildThumbnail).toHaveBeenCalledTimes(2);
    expect(pptxThumbnailKey("s1", 4, 160)).toBe("s1@4@160");
  });

  it("serves a cached thumbnail without rebuilding, and rebuilds when the revision changes", async () => {
    const buildThumbnail = vi.fn((index: number) => `data:image/svg+xml;charset=utf-8,s${index}`);
    const renderer = fakeRenderer(buildThumbnail);
    const first = renderHook(() => usePptxThumbnails({ renderer, slides: [{ id: "s1" }], revision: 1 }));
    await waitFor(() => expect(first.result.current.size).toBe(1));
    first.unmount();
    const second = renderHook(() => usePptxThumbnails({ renderer, slides: [{ id: "s1" }], revision: 1 }));
    await waitFor(() => expect(second.result.current.size).toBe(1));
    expect(buildThumbnail).toHaveBeenCalledTimes(1);
    second.unmount();
    const third = renderHook(() => usePptxThumbnails({ renderer, slides: [{ id: "s1" }], revision: 2 }));
    await waitFor(() => expect(third.result.current.size).toBe(1));
    expect(buildThumbnail).toHaveBeenCalledTimes(2);
  });

  it("keeps the other slides when one thumbnail cannot be rendered", async () => {
    const buildThumbnail = vi.fn((index: number) => {
      if (index === 0) throw new Error("bad slide");
      return `data:image/svg+xml;charset=utf-8,ok${index}`;
    });
    const { result } = renderHook(() => usePptxThumbnails({ renderer: fakeRenderer(buildThumbnail), slides: [{ id: "s1" }, { id: "s2" }] }));
    await waitFor(() => expect(result.current.get("s2")).toBeDefined());
    expect(result.current.has("s1")).toBe(false);
  });

  it("does no work without a renderer or slides and clears stale entries", async () => {
    const buildThumbnail = vi.fn(() => "data:image/svg+xml;charset=utf-8,x");
    const { result, rerender } = renderHook(
      ({ renderer, slides }: { renderer: PptxDeckRenderer | null; slides: { id: string }[] }) => usePptxThumbnails({ renderer, slides }),
      { initialProps: { renderer: null as PptxDeckRenderer | null, slides: [{ id: "s1" }] } },
    );
    expect(result.current.size).toBe(0);
    rerender({ renderer: fakeRenderer(buildThumbnail), slides: [] });
    expect(result.current.size).toBe(0);
    expect(buildThumbnail).not.toHaveBeenCalled();
  });
});
