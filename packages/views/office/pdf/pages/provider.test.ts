import { describe, expect, it, vi } from "vitest";
import { createPdfPageOperationProvider, PdfPageProviderError } from "./provider";
import type { PdfPageRotation } from "./types";

describe("PDF page provider", () => {
  it("maps zero-based displayed positions through pageOrder", async () => {
    const submit = vi.fn();
    const provider = createPdfPageOperationProvider({ pageOrder: [2, 0, 1] }, { submit });

    await provider.rotatePages({ pages: [0, 2], dir: 90 });
    expect(submit).toHaveBeenCalledWith([{ op: "rotatePages", attributes: { pages: [2, 1], dir: 90 } }]);

    await provider.setPageOrder({ order: [1, 0, 2] });
    expect(submit).toHaveBeenLastCalledWith([{ op: "setPageOrder", attributes: { order: [0, 2, 1] } }]);
  });

  it("submits a multi-delete as one batch of original indices", async () => {
    const submit = vi.fn();
    const provider = createPdfPageOperationProvider({ pageOrder: [2, 0, 1] }, { submit });

    await provider.deletePages({ pageIndexes: [0, 1, 2] });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith([
      { op: "deletePage", attributes: { pageIndex: 2 } },
      { op: "deletePage", attributes: { pageIndex: 0 } },
      { op: "deletePage", attributes: { pageIndex: 1 } },
    ]);
  });

  it("falls back to identity mapping when no pageOrder is configured", async () => {
    const submit = vi.fn();
    const provider = createPdfPageOperationProvider({}, { submit });
    await provider.deletePages({ pageIndexes: [2] });
    expect(submit).toHaveBeenCalledWith([{ op: "deletePage", attributes: { pageIndex: 2 } }]);
  });

  it("rejects unsafe positions, empty batches and unknown rotations before submit", async () => {
    const submit = vi.fn();
    const provider = createPdfPageOperationProvider({ pageOrder: [0, 1] }, { submit });

    await expect(provider.deletePages({ pageIndexes: [2] })).rejects.toThrow("outside the current page order");
    await expect(provider.rotatePages({ pages: [-1], dir: 90 })).rejects.toThrow("non-negative integer");
    await expect(provider.setPageOrder({ order: [1.5] })).rejects.toThrow("non-negative integer");
    await expect(provider.deletePages({ pageIndexes: [] })).rejects.toThrow("must not be empty");
    await expect(provider.rotatePages({ pages: [0], dir: 270 as PdfPageRotation })).rejects.toThrow("dir must be");
    expect(submit).not.toHaveBeenCalled();
  });

  it("reports typed provider errors", async () => {
    const submit = vi.fn();
    const provider = createPdfPageOperationProvider({}, { submit });
    await expect(provider.rotatePages({ pages: [], dir: 90 })).rejects.toBeInstanceOf(PdfPageProviderError);
  });
});
