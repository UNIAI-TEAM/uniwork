// Shared parse primitives for the PDF op envelope. Split out of ops.ts so the
// op catalogue and these guards each stay inside the module size rule; ops.ts
// imports them, nothing else does.
import type {
  ExtractPagesInput,
  InsertBlankPageInput,
  InsertPdfPagesInput,
  MergePdfsInput,
  SplitPdfInput,
} from "./types.ts";

export class PdfOpError extends Error {
  readonly opName: string;
  readonly field: string;
  /** The op itself is outside the bound vocabulary (not a malformed argument). */
  readonly unsupported: boolean;
  constructor(opName: string, field: string, message: string, unsupported = false) {
    super(`${opName}.${field}: ${message}`);
    this.name = "PdfOpError";
    this.opName = opName;
    this.field = field;
    this.unsupported = unsupported;
  }
}

export type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Cheap count bounds — the HTTP body cap bounds memory, but each parsed edit
    means a pdfium page pass and a verify row, so a 50k-item batch would burn
    the whole CPU/deadline budget on one job. Fail fast and typed instead. */
const MAX_EDITS = 1000;
const MAX_LIST_ITEMS = 10_000;
const MAX_TEXT_LEN = 1 << 20;
const MAX_IMAGE_B64_LEN = 64 << 20;

export function capEdits(edits: unknown[]): void {
  if (edits.length > MAX_EDITS) throw new PdfOpError("<edits>", "", `at most ${MAX_EDITS} ops per job`);
}

function capList(v: unknown[], op: string, f: string): unknown[] {
  if (v.length > MAX_LIST_ITEMS) throw new PdfOpError(op, f, `at most ${MAX_LIST_ITEMS} items`);
  return v;
}

function capText(s: string, op: string, f: string): string {
  if (s.length > MAX_TEXT_LEN) throw new PdfOpError(op, f, `text exceeds ${MAX_TEXT_LEN} chars`);
  return s;
}

function capImageB64(s: string, op: string, f: string): string {
  if (s.length > MAX_IMAGE_B64_LEN) throw new PdfOpError(op, f, "image data exceeds the bound");
  return s;
}
function capPdfB64(s: string, op: string, f: string): string {
  if (s.length > MAX_IMAGE_B64_LEN) throw new PdfOpError(op, f, "pdf data exceeds the bound");
  return s;
}

function num(v: unknown, op: string, f: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new PdfOpError(op, f, "number required");
  return v;
}
function int(v: unknown, op: string, f: string): number {
  const n = num(v, op, f);
  if (!Number.isSafeInteger(n)) throw new PdfOpError(op, f, "integer required");
  return n;
}
function str(v: unknown, op: string, f: string): string {
  if (typeof v !== "string") throw new PdfOpError(op, f, "string required");
  return v;
}
function bool(v: unknown, op: string, f: string): boolean {
  if (typeof v !== "boolean") throw new PdfOpError(op, f, "boolean required");
  return v;
}
function vec4(v: unknown, op: string, f: string): [number, number, number, number] {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new PdfOpError(op, f, "[x1,y1,x2,y2] number tuple required");
  }
  return [v[0], v[1], v[2], v[3]] as [number, number, number, number];
}
function vec2(v: unknown, op: string, f: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new PdfOpError(op, f, "[x,y] number tuple required");
  }
  return [v[0], v[1]] as [number, number];
}
function rgb255(v: unknown, op: string, f: string): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new PdfOpError(op, f, "[r,g,b] 0-255 tuple required");
  }
  return [v[0], v[1], v[2]] as [number, number, number];
}
function opt<T>(v: unknown, parse: (v: unknown, op: string, f: string) => T, op: string, f: string): T | undefined {
  return v === undefined ? undefined : parse(v, op, f);
}
function attrsOf(item: Dict): Dict {
  const merged: Dict = {};
  if (isDict(item.target)) Object.assign(merged, item.target);
  if (isDict(item.attributes)) Object.assign(merged, item.attributes);
  // Convenience wire fields ride at the top level when the caller put them there.
  for (const k of ["text", "style", "range"]) {
    if (item[k] !== undefined && merged[k] === undefined) merged[k] = item[k];
  }
  return merged;
}

/** Original 0-based page index; -1 means "before the first page". */
function pageIndexOrFront(v: unknown, op: string, f: string): number {
  const n = int(v, op, f);
  if (n < -1) throw new PdfOpError(op, f, "-1 or a non-negative page index required");
  return n;
}

function positiveNumber(v: unknown, op: string, f: string): number {
  const n = num(v, op, f);
  if (n <= 0) throw new PdfOpError(op, f, "positive number required");
  return n;
}

function pageList(v: unknown, op: string, f: string): number[] {
  if (!Array.isArray(v)) throw new PdfOpError(op, f, "array required");
  if (v.length === 0) throw new PdfOpError(op, f, "at least one page required");
  return capList(v, op, f).map((page) => int(page, op, f + "[]"));
}

function positiveInt(v: unknown, op: string, f: string): number {
  const n = int(v, op, f);
  if (n < 1) throw new PdfOpError(op, f, "positive integer required");
  return n;
}

/** Optional name stem; trimmed and capped, empty is treated as absent. */
function optName(v: unknown, op: string, f: string): string | undefined {
  if (v === undefined) return undefined;
  const name = capText(str(v, op, f), op, f).trim();
  return name === "" ? undefined : name;
}

function parseInsertBlankPage(a: Dict, op: string): InsertBlankPageInput {
  const width = opt(a.width, positiveNumber, op, "width");
  const height = opt(a.height, positiveNumber, op, "height");
  if ((width === undefined) !== (height === undefined)) {
    throw new PdfOpError(op, "size", "width and height must be given together");
  }
  return {
    afterPageIndex: pageIndexOrFront(a.afterPageIndex, op, "afterPageIndex"),
    ...(width === undefined || height === undefined ? {} : { width, height }),
  };
}

function parseInsertPdfPages(a: Dict, op: string): InsertPdfPagesInput {
  return {
    afterPageIndex: pageIndexOrFront(a.afterPageIndex, op, "afterPageIndex"),
    pdf: capPdfB64(str(a.pdf, op, "pdf"), op, "pdf"),
    pages: opt(a.pages, pageList, op, "pages"),
  };
}

function parseExtractPages(a: Dict, op: string): ExtractPagesInput {
  return { pages: pageList(a.pages, op, "pages"), name: optName(a.name, op, "name") };
}

function parseMergePdfs(a: Dict, op: string): MergePdfsInput {
  const pdfs = a.pdfs;
  if (!Array.isArray(pdfs) || pdfs.length === 0) throw new PdfOpError(op, "pdfs", "at least one pdf required");
  return {
    pdfs: capList(pdfs, op, "pdfs").map((pdf, i) => capPdfB64(str(pdf, op, `pdfs[${i}]`), op, `pdfs[${i}]`)),
    name: optName(a.name, op, "name"),
  };
}

function parseSplitPdf(a: Dict, op: string): SplitPdfInput {
  return { chunkSize: positiveInt(a.chunkSize, op, "chunkSize"), name: optName(a.name, op, "name") };
}
