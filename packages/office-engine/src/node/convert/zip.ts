import { inflateRawSync } from "node:zlib";
import { readCentralDirectory, ZipError, type ZipBoundMode } from "../../shared/zip-central.ts";

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

export { ZipError, type ZipBoundMode };

/** Read every entry of a zip into memory. Throws ZipError on anything that is
    not a readable, bounded zip package. */
export function readZip(bytes: Uint8Array, mode: ZipBoundMode = "fixed"): Map<string, Uint8Array> {
  const entries = readCentralDirectory(bytes, mode);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, Uint8Array>();
  for (const { name, method, compressed, uncompressed, localOffset } of entries) {
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
      let inflated: Uint8Array;
      try {
        // The header's size is only a claim: cap the real output by it so a
        // lying header cannot inflate past the bound just checked.
        inflated = new Uint8Array(inflateRawSync(raw, { maxOutputLength: Math.max(uncompressed, 1) }));
      } catch (error) {
        if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
          throw new ZipError("zip_too_large", `${name} inflates past its declared size`);
        }
        throw new ZipError("zip_unreadable", `${name} does not inflate`);
      }
      out.set(name, inflated);
    } else {
      throw new ZipError("zip_unsupported_method", `${name} uses compression method ${method}`);
    }
  }
  return out;
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
