import { inflateRawSync } from "node:zlib";

// Minimal, dependency-free ZIP reader/writer for the Q7 converters
// (G2-07b / UNI-690). The reader parses the central directory (never walks
// local headers blindly) and inflates DEFLATE entries; the writer emits STORE
// entries with a fixed DOS timestamp so a conversion is byte-deterministic.
// Only the engine service and the converter tests import this module: it is
// node-only and never part of a browser entry.

export interface ZipInput {
  readonly path: string;
  readonly data: Uint8Array;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const MAX_ENTRIES = 4096;
const MAX_UNCOMPRESSED = 512 << 20;

/** Refusal reasons are stable strings the caller maps to a typed engine error. */
export type ZipFailure = "zip_unreadable" | "zip_unsupported_method" | "zip_too_large" | "zip_entry_missing";

export class ZipError extends Error {
  readonly reason: ZipFailure;
  constructor(reason: ZipFailure, detail: string) {
    super(detail);
    this.name = "ZipError";
    this.reason = reason;
  }
}

/** Read every entry of a zip into memory. Throws ZipError on anything that is
    not a readable, bounded zip package. */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) throw new ZipError("zip_unreadable", "end of central directory not found");
  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entryCount > MAX_ENTRIES) throw new ZipError("zip_too_large", `${entryCount} entries`);
  const out = new Map<string, Uint8Array>();
  let total = 0;
  let cursor = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== CENTRAL_SIG) {
      throw new ZipError("zip_unreadable", "central directory entry is truncated");
    }
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const uncompressed = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;
    if (uncompressed > MAX_UNCOMPRESSED || (total += uncompressed) > MAX_UNCOMPRESSED) {
      throw new ZipError("zip_too_large", `${name} inflates past the bound`);
    }
    if (name.endsWith("/")) continue; // directory markers carry no bytes
    if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new ZipError("zip_unreadable", `${name} has no local header`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compressed);
    if (raw.byteLength !== compressed) throw new ZipError("zip_unreadable", `${name} data is truncated`);
    if (method === 0) {
      out.set(name, raw.slice());
    } else if (method === 8) {
      try {
        out.set(name, new Uint8Array(inflateRawSync(raw)));
      } catch {
        throw new ZipError("zip_unreadable", `${name} does not inflate`);
      }
    } else {
      throw new ZipError("zip_unsupported_method", `${name} uses compression method ${method}`);
    }
  }
  return out;
}

function findEocd(view: DataView): number {
  const min = 22;
  const max = Math.min(view.byteLength, min + 0xffff);
  for (let i = view.byteLength - min; i >= view.byteLength - max; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

// Fixed DOS date/time (1980-01-01 00:00) so identical input writes identical
// packages; the converters never embed a wall-clock timestamp.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/** Write entries as a STORE zip. Order is the caller's; every path is a
    relative forward-slash name. */
export function writeZip(entries: readonly ZipInput[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.path);
    const crc = crc32(entry.data);
    const size = entry.data.byteLength;
    const local = new Uint8Array(30 + name.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.byteLength, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, entry.data);
    const cen = new Uint8Array(46 + name.byteLength);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.byteLength, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += local.byteLength + size;
  }
  const centralBytes = concat(central);
  if (entries.length > 0xffff || offset > 0xffffffff) throw new ZipError("zip_too_large", "package exceeds the zip32 bounds");
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralBytes.byteLength, true);
  ev.setUint32(16, offset, true);
  return concat([...parts, centralBytes, end]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.byteLength; i++) crc = (crcTable[(crc ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
