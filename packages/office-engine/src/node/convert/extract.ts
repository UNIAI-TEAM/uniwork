import { inflateRawSync } from "node:zlib";
import { readCentralDirectory, ZipError, type ZipBoundMode, type ZipCentralEntry } from "../../shared/zip-central.ts";
import { CfbError, readCompoundStreams } from "./cfb.ts";

// Selective, dependency-free text extractor for docx, xlsx and pptx (UNI-2185 B11).
// Built on readCentralDirectory + node:zlib inflateRawSync + readCompoundStreams:
// only XML text parts are inflated and embedded media entries are skipped.

export type ExtractTextFormat = "docx" | "xlsx" | "pptx";
export type ExtractFailureReason = "password_required" | "not_office_file" | "corrupted";

export interface ExtractedText {
  readonly text: string;
  readonly truncated: boolean;
  readonly format: ExtractTextFormat;
}

export class ExtractTypedError extends Error {
  readonly code = "engine_result_invalid" as const;
  readonly reason: ExtractFailureReason;
  constructor(reason: ExtractFailureReason, detail?: string) {
    super(`engine_result_invalid: ${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "ExtractTypedError";
    this.reason = reason;
  }
}

export const MAX_EXTRACT_CODE_POINTS = 200_000;
export const MAX_EXTRACT_UTF8_BYTES = 512 * 1024;

const LOCAL_SIG = 0x04034b50;
const CFB_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

function hasCfbPrefix(bytes: Uint8Array): boolean {
  if (bytes.byteLength < CFB_SIG.length) return false;
  for (let i = 0; i < CFB_SIG.length; i++) {
    if (bytes[i] !== CFB_SIG[i]) return false;
  }
  return true;
}

function classifyCfbContainer(bytes: Uint8Array): never {
  try {
    const streams = readCompoundStreams(bytes);
    if (streams.has("EncryptedPackage") || streams.has("EncryptionInfo")) {
      throw new ExtractTypedError("password_required", "OLE2/CFB EncryptedPackage");
    }
    throw new ExtractTypedError("not_office_file", "CFB container");
  } catch (error) {
    if (error instanceof ExtractTypedError) throw error;
    if (error instanceof CfbError) {
      throw new ExtractTypedError("corrupted", error.message);
    }
    throw error;
  }
}
interface SelectiveZip {
  has(name: string): boolean;
  keys(): string[];
  readText(name: string): string | null;
}

function openSelectiveZip(bytes: Uint8Array, mode: ZipBoundMode = "fixed"): SelectiveZip {
  if (hasCfbPrefix(bytes)) {
    classifyCfbContainer(bytes);
  }
  if (bytes.byteLength < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ExtractTypedError("corrupted", "not a ZIP package");
  }
  let rawEntries: ZipCentralEntry[];
  try {
    rawEntries = readCentralDirectory(bytes, mode);
  } catch (error) {
    if (error instanceof ZipError) {
      throw new ExtractTypedError("corrupted", error.message);
    }
    throw error;
  }
  const entries = new Map<string, ZipCentralEntry>();
  for (const entry of rawEntries) {
    if ((entry.flags & 0x01) !== 0 || entry.method === 99) {
      throw new ExtractTypedError("password_required", "ZIP encrypted entry");
    }
    const normalized = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    entries.set(normalized, { ...entry, name: normalized });
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");

  return {
    has: (name: string) => entries.has(name),
    keys: () => [...entries.keys()],
    readText(name: string): string | null {
      const entry = entries.get(name);
      if (!entry) return null;
      const { method, compressed, uncompressed, localOffset } = entry;
      if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== LOCAL_SIG) {
        throw new ExtractTypedError("corrupted", `${name} missing local header`);
      }
      const localFlags = view.getUint16(localOffset + 6, true);
      const localMethod = view.getUint16(localOffset + 8, true);
      if ((localFlags & 0x01) !== 0 || localMethod === 99) {
        throw new ExtractTypedError("password_required", `${name} encrypted`);
      }
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      if (dataStart + compressed > bytes.byteLength) {
        throw new ExtractTypedError("corrupted", `${name} data truncated`);
      }
      const raw = bytes.subarray(dataStart, dataStart + compressed);
      let out: Uint8Array;
      if (method === 0) {
        out = raw;
      } else if (method === 8) {
        try {
          out = new Uint8Array(inflateRawSync(raw, { maxOutputLength: Math.max(uncompressed, 1) }));
        } catch {
          throw new ExtractTypedError("corrupted", `${name} inflate failed`);
        }
      } else if (method === 99) {
        throw new ExtractTypedError("password_required", `${name} WinZip AES encrypted`);
      } else {
        throw new ExtractTypedError("corrupted", `${name} unsupported compression ${method}`);
      }
      return decoder.decode(out);
    },
  };
}

function safeFromCodePoint(cp: number, fallback: string): string {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return fallback;
  }
  return String.fromCodePoint(cp);
}

function decodeXml(s: string): string {
  if (!s || !s.includes("&")) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h: string) => safeFromCodePoint(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d: string) => safeFromCodePoint(Number(d), m))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function decodeXlsxCellText(s: string): string {
  let text = decodeXml(s).replace(/\r\n?/g, "\n");
  if (text.includes("_x")) {
    text = text
      .replace(/_x([0-9A-Fa-f]{4})_/g, (m, h: string) => {
        const code = parseInt(h, 16);
        return code >= 0xd800 && code <= 0xdfff ? m : String.fromCharCode(code);
      })
      .replace(/\r\n?/g, "\n");
  }
  return text;
}

function readAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : undefined;
}

function resolveZipTarget(basePart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const dir = basePart.includes("/") ? basePart.slice(0, basePart.lastIndexOf("/")) : "";
  const segs = dir ? dir.split("/") : [];
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segs.pop();
    else segs.push(part);
  }
  return segs.join("/");
}

function relsPathFor(partPath: string): string {
  const idx = partPath.lastIndexOf("/");
  return idx < 0 ? `_rels/${partPath}.rels` : `${partPath.slice(0, idx)}/_rels/${partPath.slice(idx + 1)}.rels`;
}

function extractDocxParaText(pXml: string): string {
  const parts: string[] = [];
  const tokenRe = /<(?:\w+:)?(t|tab|br|cr)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?\1>)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(pXml)) !== null) {
    const tag = m[1];
    if (tag === "t") parts.push(decodeXml(m[3] ?? ""));
    else if (tag === "tab") parts.push("\t");
    else if (tag === "br" || tag === "cr") parts.push("\n");
  }
  return parts.join("");
}

function extractDocx(zip: SelectiveZip): string {
  let docPath = "word/document.xml";
  if (!zip.has(docPath)) {
    const rels = zip.readText("_rels/.rels");
    if (rels) {
      const m =
        /Relationship[^>]*Type="[^"]*\/officeDocument"[^>]*Target="([^"]+)"/.exec(rels) ??
        /Relationship[^>]*Target="([^"]+)"[^>]*Type="[^"]*\/officeDocument"/.exec(rels);
      if (m?.[1]) docPath = m[1].replace(/^\/+/, "");
    }
  }
  const xml = zip.readText(docPath);
  if (!xml) throw new ExtractTypedError("corrupted", "missing word/document.xml");
  if (!/<(?:\w+:)?body[\s>]/.test(xml)) {
    throw new ExtractTypedError("corrupted", "document.xml has no <w:body>");
  }

  const lines: string[] = [];
  const blockRe = /<(?:\w+:)?(tbl|p)\b[^>]*>[\s\S]*?<\/(?:\w+:)?\1>/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(xml)) !== null) {
    const kind = bm[1];
    const blockXml = bm[0];
    if (kind === "tbl") {
      const trRe = /<(?:\w+:)?tr\b[^>]*>([\s\S]*?)<\/(?:\w+:)?tr>/g;
      let trm: RegExpExecArray | null;
      while ((trm = trRe.exec(blockXml)) !== null) {
        const cells: string[] = [];
        const tcRe = /<(?:\w+:)?tc\b[^>]*>([\s\S]*?)<\/(?:\w+:)?tc>/g;
        let tcm: RegExpExecArray | null;
        while ((tcm = tcRe.exec(trm[1] ?? "")) !== null) {
          const cellParas: string[] = [];
          const pRe = /<(?:\w+:)?p\b[^>]*>([\s\S]*?)<\/(?:\w+:)?p>/g;
          let pm: RegExpExecArray | null;
          while ((pm = pRe.exec(tcm[1] ?? "")) !== null) {
            const t = extractDocxParaText(pm[1] ?? "");
            if (t) cellParas.push(t);
          }
          cells.push(cellParas.join(" "));
        }
        lines.push(cells.join(" | "));
      }
    } else {
      const text = extractDocxParaText(blockXml);
      const styleMatch = /<(?:\w+:)?pStyle\b[^>]*w:val="([^"]+)"/.exec(blockXml);
      const styleId = styleMatch?.[1] ?? "";
      const headingMatch = /^Heading(\d)$/i.exec(styleId);
      if (headingMatch?.[1]) {
        lines.push(`${"#".repeat(Number(headingMatch[1]))} ${text}`);
      } else {
        lines.push(text);
      }
    }
  }
  return lines.join("\n");
}

function colIndexFromRef(ref: string): number {
  let idx = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) idx = idx * 26 + (c - 64);
    else if (c >= 97 && c <= 122) idx = idx * 26 + (c - 96);
    else break;
  }
  return idx - 1;
}

function csvEscape(val: string): string {
  if (val === "") return "";
  if (val.includes(",") || val.includes('"') || val.includes("\n") || val.includes("\r")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function extractXlsxFirstSheetCsv(zip: SelectiveZip): string {
  const workbookXml = zip.readText("xl/workbook.xml");
  if (!workbookXml) throw new ExtractTypedError("corrupted", "missing xl/workbook.xml");

  const sheetMatch = /<(?:\w+:)?sheet\b((?:"[^"]*"|'[^']*'|[^>"'])*?)\/?>/.exec(workbookXml);
  if (!sheetMatch) throw new ExtractTypedError("corrupted", "workbook has no sheets");
  const sheetAttrs = sheetMatch[1] ?? "";
  const rId = readAttr(sheetAttrs, "r:id") ?? readAttr(sheetAttrs, "id") ?? "";

  let sheetPath = "xl/worksheets/sheet1.xml";
  const relsXml = zip.readText("xl/_rels/workbook.xml.rels");
  if (relsXml && rId) {
    const relRe = /<Relationship\b([^>]*?)\/?>/g;
    let rm: RegExpExecArray | null;
    while ((rm = relRe.exec(relsXml)) !== null) {
      const relAttrs = rm[1] ?? "";
      if (readAttr(relAttrs, "Id") === rId) {
        const target = (readAttr(relAttrs, "Target") ?? "").trim();
        if (target) sheetPath = resolveZipTarget("xl/workbook.xml", target);
        break;
      }
    }
  }
  const worksheetXml = zip.readText(sheetPath);
  if (!worksheetXml) throw new ExtractTypedError("corrupted", `missing worksheet ${sheetPath}`);

  const shared: string[] = [];
  const sharedXml = zip.readText("xl/sharedStrings.xml");
  if (sharedXml) {
    const siRe = /<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>/g;
    let sim: RegExpExecArray | null;
    while ((sim = siRe.exec(sharedXml)) !== null) {
      const tRe = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
      let tm: RegExpExecArray | null;
      const parts: string[] = [];
      while ((tm = tRe.exec(sim[1] ?? "")) !== null) {
        parts.push(decodeXlsxCellText(tm[1] ?? ""));
      }
      shared.push(parts.join(""));
    }
  }

  const csvRows: string[] = [];
  const rowRe = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(worksheetXml)) !== null) {
    const rowBody = rowMatch[1] ?? "";
    const cells: string[] = [];
    const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rowBody)) !== null) {
      const attrs = cm[1] ?? "";
      const body = cm[2] ?? "";
      if (!body) continue;
      const ref = readAttr(attrs, "r");
      const parsedCol = ref ? colIndexFromRef(ref) : -1;
      const col = parsedCol >= 0 ? parsedCol : cells.length;
      const type = readAttr(attrs, "t") ?? "";
      let text = "";
      if (type === "inlineStr") {
        const tRe = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
        let tm: RegExpExecArray | null;
        const parts: string[] = [];
        while ((tm = tRe.exec(body)) !== null) {
          parts.push(decodeXlsxCellText(tm[1] ?? ""));
        }
        text = parts.join("");
      } else {
        const vm = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body);
        const rawVal = vm?.[1];
        if (rawVal !== undefined) {
          if (type === "s") text = shared[Number(rawVal)] ?? "";
          else if (type === "b") text = rawVal.trim() === "1" ? "TRUE" : "FALSE";
          else text = decodeXlsxCellText(rawVal);
        }
      }
      while (cells.length < col) cells.push("");
      cells[col] = csvEscape(text);
    }
    csvRows.push(cells.join(","));
  }
  return csvRows.join("\n");
}

function extractDrawingParas(xml: string): string[] {
  const paras: string[] = [];
  for (const pm of xml.matchAll(/<(?:\w+:)?p\b[^>]*>([\s\S]*?)<\/(?:\w+:)?p>/g)) {
    const pBody = pm[1] ?? "";
    const parts: string[] = [];
    const tokenRe = /<(?:\w+:)?(t|br|tab)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?\1>)/g;
    let tm: RegExpExecArray | null;
    while ((tm = tokenRe.exec(pBody)) !== null) {
      const tag = tm[1];
      if (tag === "t") parts.push(decodeXml(tm[3] ?? ""));
      else if (tag === "br") parts.push("\n");
      else if (tag === "tab") parts.push("\t");
    }
    const line = parts.join("");
    if (line.trim()) paras.push(line);
  }
  return paras;
}

function extractPptxNotes(zip: SelectiveZip, slidePath: string): string {
  const sRelsXml = zip.readText(relsPathFor(slidePath));
  if (!sRelsXml) return "";
  let notesPath: string | null = null;
  for (const m of sRelsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const attrs = m[1] ?? "";
    const type = readAttr(attrs, "Type") ?? "";
    const target = readAttr(attrs, "Target") ?? "";
    if (type.endsWith("/notesSlide") && target) {
      notesPath = resolveZipTarget(slidePath, target.trim());
      break;
    }
  }
  if (!notesPath) return "";
  const notesXml = zip.readText(notesPath);
  if (!notesXml) return "";

  const bodyShapes: string[] = [];
  for (const spm of notesXml.matchAll(/<(?:\w+:)?sp\b[^>]*>[\s\S]*?<\/(?:\w+:)?sp>/g)) {
    if (/<(?:\w+:)?ph\b[^>]*type="body"/.test(spm[0])) {
      bodyShapes.push(...extractDrawingParas(spm[0]));
    }
  }
  if (bodyShapes.length > 0) return bodyShapes.join("\n");
  return extractDrawingParas(notesXml).join("\n");
}

function extractPptx(zip: SelectiveZip): string {
  const presXml = zip.readText("ppt/presentation.xml");
  if (!presXml) throw new ExtractTypedError("corrupted", "missing ppt/presentation.xml");

  const presRelsXml = zip.readText("ppt/_rels/presentation.xml.rels") ?? "";
  const presRels = new Map<string, string>();
  for (const m of presRelsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const attrs = m[1] ?? "";
    const id = readAttr(attrs, "Id");
    const target = readAttr(attrs, "Target");
    if (id && target) presRels.set(id, resolveZipTarget("ppt/presentation.xml", target.trim()));
  }

  const slidePaths: string[] = [];
  for (const m of presXml.matchAll(/<(?:\w+:)?sldId\b([^>]*?)\/?>/g)) {
    const attrs = m[1] ?? "";
    const rId = readAttr(attrs, "r:id") ?? readAttr(attrs, "id");
    const path = rId ? presRels.get(rId) : undefined;
    if (path && zip.has(path)) slidePaths.push(path);
  }
  if (slidePaths.length === 0) {
    const fallback = zip
      .keys()
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => Number(/slide(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/slide(\d+)\.xml$/.exec(b)?.[1] ?? 0));
    slidePaths.push(...fallback);
  }
  if (slidePaths.length === 0) {
    throw new ExtractTypedError("corrupted", "presentation has no slides");
  }

  const sections: string[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const slidePath = slidePaths[i]!;
    const slideXml = zip.readText(slidePath);
    if (!slideXml) throw new ExtractTypedError("corrupted", `missing slide ${slidePath}`);
    const paras = extractDrawingParas(slideXml);
    const notes = extractPptxNotes(zip, slidePath);
    const lines = [`## Slide ${i + 1}`, ...paras];
    if (notes) {
      lines.push("Notes:", notes);
    }
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

/** Cut text to at most maxCodePoints Unicode code points AND at most maxUtf8Bytes UTF-8 bytes
 *  (whichever is hit first), never splitting a code point. */
export function truncateExtractedText(
  text: string,
  maxCodePoints = MAX_EXTRACT_CODE_POINTS,
  maxUtf8Bytes = MAX_EXTRACT_UTF8_BYTES,
): { text: string; truncated: boolean } {
  let codePoints = 0;
  let utf8Bytes = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const cuLen = cp > 0xffff ? 2 : 1;
    // A lone surrogate in JS string encodes as 3 bytes in UTF-8; BMP <=0x7f is 1, <=0x7ff is 2, <=0xffff is 3, supplementary is 4.
    const byteLen = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (codePoints + 1 > maxCodePoints || utf8Bytes + byteLen > maxUtf8Bytes) {
      return { text: text.slice(0, i), truncated: true };
    }
    codePoints += 1;
    utf8Bytes += byteLen;
    i += cuLen;
  }
  return { text, truncated: false };
}

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
  let rawText: string;
  if (format === "docx") {
    rawText = extractDocx(zip);
  } else if (format === "xlsx") {
    rawText = extractXlsxFirstSheetCsv(zip);
  } else {
    rawText = extractPptx(zip);
  }
  const { text, truncated } = truncateExtractedText(rawText);
  return { text, truncated, format };
}
