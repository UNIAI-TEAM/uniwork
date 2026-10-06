import { describe, expect, it, vi } from "vitest";
import { createCanvasSlideRasterizer } from "./pptx-print-raster";

/** A document whose canvas hands back a recording 2D context. */
function fakeDocument(context: Partial<CanvasRenderingContext2D> | null, toDataURL = vi.fn(() => "data:image/jpeg;base64,OK")) {
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => context), toDataURL };
  const doc = { createElement: vi.fn(() => canvas) } as unknown as Document;
  return { doc, canvas, toDataURL };
}

describe("createCanvasSlideRasterizer", () => {
  it("draws the slide on a white page at the print size and encodes JPEG", async () => {
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    const { doc, canvas, toDataURL } = fakeDocument(context);
    const image = {} as CanvasImageSource;
    const loadImage = vi.fn(async () => image);
    const rasterize = createCanvasSlideRasterizer({ document: doc, loadImage });
    expect(await rasterize("data:image/svg+xml;x", 1600, 900)).toBe("data:image/jpeg;base64,OK");
    expect(loadImage).toHaveBeenCalledWith("data:image/svg+xml;x");
    expect([canvas.width, canvas.height]).toEqual([1600, 900]);
    expect(context.fillStyle).toBe("#ffffff");
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1600, 900);
    expect(context.drawImage).toHaveBeenCalledWith(image, 0, 0, 1600, 900);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", expect.any(Number));
  });

  it("answers null without a document, a 2D context, or a decodable image", async () => {
    expect(await createCanvasSlideRasterizer({ document: null })("s", 10, 10)).toBeNull();
    expect(await createCanvasSlideRasterizer({ document: fakeDocument(null).doc, loadImage: async () => ({}) as CanvasImageSource })("s", 10, 10)).toBeNull();
    const throwing = { createElement: () => ({ getContext: () => { throw new Error("no canvas"); } }) } as unknown as Document;
    expect(await createCanvasSlideRasterizer({ document: throwing })("s", 10, 10)).toBeNull();
    const context = { fillRect: vi.fn(), drawImage: vi.fn() };
    expect(await createCanvasSlideRasterizer({ document: fakeDocument(context).doc, loadImage: async () => null })("s", 10, 10)).toBeNull();
  });

  it("answers null when the canvas is tainted and cannot be encoded", async () => {
    const context = { fillRect: vi.fn(), drawImage: vi.fn() };
    const tainted = vi.fn(() => { throw new Error("SecurityError"); });
    const rasterize = createCanvasSlideRasterizer({ document: fakeDocument(context, tainted).doc, loadImage: async () => ({}) as CanvasImageSource });
    expect(await rasterize("s", 10, 10)).toBeNull();
  });

  it.each([["load", true], ["error", false]] as const)("decodes with an image element by default (%s)", async (event, drawn) => {
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => (event === "load" ? this.onload?.() : this.onerror?.())); }
    }
    vi.stubGlobal("Image", StubImage);
    try {
      const context = { fillRect: vi.fn(), drawImage: vi.fn() };
      const result = await createCanvasSlideRasterizer({ document: fakeDocument(context).doc })("data:image/svg+xml,x", 10, 10);
      expect(result !== null).toBe(drawn);
      expect(context.drawImage).toHaveBeenCalledTimes(drawn ? 1 : 0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
