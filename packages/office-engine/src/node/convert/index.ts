import { BiffError, readBiff8Workbook } from "./biff8.ts";
import { CfbError, readCompoundStreams } from "./cfb.ts";
import { writeDocxPackage } from "./docx-write.ts";
import { OdfError, readOdfTextPackage } from "./odt.ts";
import { writeXlsxPackage } from "./xlsx-write.ts";
import { ZipError } from "./zip.ts";

// Q7 conversion engine (G2-07b / UNI-690): legacy/ODF -> OOXML, node-only.
// The converters are deliberately small and honest: they carry the content
// the G0 fixtures declare as the oracle and name every category they do not
// carry in `fidelity.lost`, so a caller can show the change list before the
// user accepts the copy. Conversion never writes the source: it returns bytes
// and the service stages them as a new document.

export type ConvertSourceFormat = "xls" | "odt";
export type ConvertTargetFormat = "xlsx" | "docx";

export interface ConversionContent {
  /** Sheet names the converted workbook carries (xls -> xlsx). */
  readonly sheets?: readonly string[];
  /** Populated cells, "Sheet!A1" -> display text (xls -> xlsx). */
  readonly cells?: Readonly<Record<string, string>>;
  /** Paragraph texts the converted document carries (odt -> docx). */
  readonly paragraphs?: readonly string[];
}

export interface ConversionResult {
  readonly sourceFormat: ConvertSourceFormat;
  readonly targetFormat: ConvertTargetFormat;
  readonly bytes: Uint8Array;
  readonly fidelity: { readonly level: "limited"; readonly lost: readonly string[] };
  /** The change list a caller shows before accepting the copy. */
  readonly content: ConversionContent;
}

export class ConvertTypedError extends Error {
  readonly code: "unsupported_operation" | "engine_result_invalid";
  readonly reason: string;
  constructor(code: "unsupported_operation" | "engine_result_invalid", reason: string) {
    super(`${code}: ${reason}`);
    this.name = "ConvertTypedError";
    this.code = code;
    this.reason = reason;
  }
}

/** Categories neither converter carries; named instead of silently dropped. */
const XLS_LOSSES = [
  "cell_formatting",
  "formulas_are_cached_values",
  "charts_pivot_tables_and_macros",
  "defined_names_and_sheet_view_state",
] as const;

const ODT_LOSSES = [
  "text_styling_and_fonts",
  "lists_numbering_and_page_layout",
  "tables_images_and_embedded_objects",
] as const;

/** .xls (BIFF8) -> .xlsx. The source bytes are never modified. */
export function convertLegacySpreadsheet(bytes: Uint8Array): ConversionResult {
  try {
    const streams = readCompoundStreams(bytes);
    const workbook = streams.get("Workbook") ?? streams.get("Book");
    if (!workbook) throw new CfbError("no Workbook stream");
    const sheets = readBiff8Workbook(workbook);
    const cells: Record<string, string> = {};
    for (const sheet of sheets) {
      for (const [ref, cell] of sheet.cells) cells[`${sheet.name}!${ref}`] = cell.text;
    }
    const result: ConversionResult = {
      sourceFormat: "xls",
      targetFormat: "xlsx",
      bytes: writeXlsxPackage(sheets),
      fidelity: { level: "limited", lost: XLS_LOSSES },
      content: { sheets: sheets.map((sheet) => sheet.name), cells },
    };
    return result;
  } catch (error) {
    throw asConvertError(error, "not_compound_file");
  }
}

/** .odt (ODF text) -> .docx. The source bytes are never modified. */
export function convertOdfText(bytes: Uint8Array): ConversionResult {
  try {
    const paragraphs = readOdfTextPackage(bytes);
    const result: ConversionResult = {
      sourceFormat: "odt",
      targetFormat: "docx",
      bytes: writeDocxPackage(paragraphs),
      fidelity: { level: "limited", lost: ODT_LOSSES },
      content: { paragraphs: paragraphs.map((paragraph) => paragraph.text) },
    };
    return result;
  } catch (error) {
    throw asConvertError(error, "not_odt");
  }
}

/** The (source, target) pairs this converter binds. */
export const BOUND_CONVERSIONS: readonly string[] = ["xls->xlsx", "odt->docx"];

/** One entry point for the service handlers: route a pair or refuse it. */
export function convertDocument(sourceFormat: string, targetFormat: string, bytes: Uint8Array): ConversionResult {
  const pair = `${sourceFormat}->${targetFormat}`;
  switch (pair) {
    case "xls->xlsx":
      return convertLegacySpreadsheet(bytes);
    case "odt->docx":
      return convertOdfText(bytes);
    default:
      throw new ConvertTypedError("unsupported_operation", `convert_not_bound:${pair}`);
  }
}

function asConvertError(error: unknown, fallbackReason: string): ConvertTypedError {
  if (error instanceof ConvertTypedError) return error;
  if (error instanceof CfbError) return new ConvertTypedError("engine_result_invalid", error.reason);
  if (error instanceof BiffError) {
    // A password-protected workbook is a named refusal, not a broken file.
    const code = error.reason === "xls_encrypted" ? "unsupported_operation" : "engine_result_invalid";
    return new ConvertTypedError(code, error.reason);
  }
  if (error instanceof OdfError) return new ConvertTypedError("engine_result_invalid", error.reason);
  if (error instanceof ZipError) return new ConvertTypedError("engine_result_invalid", error.reason);
  if (error instanceof RangeError) return new ConvertTypedError("engine_result_invalid", fallbackReason);
  throw error;
}
