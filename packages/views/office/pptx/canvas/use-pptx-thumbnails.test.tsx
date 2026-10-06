import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PptxDeckRenderer } from "./deck-renderer";
import { pptxThumbnailKey, usePptxThumbnails } from "./use-pptx-thumbnails";

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

describe("usePptxThumbnails", () => {
  it("fills each slide's thumbnail incrementally and keys the cache by slide, revision and width", async () => {
    const url = (index: number, widthPx: number) => `data:image/svg+xml;charset=utf-8,slide-${index}-${widthPx}`;
    const buildThumbnail = vi.fn((index: number, widthPx: number) => url(index, widthPx));
    const { result } = renderHook(() => usePptxThumbnails({ renderer: fakeRenderer(buildThumbnail), slides: [{ id: "s1" }, { id: "s2" }], revision: 4 }));
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get("s1")).toBe(url(0, 160));
    expect(result.current.get("s2")).toBe(url(1, 160));
    expect(buildThumbnail).toHaveBeenCalledTimes(2);
    expect(pptxThumbnailKey("s1", 4, 160)).toBe("s1@4@160@light");
  });

  it("serves a cached thumbnail without rebuilding, and rebuilds when the revision changes", async () => {
    const buildThumbnail = vi.fn((index: number) => `data:image/svg+xml;charset=utf-8,s${index}`);
    const renderer = fakeRenderer(buildThumbnail);
    const { result, rerender } = renderHook(({ revision }: { revision: number }) => usePptxThumbnails({ renderer, slides: [{ id: "s1" }], revision }), { initialProps: { revision: 1 } });
    await waitFor(() => expect(result.current.size).toBe(1));
    rerender({ revision: 2 });
    await waitFor(() => expect(buildThumbnail).toHaveBeenCalledTimes(2));
    rerender({ revision: 1 });
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(buildThumbnail).toHaveBeenCalledTimes(2);
  });

  it("keys the cache by theme so a light/dark switch rebuilds the chips", async () => {
    const buildThumbnail = vi.fn((index: number) => `data:image/svg+xml;charset=utf-8,t${index}`);
    const renderer = fakeRenderer(buildThumbnail);
    const { result, rerender } = renderHook(({ theme }: { theme: string }) => usePptxThumbnails({ renderer, slides: [{ id: "s1" }], revision: 1, theme }), { initialProps: { theme: "light" } });
    await waitFor(() => expect(result.current.size).toBe(1));
    rerender({ theme: "dark" });
    await waitFor(() => expect(buildThumbnail).toHaveBeenCalledTimes(2));
  });

  it("does not share thumbnails between two open decks that reuse slide ids (UNI-957)", async () => {
    const deckA = fakeRenderer(vi.fn(() => "data:image/svg+xml;charset=utf-8,deck-A"));
    const deckB = fakeRenderer(vi.fn(() => "data:image/svg+xml;charset=utf-8,deck-B"));
    const a = renderHook(() => usePptxThumbnails({ renderer: deckA, slides: [{ id: "slide1" }], revision: 1 }));
    await waitFor(() => expect(a.result.current.get("slide1")).toContain("deck-A"));
    const b = renderHook(() => usePptxThumbnails({ renderer: deckB, slides: [{ id: "slide1" }], revision: 1 }));
    await waitFor(() => expect(b.result.current.get("slide1")).toContain("deck-B"));
    expect(a.result.current.get("slide1")).toContain("deck-A");
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

  it("stays stable when the host re-renders with a fresh renderer and slide array", async () => {
    // The real editor rebuilds the deck renderer from a memo whose deps include the deck prop
    // and passes `slides` inline, so both arrive with a new identity on every parent render.
    // The effect used to key on those identities and publish a fresh Map every run, which
    // rendered again -- an unbounded loop that exhausted the heap and killed the worker. The
    // guard below turns a returning loop into a fast failure instead of an OOM.
    const buildThumbnail = vi.fn((index: number) => `data:image/svg+xml;charset=utf-8,stable${index}`);
    let renders = 0;
    const { result, rerender } = renderHook(
      ({ revision }: { revision: number }) => {
        renders += 1;
        if (renders > 30) throw new Error(`usePptxThumbnails looped (${renders} renders)`);
        return usePptxThumbnails({ renderer: fakeRenderer(buildThumbnail), slides: [{ id: "s1" }, { id: "s2" }], revision });
      },
      { initialProps: { revision: 1 } },
    );
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(buildThumbnail).toHaveBeenCalledTimes(2);
    // Same revision, new renderer/slides identity: the effect must not restart generation.
    rerender({ revision: 1 });
    await Promise.resolve();
    expect(buildThumbnail).toHaveBeenCalledTimes(2);
    // A real revision bump still rebuilds every thumbnail.
    rerender({ revision: 2 });
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(buildThumbnail).toHaveBeenCalledTimes(4);
    expect(renders).toBeLessThan(20);
  });
});