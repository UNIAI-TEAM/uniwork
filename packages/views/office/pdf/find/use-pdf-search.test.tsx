import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePdfSearch } from "./use-pdf-search";
import type { PdfTextDocument } from "./types";

const document: PdfTextDocument = {
  pageCount: 2,
  info: {},
  truncated: false,
  pages: [
    { page: 1, widthPt: 1, heightPt: 1, chars: 3, hasTextLayer: true, text: "one" },
    { page: 2, widthPt: 1, heightPt: 1, chars: 3, hasTextLayer: true, text: "one" },
  ],
};

describe("usePdfSearch", () => {
  it("reads the model once, counts hits, and wraps next/previous", async () => {
    const reader = vi.fn(async () => document);
    const bytes = new Uint8Array([1]);
    const { result } = renderHook(() => usePdfSearch({ bytes, reader }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.setQuery("one"));
    expect(result.current.hits).toHaveLength(2);
    expect(result.current.activeHit?.page).toBe(1);
    act(() => { result.current.next(); });
    expect(result.current.activeHit?.page).toBe(2);
    act(() => { result.current.next(); });
    expect(result.current.activeHit?.page).toBe(1);
    act(() => { result.current.previous(); });
    expect(result.current.activeHit?.page).toBe(2);
    expect(reader).toHaveBeenCalledOnce();
  });

  it("ignores a stale reader result after bytes change", async () => {
    let resolveFirst: ((value: PdfTextDocument) => void) | undefined;
    const reader = vi.fn((bytes: Uint8Array) => bytes[0] === 1 ? new Promise<PdfTextDocument>((resolve) => { resolveFirst = resolve; }) : Promise.resolve(document));
    const { result, rerender } = renderHook(({ bytes }) => usePdfSearch({ bytes, reader }), { initialProps: { bytes: new Uint8Array([1]) } });
    rerender({ bytes: new Uint8Array([2]) });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => resolveFirst?.({ ...document, pages: [] }));
    expect(result.current.document?.pages).toHaveLength(2);
  });
});
