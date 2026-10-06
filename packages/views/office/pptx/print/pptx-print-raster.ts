/**
 * Canvas rasterizer for the PPTX print run's over-cap fallback (UNI-952).
 *
 * A slide SVG is loaded as an image (a `data:` image cannot run script or fetch anything) and
 * drawn onto a canvas at the requested print width, then encoded as JPEG on a white page. A
 * host without a 2D canvas, an image that fails to decode, or a tainted canvas answers null,
 * and the run then fails with `print_too_large` rather than printing a degraded copy silently.
 */
import type { PptxSlideRasterizer } from "./pptx-print-run";

/** JPEG quality of a rasterized slide: photographic content dominates an over-cap deck. */
const RASTER_QUALITY = 0.86;

interface CanvasRasterizerSeams {
  document?: Document | null;
  /** Decodes a `data:` URL into a drawable image; defaults to `new Image()`. */
  loadImage?(src: string): Promise<CanvasImageSource | null>;
}

function loadWithImageElement(src: string): Promise<CanvasImageSource | null> {
  if (typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export function createCanvasSlideRasterizer(seams: CanvasRasterizerSeams = {}): PptxSlideRasterizer {
  const resolveDocument = (): Document | null => (seams.document !== undefined ? seams.document : typeof document === "undefined" ? null : document);
  const loadImage = seams.loadImage ?? loadWithImageElement;
  return async (svg, widthPx, heightPx) => {
    const doc = resolveDocument();
    if (!doc) return null;
    const canvas = doc.createElement("canvas");
    canvas.width = Math.max(1, Math.round(widthPx));
    canvas.height = Math.max(1, Math.round(heightPx));
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas.getContext("2d");
    } catch {
      context = null;
    }
    if (!context) return null;
    const image = await loadImage(svg);
    if (!image) return null;
    try {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", RASTER_QUALITY);
    } catch {
      return null;
    }
  };
}
