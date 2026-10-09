import type { DesktopPrinter, DesktopPrintGeometry, DesktopPrintOptions } from "../../../shared/ipc";
import type { DesktopPrintSavePdfRequest } from "../../../shared/ipc-print";

/**
 * The pure half of the print dialog (UNI-961): paper sizes, the page-range
 * grammar and the settings -> `DesktopPrintOptions` mapping. No React, no
 * bridge; every rule here is unit-tested on its own.
 */

type PageSize = DesktopPrintGeometry["pageSize"];

/** `document` keeps the paper the document itself asked for. */
export type PaperId = "document" | "a4" | "a3" | "a5" | "letter" | "legal" | "tabloid";

/** Standard sheets in microns, portrait (short side first), the way
 * `webContents.print` takes a sheet; `landscape` turns it. */
const STANDARD_PAPER: Readonly<Record<Exclude<PaperId, "document">, PageSize>> = {
  a4: { width: 210_000, height: 297_000 },
  a3: { width: 297_000, height: 420_000 },
  a5: { width: 148_000, height: 210_000 },
  letter: { width: 215_900, height: 279_400 },
  legal: { width: 215_900, height: 355_600 },
  tabloid: { width: 279_400, height: 431_800 },
};

export const PAPER_IDS: readonly PaperId[] = ["document", "a4", "a3", "a5", "letter", "legal", "tabloid"];

export function paperPageSize(paper: PaperId, document: PageSize): PageSize {
  return paper === "document" ? document : STANDARD_PAPER[paper];
}

/** One 0-based, inclusive page span, the shape `pageRanges` takes on the wire. */
export interface PageRange {
  readonly from: number;
  readonly to: number;
}

/** The wire schema allows 100 spans; a longer list is refused here rather than there. */
const MAX_RANGES = 100;

/**
 * Parse "1-3, 5" (1-based, as the user reads pages) into 0-based inclusive
 * spans. Null when the text is empty, malformed, runs backwards, names page 0
 * or goes past `pageCount`.
 */
export function parsePageRange(text: string, pageCount: number): PageRange[] | null {
  const parts = text.split(",").map((part) => part.trim());
  if (parts.length === 0 || parts.length > MAX_RANGES) return null;
  const ranges: PageRange[] = [];
  for (const part of parts) {
    const match = /^(\d{1,6})(?:\s*-\s*(\d{1,6}))?$/.exec(part);
    if (!match) return null;
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (first < 1 || last < first || last > pageCount) return null;
    ranges.push({ from: first - 1, to: last - 1 });
  }
  return ranges;
}

const MAX_COPIES = 999;

/** A whole number of copies, 1..999; null for anything else (blank, 0, 2.5, 1000). */
export function parseCopies(text: string): number | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const copies = Number(text);
  return copies >= 1 && copies <= MAX_COPIES ? copies : null;
}

export type RangeMode = "all" | "current" | "custom";

/** What the page-range choice resolves to: every page, these spans, or not
 * printable yet. `pending` means the page count is not known (the preview is
 * being laid out), `syntax` / `bounds` carry an error the user can fix. */
export type RangeResolution =
  | { readonly kind: "all" }
  | { readonly kind: "ranges"; readonly ranges: readonly PageRange[] }
  | { readonly kind: "invalid"; readonly reason: "pending" | "syntax" | "bounds" };

export function resolveRange(mode: RangeMode, customText: string, currentPage: number, pageCount: number | null): RangeResolution {
  if (mode === "all") return { kind: "all" };
  if (pageCount === null) return { kind: "invalid", reason: "pending" };
  if (mode === "current") return { kind: "ranges", ranges: [{ from: currentPage, to: currentPage }] };
  const ranges = parsePageRange(customText, pageCount);
  if (ranges) return { kind: "ranges", ranges };
  // Tell a typo from a page that does not exist: the user fixes them differently.
  return { kind: "invalid", reason: parsePageRange(customText, Number.MAX_SAFE_INTEGER) ? "bounds" : "syntax" };
}

/** `default` leaves the setting to the printer's own driver defaults: the key is
 * not sent, so a user who touches neither gets what the printer would do. */
export type ColorChoice = "default" | "color" | "mono";
export type DuplexChoice = "default" | "simplex" | "longEdge" | "shortEdge";

