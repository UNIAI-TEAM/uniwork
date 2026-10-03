// PDF lane (G2-05): the service-side edit pipeline over pdfium + pdf-lib.
// The worker binds two ops — `open` (probePdf) and `edit` (applyPdfEditBytes);
// everything else exports for tests and the replay driver.
export * from "./adapter.ts";
export * from "./ops.ts";
export * from "./types.ts";
export { applyPdfEdits, PdfVerifyError, type AppliedPdfEdit, type PdfEditSkips } from "./serialize.ts";
export { readPdfText, type PdfTextDoc, type PdfPageText, type ReadPdfTextOptions } from "./extract.ts";
export { renderImagePng, renderPageRegionPng, verifyImageEdits } from "./render.ts";
export { validateTextEdits } from "./text.ts";
export { addMarkup } from "./markups.ts";
export { listPageImages } from "./image.ts";
export { decodeImageToBgra, encodeBgraToPng, type DecodedImage } from "./codec.ts";
