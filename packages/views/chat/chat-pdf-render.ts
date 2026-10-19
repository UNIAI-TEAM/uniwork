import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

/** The card's 404 px preview at 2x. */
const RENDER_WIDTH = 808;

/**
 * Reads a PDF's page count and draws the top of its first page, in the
 * browser (UNI-1908 F6: the server never renders an untrusted PDF). Imported
 * lazily, so pdf.js and its worker load only once a PDF card is on screen.
 * pdf.js asks storage for byte ranges where it allows them, so a large PDF
 * need not arrive whole. shortcut: no cMaps / standard-font data / wasm
 * decoders are served, so legacy CJK encodings, unembedded fonts and JPEG 2000
 * images draw approximately; serve pdfjs-dist's cmaps/ and wasm/ when a
 * preview looks wrong.
 */
export async function renderChatPdfFirstPage(url: string): Promise<{ pages: number; src: string }> {
  if (!GlobalWorkerOptions.workerPort) {
    GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), {
      type: "module",
    });
  }
  const task = getDocument({ url, disableAutoFetch: true, disableStream: true, rangeChunkSize: 256 * 1024 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: RENDER_WIDTH / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    // The preview shows the top of the page; a square bounds a very tall one.
    canvas.height = Math.min(Math.ceil(viewport.height), RENDER_WIDTH);
    await page.render({ canvas, viewport }).promise;
    return { pages: doc.numPages, src: canvas.toDataURL("image/jpeg", 0.85) };
  } finally {
    void task.destroy();
  }
}
