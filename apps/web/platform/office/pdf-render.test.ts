import { describe, expect, it, vi } from "vitest";
import type { BrowserPdfDocument, BrowserPdfRenderedPage, BrowserPdfium } from "@uniwork/office-engine/browser";
import { createPdfRenderSession, PDFIUM_WASM_URL } from "./pdf-render";

function fakeDoc(label: string, sizes: Array<{ width: number; height: number }>) {
  const sizeOf = (i: number) => sizes[i] ?? { width: 0, height: 0 };
  const doc = {
    pageCount: sizes.length,
    pageSize: vi.fn(sizeOf),
    renderPage: vi.fn((i: number, o: { scale: number }): BrowserPdfRenderedPage => ({
      data: new Uint8ClampedArray(4),
      width: Math.round(sizeOf(i).width * o.scale),
      height: Math.round(sizeOf(i).height * o.scale),
    })),
    pageText: vi.fn((i: number) => `${label} text ${i}`),
    pageCharBoxes: vi.fn((i: number) => [{ x: i, y: i, width: 4, height: 6 }]),
    close: vi.fn(),
  };
  return doc satisfies BrowserPdfDocument;
}

function setup() {
  const docs = [
    fakeDoc("a", [{ width: 100, height: 200 }, { width: 50, height: 60 }]),
    fakeDoc("b", [{ width: 10, height: 20 }]),
  ] as const;
  let opened = 0;
  const openDocument = vi.fn((): BrowserPdfDocument => docs[opened++] ?? docs[1]);
  const pdfium: BrowserPdfium = { openDocument };
  let urls = 0;
  const toImageUrl = vi.fn(async () => `blob:${urls++}`);
  const revokeImageUrl = vi.fn();
  const loadPdfium = vi.fn(async () => pdfium);
  return { docs, openDocument, toImageUrl, revokeImageUrl, deps: { loadPdfium, toImageUrl, revokeImageUrl } };
}

const request = { pageNumber: 1, width: 1, height: 1, scale: 1 };

