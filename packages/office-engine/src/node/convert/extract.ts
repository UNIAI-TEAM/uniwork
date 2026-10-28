import type { ZipBoundMode } from "../../shared/zip-central.ts";
import { extractDocx } from "./extract-docx.ts";
import { extractPptx } from "./extract-pptx.ts";
import {
  ExtractTypedError,
  MAX_EXTRACT_CODE_POINTS,
  MAX_EXTRACT_UTF8_BYTES,
  openSelectiveZip,
  truncateExtractedText,
  type ExtractedText,
  type ExtractFailureReason,
  type ExtractTextFormat,
} from "./extract-shared.ts";
import { extractXlsxFirstSheetCsv } from "./extract-xlsx.ts";

// Selective, dependency-free text extractor for docx, xlsx and pptx (UNI-2185 B11).
// Built on readCentralDirectory + node:zlib inflateRawSync + readCompoundStreamNames:
// only XML text parts are inflated and embedded media entries are skipped.

export {
  ExtractTypedError,
  MAX_EXTRACT_CODE_POINTS,
  MAX_EXTRACT_UTF8_BYTES,
  truncateExtractedText,
  type ExtractedText,
  type ExtractFailureReason,
  type ExtractTextFormat,
};

/** Selective text extraction for docx, xlsx and pptx. */
export function extractDocumentText(
  format: string,
  bytes: Uint8Array,
  zipBounds: ZipBoundMode = "fixed",
): ExtractedText {
  if (format !== "docx" && format !== "xlsx" && format !== "pptx") {
    throw new ExtractTypedError("not_office_file", `unsupported extract format ${format}`);
  }
  const zip = openSelectiveZip(bytes, zipBounds);
  if (format === "xlsx") {
    const { text, truncated } = extractXlsxFirstSheetCsv(zip);
    return { text, truncated, format };
  }
  const rawText = format === "docx" ? extractDocx(zip) : extractPptx(zip);
  const { text, truncated } = truncateExtractedText(rawText);
  return { text, truncated, format };
}