export interface PrintSettingsInput {
  readonly landscape: boolean;
  readonly pageSize: PageSize;
  readonly deviceName: string;
  readonly copies: number;
  readonly range: RangeResolution;
  readonly color: ColorChoice;
  readonly duplex: DuplexChoice;
}

/** The silent-print options of a settled dialog. `pageRanges` is left out for
 * "all" so main prints the whole document; a pending or invalid range never
 * reaches here (the dialog keeps Print disabled), so it falls back to "all"
 * rather than inventing a span. */
export function buildPrintOptions(input: PrintSettingsInput): DesktopPrintOptions {
  const options: DesktopPrintOptions = {
    landscape: input.landscape,
    pageSize: input.pageSize,
    silent: true,
    deviceName: input.deviceName,
    copies: input.copies,
    // Left out unless the user chose: an explicit value would override a driver default (duplex, mono).
    ...(input.color === "default" ? {} : { color: input.color === "color" }),
    ...(input.duplex === "default" ? {} : { duplexMode: input.duplex }),
  };
  if (input.range.kind !== "ranges") return options;
  return { ...options, pageRanges: input.range.ranges.map((range) => ({ from: range.from, to: range.to })) };
}

/** The "Save as PDF" destination's value in the printer select. A NUL can
 * never be part of a printer name, so it cannot collide with one. */
export const SAVE_PDF_DESTINATION = "\u0000save-pdf";

/** Where the job goes. `system-dialog` is a queue whose port prompts (stock
 * "Microsoft Print to PDF", Fax, XPS): a silent job there fails or hangs, so
 * the system dialog takes the job and decides every setting itself. */
export type Destination =
  | { readonly kind: "save-pdf" }
  | { readonly kind: "system-dialog"; readonly name: string }
  | { readonly kind: "printer"; readonly name: string };

/**
 * The destination for the printer select's `picked` value ("" until the user
 * picks). Untouched, it is the OS default printer; Save as PDF takes its place
 * when there is no printer to default to or the default needs the system
 * dialog, so the dialog never opens on a queue it cannot print to.
 */
export function resolveDestination(picked: string, printers: readonly DesktopPrinter[]): Destination {
  if (picked === SAVE_PDF_DESTINATION) return { kind: "save-pdf" };
  const printer = picked ? printers.find((candidate) => candidate.name === picked) : (printers.find((candidate) => candidate.isDefault) ?? printers[0]);
  if (!printer) return picked ? { kind: "printer", name: picked } : { kind: "save-pdf" };
  if (!printer.needsSystemDialog) return { kind: "printer", name: printer.name };
  // A default that cannot print silently is never chosen for the user; a pick is.
  return picked ? { kind: "system-dialog", name: printer.name } : { kind: "save-pdf" };
}

export interface SavePdfInput {
  readonly landscape: boolean;
  readonly pageSize: PageSize;
  readonly range: RangeResolution;
}

/** The "Save as PDF" options: the sheet and the pages. `pageRanges` is left
 * out for "all" so main writes the whole document. */
export function buildSavePdfOptions(input: SavePdfInput): DesktopPrintSavePdfRequest["options"] {
  const options = { landscape: input.landscape, pageSize: input.pageSize };
  if (input.range.kind !== "ranges") return options;
  return { ...options, pageRanges: input.range.ranges.map((range) => ({ from: range.from, to: range.to })) };
}

/** What the user has set so far. Free-text fields stay strings until they are
 * parsed, so a half-typed "1-" is an error to show, not a value to lose. */
export interface PrintForm {
  /** The destination the user picked (a printer name or `SAVE_PDF_DESTINATION`); empty until they do (`resolveDestination`). */
  readonly deviceName: string;
  readonly copies: string;
  readonly rangeMode: RangeMode;
  readonly customRange: string;
  readonly landscape: boolean;
  readonly paper: PaperId;
  readonly color: ColorChoice;
  readonly duplex: DuplexChoice;
}

/** The dialog opens on the document's own orientation and paper. */
export function initialPrintForm(geometry: DesktopPrintGeometry): PrintForm {
  return { deviceName: "", copies: "1", rangeMode: "all", customRange: "", landscape: geometry.landscape, paper: "document", color: "default", duplex: "default" };
}