describe("createPdfRenderSession", () => {
  it("exposes the wasm url", () => {
    expect(PDFIUM_WASM_URL).toBe("/office/pdfium.wasm");
  });

  it("lists pages and text", async () => {
    const s = setup();
    const session = await createPdfRenderSession(new Uint8Array(1), s.deps);
    expect(session.pages()).toEqual([
      { pageNumber: 1, width: 100, height: 200, rotation: 0 },
      { pageNumber: 2, width: 50, height: 60, rotation: 0 },
    ]);
    expect(session.pageText(2)).toBe("a text 1");
    expect(session.pageCharBoxes(2)).toEqual([{ x: 1, y: 1, width: 4, height: 6 }]);
    expect(() => session.pageText(3)).toThrow("pdf_render_page_out_of_range");
    expect(() => session.pageCharBoxes(3)).toThrow("pdf_render_page_out_of_range");
  });

  it("renders at scale times pixel ratio capped at 3 and caches", async () => {
    const s = setup();
    vi.stubGlobal("devicePixelRatio", 5);
    try {
      const session = await createPdfRenderSession(new Uint8Array(1), s.deps);
      const first = await session.renderPage({ ...request, scale: 1.5 });
      const second = await session.renderPage({ ...request, scale: 1.5 });
      expect(first).toEqual({ src: "blob:0", width: 150, height: 300 });
      expect(second.src).toBe("blob:0");
      expect(s.docs[0].renderPage).toHaveBeenCalledTimes(1);
      expect(s.docs[0].renderPage).toHaveBeenCalledWith(0, { scale: 4.5 });
      await session.renderPage({ ...request, scale: 2 });
      expect(s.toImageUrl).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("honours an explicit pixelRatio of 1 on a HiDPI display and keys the cache by it", async () => {
    const s = setup();
    vi.stubGlobal("devicePixelRatio", 3);
    try {
      const session = await createPdfRenderSession(new Uint8Array(1), s.deps);
      await session.renderPage({ ...request, scale: 2, pixelRatio: 1 });
      expect(s.docs[0].renderPage).toHaveBeenLastCalledWith(0, { scale: 2 });
      await session.renderPage({ ...request, scale: 2, pixelRatio: 1 });
      expect(s.docs[0].renderPage).toHaveBeenCalledTimes(1);
      // The on-screen request (no ratio) still renders at display density, in its own entry.
      await session.renderPage({ ...request, scale: 2 });
      expect(s.docs[0].renderPage).toHaveBeenCalledTimes(2);
      expect(s.docs[0].renderPage).toHaveBeenLastCalledWith(0, { scale: 6 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps no uncached render and hands its url back for the caller to release", async () => {
    const s = setup();
    const session = await createPdfRenderSession(new Uint8Array(1), s.deps);
    const printed = await session.renderPage({ ...request, scale: 2, cache: false });
    expect(printed.src).toBe("blob:0");
    expect(s.revokeImageUrl).not.toHaveBeenCalled();
    printed.release?.();
    printed.release?.();
    expect(s.revokeImageUrl).toHaveBeenCalledTimes(1);
    expect(s.revokeImageUrl).toHaveBeenCalledWith("blob:0");
    // Nothing was stored: the same request renders again, and so does a cached one.
    await session.renderPage({ ...request, scale: 2, cache: false });
    const viewed = await session.renderPage({ ...request, scale: 2 });
    expect(viewed.src).toBe("blob:2");
    expect(viewed.release).toBeUndefined();
    expect(s.docs[0].renderPage).toHaveBeenCalledTimes(3);
    // An edit revokes only what the cache holds, never the print urls again.
    await session.replaceBytes(new Uint8Array(2));
    await Promise.resolve();
    expect(s.revokeImageUrl.mock.calls.map(([url]) => url)).toEqual(["blob:0", "blob:2"]);
  });

  it("serves an uncached request from a cached entry without letting it revoke the viewer's url", async () => {
    const s = setup();
    const session = await createPdfRenderSession(new Uint8Array(1), s.deps);
    await session.renderPage({ ...request, pixelRatio: 1 });
    const printed = await session.renderPage({ ...request, pixelRatio: 1, cache: false });
    expect(printed.src).toBe("blob:0");
    expect(printed.release).toBeUndefined();
    expect(s.docs[0].renderPage).toHaveBeenCalledTimes(1);
  });

  it("revokes an uncached render that is aborted before it is returned", async () => {
    const s = setup();
    const controller = new AbortController();
    s.toImageUrl.mockImplementationOnce(async () => {
      controller.abort();
      return "blob:aborted";
    });
    const session = await createPdfRenderSession(new Uint8Array(1), s.deps);
    await expect(session.renderPage({ ...request, cache: false, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(s.revokeImageUrl).toHaveBeenCalledWith("blob:aborted");
  });

  it("keys the cache by device pixel ratio so a density change re-renders", async () => {
    const s = setup();
    vi.stubGlobal("devicePixelRatio", 1);
    try {
      const session = await createPdfRenderSession(new Uint8Array(1), s.deps);
      const first = await session.renderPage(request);
      expect(first.src).toBe("blob:0");
      expect(s.docs[0].renderPage).toHaveBeenCalledTimes(1);
      expect(s.docs[0].renderPage).toHaveBeenCalledWith(0, { scale: 1 });
      // Same page and scale, new display density: the key must differ so the
      // 1x bitmap is not reused on a 2x screen.
      vi.stubGlobal("devicePixelRatio", 2);
      const second = await session.renderPage(request);
      expect(second.src).toBe("blob:1");
      expect(s.docs[0].renderPage).toHaveBeenCalledTimes(2);
      expect(s.docs[0].renderPage).toHaveBeenLastCalledWith(0, { scale: 2 });
      // A third render at the new density still hits the fresh cache entry.
      const third = await session.renderPage(request);
      expect(third.src).toBe("blob:1");
      expect(s.docs[0].renderPage).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lays out each page box from the engine's rotation-applied size", async () => {
    // pdfium already applies /Rotate: a portrait page with /Rotate 90 reports a
    // landscape 200x100. pdf-render must pass that size through unchanged; a
    // swap here would squeeze the pre-rotated raster into the wrong box.
    const doc = fakeDoc("r", [{ width: 200, height: 100 }]);
    const session = await createPdfRenderSession(new Uint8Array(1), {
      loadPdfium: async () => ({ openDocument: vi.fn(() => doc) }) satisfies BrowserPdfium,
      toImageUrl: async () => "blob:0",
      revokeImageUrl: () => undefined,
    });
    expect(session.pages()).toEqual([{ pageNumber: 1, width: 200, height: 100, rotation: 0 }]);
    const result = await session.renderPage(request);
    expect(result).toEqual({ src: "blob:0", width: 200, height: 100 });
  });

  it("rejects an aborted request with AbortError", async () => {
    const s = setup();
    const session = await createPdfRenderSession(new Uint8Array(1), s.deps);
    const controller = new AbortController();
    controller.abort();
    await expect(session.renderPage({ ...request, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(s.docs[0].renderPage).not.toHaveBeenCalled();
  });

  it("does not cache a failed render", async () => {
    const s = setup();
    s.toImageUrl.mockRejectedValueOnce(new Error("encode"));
    const session = await createPdfRenderSession(new Uint8Array(1), s.deps);
    await expect(session.renderPage(request)).rejects.toThrow("encode");
    await expect(session.renderPage(request)).resolves.toMatchObject({ src: "blob:0" });
  });

  it("replaceBytes swaps the document and revokes cached urls", async () => {
    const s = setup();
    const session = await createPdfRenderSession(new Uint8Array(1), s.deps);
    await session.renderPage(request);
    await session.replaceBytes(new Uint8Array(2));
    await Promise.resolve();
    expect(s.revokeImageUrl).toHaveBeenCalledWith("blob:0");
    expect(s.docs[0].close).toHaveBeenCalledTimes(1);
    expect(session.pages()).toHaveLength(1);
    const next = await session.renderPage(request);
    expect(next.src).toBe("blob:1");
  });

  it("keeps the current document when the replacement fails to open", async () => {
    const s = setup();
    const session = await createPdfRenderSession(new Uint8Array(1), s.deps);
    s.openDocument.mockImplementationOnce(() => {
      throw new Error("bad pdf");
    });
    await expect(session.replaceBytes(new Uint8Array(2))).rejects.toThrow("bad pdf");
    expect(session.pages()).toHaveLength(2);
    expect(s.docs[0].close).not.toHaveBeenCalled();
  });

  it("forwards the password to pdfium so a protected document opens", async () => {
    const s = setup();
    const session = await createPdfRenderSession(new Uint8Array(1), { ...s.deps, password: "s3cret" });
    expect(s.openDocument).toHaveBeenCalledWith(expect.any(Uint8Array), "s3cret");
    expect(session.pages()).toHaveLength(2);
  });

  it("opens without a password when none is given, leaving the class to pdfium", async () => {
    const s = setup();
    await createPdfRenderSession(new Uint8Array(1), s.deps);
    expect(s.openDocument).toHaveBeenCalledWith(expect.any(Uint8Array), undefined);
  });

  it("reopens a replacement document with the same password", async () => {
    const s = setup();
    const session = await createPdfRenderSession(new Uint8Array(1), { ...s.deps, password: "s3cret" });
    await session.replaceBytes(new Uint8Array(2));
    expect(s.openDocument).toHaveBeenLastCalledWith(expect.any(Uint8Array), "s3cret");
  });

  it("dispose closes the document, revokes urls and rejects later renders", async () => {
    const s = setup();
    const session = await createPdfRenderSession(new Uint8Array(1), s.deps);
    await session.renderPage({ ...request, pageNumber: 2 });
    session.dispose();
    session.dispose();
    await Promise.resolve();
    expect(s.docs[0].close).toHaveBeenCalledTimes(1);
    expect(s.revokeImageUrl).toHaveBeenCalledWith("blob:0");
    await expect(session.renderPage(request)).rejects.toThrow("pdf_render_disposed");
    await expect(session.replaceBytes(new Uint8Array(1))).rejects.toThrow("pdf_render_disposed");
  });
});
