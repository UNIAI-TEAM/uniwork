import type { DesktopPrintGeometry, DesktopPrintOptions } from "../../../shared/ipc";

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

export const MAX_COPIES = 999;

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

export type DuplexChoice = "simplex" | "longEdge" | "shortEdge";

export interface PrintSettingsInput {
  readonly landscape: boolean;
  readonly pageSize: PageSize;
  readonly deviceName: string;
  readonly copies: number;
  readonly range: RangeResolution;
  readonly color: boolean;
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
    color: input.color,
    duplexMode: input.duplex,
  };
  if (input.range.kind !== "ranges") return options;
  return { ...options, pageRanges: input.range.ranges.map((range) => ({ from: range.from, to: range.to })) };
}

/** What the user has set so far. Free-text fields stay strings until they are
 * parsed, so a half-typed "1-" is an error to show, not a value to lose. */
export interface PrintForm {
  /** The printer the user picked; empty until they do (the default printer stands in). */
  readonly deviceName: string;
  readonly copies: string;
  readonly rangeMode: RangeMode;
  readonly customRange: string;
  readonly landscape: boolean;
  readonly paper: PaperId;
  readonly color: boolean;
  readonly duplex: DuplexChoice;
}

/** The dialog opens on the document's own orientation and paper. */
export function initialPrintForm(geometry: DesktopPrintGeometry): PrintForm {
  return { deviceName: "", copies: "1", rangeMode: "all", customRange: "", landscape: geometry.landscape, paper: "document", color: true, duplex: "simplex" };
}
