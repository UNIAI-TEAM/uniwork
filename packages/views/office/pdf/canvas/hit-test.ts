import type { PdfCanvasBox } from "./types";

/** Return the topmost box containing a page-space point. */
export function hitTestPdfBox(boxes: readonly PdfCanvasBox[], x: number, y: number): PdfCanvasBox | null {
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const box = boxes[index];
    if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) return box;
  }
  return null;
}
