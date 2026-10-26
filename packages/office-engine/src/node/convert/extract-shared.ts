import { inflateRawSync } from "node:zlib";
import { readCentralDirectory, ZipError, type ZipBoundMode, type ZipCentralEntry } from "../../shared/zip-central.ts";
import { CfbError, readCompoundStreamNames } from "./cfb.ts";

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

const utf8Decoder = new TextDecoder("utf-8");
const utf16leDecoder = new TextDecoder("utf-16le");
const utf16beDecoder = new TextDecoder("utf-16be");

function hasCfbPrefix(bytes: Uint8Array): boolean {
  if (bytes.byteLength < CFB_SIG.length) return false;
  for (let i = 0; i < CFB_SIG.length; i++) {
    if (bytes[i] !== CFB_SIG[i]) return false;
  }
  return true;
}

function classifyCfbContainer(bytes: Uint8Array): never {
  try {
    const names = readCompoundStreamNames(bytes);
    if (names.has("EncryptedPackage") || names.has("EncryptionInfo")) {
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

function decodeXmlBytes(out: Uint8Array): string {
  let decoded: string;
  if (out.byteLength >= 2 && out[0] === 0xff && out[1] === 0xfe) {
    decoded = utf16leDecoder.decode(out.subarray(2));
  } else if (out.byteLength >= 2 && out[0] === 0xfe && out[1] === 0xff) {
    decoded = utf16beDecoder.decode(out.subarray(2));
  } else if (out.byteLength >= 3 && out[0] === 0xef && out[1] === 0xbb && out[2] === 0xbf) {
    decoded = utf8Decoder.decode(out.subarray(3));
  } else if (out.byteLength >= 2 && out[0] !== 0 && out[1] === 0) {
    decoded = utf16leDecoder.decode(out);
  } else if (out.byteLength >= 2 && out[0] === 0 && out[1] !== 0) {
    decoded = utf16beDecoder.decode(out);
  } else {
    decoded = utf8Decoder.decode(out);
  }
  return decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
}

export interface SelectiveZip {
  has(name: string): boolean;
  readText(name: string): string | null;
}

export function openSelectiveZip(bytes: Uint8Array, mode: ZipBoundMode = "fixed"): SelectiveZip {
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

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // First pass: detect encryption flags/methods on central or local headers across all entries.
  for (const entry of rawEntries) {
    if ((entry.flags & 0x01) !== 0 || entry.method === 99) {
      throw new ExtractTypedError("password_required", "ZIP encrypted entry");
    }
    const { localOffset } = entry;
    if (localOffset + 30 <= view.byteLength && view.getUint32(localOffset, true) === LOCAL_SIG) {
      const localFlags = view.getUint16(localOffset + 6, true);
      const localMethod = view.getUint16(localOffset + 8, true);
      if ((localFlags & 0x01) !== 0 || localMethod === 99) {
        throw new ExtractTypedError("password_required", `${entry.name} encrypted`);
      }
    }
  }

  // Second pass: verify local header integrity and central/local agreement without inflating media.
  const entries = new Map<string, ZipCentralEntry>();
  for (const entry of rawEntries) {
    const { localOffset, compressed } = entry;
    if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new ExtractTypedError("corrupted", `${entry.name} missing local header`);
    }
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    if (localFlags !== entry.flags || localMethod !== entry.method) {
      throw new ExtractTypedError("corrupted", `${entry.name} central/local header mismatch`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressed > bytes.byteLength) {
      throw new ExtractTypedError("corrupted", `${entry.name} data truncated`);
    }
    const normalized = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    entries.set(normalized, { ...entry, name: normalized });
  }

  return {
    has: (name: string) => entries.has(name),
    readText(name: string): string | null {
      const entry = entries.get(name);
      if (!entry) return null;
      const { method, compressed, uncompressed, localOffset } = entry;
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
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
      } else {
        throw new ExtractTypedError("corrupted", `${name} unsupported compression ${method}`);
      }
      return decodeXmlBytes(out);
    },
  };
}

function safeFromCodePoint(cp: number, fallback: string): string {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return fallback;
  }
  return String.fromCodePoint(cp);
}

const XML_ENTITY_RE = /&(#[xX][0-9a-fA-F]+|#\d+|lt|gt|quot|apos|amp);/g;

export function decodeXml(s: string): string {
  if (!s || !s.includes("&")) return s;
  return s.replace(XML_ENTITY_RE, (m, body: string) => {
    if (body === "lt") return "<";
    if (body === "gt") return ">";
    if (body === "quot") return '"';
    if (body === "apos") return "'";
    if (body === "amp") return "&";
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return safeFromCodePoint(parseInt(body.slice(2), 16), m);
    }
    return safeFromCodePoint(Number(body.slice(1)), m);
  });
}

export function readAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  if (!m) return undefined;
  return decodeXml(m[1] ?? m[2] ?? "");
}

export function resolveZipTarget(basePart: string, target: string): string {
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

export function relsPathFor(partPath: string): string {
  const idx = partPath.lastIndexOf("/");
  return idx < 0 ? `_rels/${partPath}.rels` : `${partPath.slice(0, idx)}/_rels/${partPath.slice(idx + 1)}.rels`;
}

export class TextBudgetBuilder {
  private readonly chunks: string[] = [];
  private codePoints = 0;
  private utf8Bytes = 0;
  truncated = false;
  private readonly maxCodePoints: number;
  private readonly maxUtf8Bytes: number;

  constructor(maxCodePoints = MAX_EXTRACT_CODE_POINTS, maxUtf8Bytes = MAX_EXTRACT_UTF8_BYTES) {
    this.maxCodePoints = maxCodePoints;
    this.maxUtf8Bytes = maxUtf8Bytes;
  }

  appendRepeatChar(asciiChar: string, count: number): boolean {
    if (count <= 0) return !this.truncated;
    if (this.truncated) return false;
    const remCp = this.maxCodePoints - this.codePoints;
    const remBytes = this.maxUtf8Bytes - this.utf8Bytes;
    const allowed = Math.min(remCp, remBytes);
    if (count <= allowed) {
      this.chunks.push(asciiChar.repeat(count));
      this.codePoints += count;
      this.utf8Bytes += count;
      return true;
    }
    if (allowed > 0) {
      this.chunks.push(asciiChar.repeat(allowed));
      this.codePoints += allowed;
      this.utf8Bytes += allowed;
    }
    this.truncated = true;
    return false;
  }

  append(text: string): boolean {
    if (text.length === 0) return !this.truncated;
    if (this.truncated) return false;
    let i = 0;
    while (i < text.length) {
      const cp = text.codePointAt(i)!;
      const cuLen = cp > 0xffff ? 2 : 1;
      const byteLen = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
      if (this.codePoints + 1 > this.maxCodePoints || this.utf8Bytes + byteLen > this.maxUtf8Bytes) {
        if (i > 0) this.chunks.push(text.slice(0, i));
        this.truncated = true;
        return false;
      }
      this.codePoints += 1;
      this.utf8Bytes += byteLen;
      i += cuLen;
    }
    this.chunks.push(text);
    return true;
  }

  finish(): { text: string; truncated: boolean } {
    return { text: this.chunks.join(""), truncated: this.truncated };
  }
}

/** Cut text to at most maxCodePoints Unicode code points AND at most maxUtf8Bytes UTF-8 bytes
 *  (whichever is hit first), never splitting a code point. */
export function truncateExtractedText(
  text: string,
  maxCodePoints = MAX_EXTRACT_CODE_POINTS,
  maxUtf8Bytes = MAX_EXTRACT_UTF8_BYTES,
): { text: string; truncated: boolean } {
  const builder = new TextBudgetBuilder(maxCodePoints, maxUtf8Bytes);
  builder.append(text);
  return builder.finish();
}
