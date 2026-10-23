// Central-directory reader shared by the node converters (readZip) and the
// browser-safe zip-bomb pre-scan. It reads headers only: nothing is inflated
// and no Node API is used, so it runs in the renderer and in the xlsx engine
// process alike.

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;

/** How a package is bounded. "fixed" is the server contract (a flat entry
 *  count and a flat inflated ceiling). "proportional" is for a local file the
 *  host does not size-cap: the ceilings follow the input instead of a constant,
 *  so a large honest package opens while a decompression bomb is still refused. */
export type ZipBoundMode = "fixed" | "proportional";

interface ZipBounds {
  readonly maxEntries: number;
  readonly maxTotal: number;
  /** Inflate-ratio guard, applied to entries above `ratioFloor` inflated bytes. */
  readonly maxRatio: number;
  readonly ratioFloor: number;
}

const FIXED_BOUNDS: ZipBounds = { maxEntries: 4096, maxTotal: 512 << 20, maxRatio: Number.POSITIVE_INFINITY, ratioFloor: 0 };
const PROPORTIONAL_RATIO = 100;
const PROPORTIONAL_FLOOR = 1 << 20;

function boundsFor(mode: ZipBoundMode, inputBytes: number): ZipBounds {
  if (mode === "fixed") return FIXED_BOUNDS;
  return {
    maxEntries: 20000,
    // Total inflated bytes never exceed the ratio times the input (plus a floor
    // for tiny packages), however many entries share it.
    maxTotal: Math.max(PROPORTIONAL_FLOOR * 16, inputBytes * PROPORTIONAL_RATIO),
    maxRatio: PROPORTIONAL_RATIO,
    ratioFloor: PROPORTIONAL_FLOOR,
  };
}

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

const NO_EOCD = "end of central directory not found";

interface ZipCentralEntry {
  readonly name: string;
  readonly method: number;
  readonly compressed: number;
  readonly uncompressed: number;
  readonly localOffset: number;
}

/** Parse and bound the central directory. Throws ZipError("zip_too_large") when
 *  the declared package is over the bounds (entry count, declared total,
 *  inflate ratio, zip64 sentinel) and ZipError("zip_unreadable") when the
 *  directory is missing, outside the input or truncated. */
export function readCentralDirectory(bytes: Uint8Array, mode: ZipBoundMode): ZipCentralEntry[] {
  const bounds = boundsFor(mode, bytes.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) throw new ZipError("zip_unreadable", NO_EOCD);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  // A sentinel count or offset means the real value lives in a zip64 record
  // this reader does not parse, so the package cannot be bounded honestly.
  if (entryCount === ZIP64_SENTINEL_16 || centralOffset === ZIP64_SENTINEL_32) throw new ZipError("zip_too_large", "zip64 package");
  if (entryCount > bounds.maxEntries) throw new ZipError("zip_too_large", `${entryCount} entries`);
  if (centralOffset > eocd) throw new ZipError("zip_unreadable", "central directory lies outside the input");
  const out: ZipCentralEntry[] = [];
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
    const oversized =
      uncompressed === ZIP64_SENTINEL_32 ||
      uncompressed > bounds.maxTotal ||
      (total += uncompressed) > bounds.maxTotal ||
      (uncompressed > bounds.ratioFloor && uncompressed > Math.max(compressed, 1) * bounds.maxRatio);
    if (oversized) throw new ZipError("zip_too_large", `${name} inflates past the bound`);
    out.push({ name, method, compressed, uncompressed, localOffset });
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

/** Zip-bomb pre-scan for a local package the host does not size-cap. Reads the
 *  central directory only and returns the refusal detail, or null when the
 *  declared package is within the proportional bounds. A directory that is
 *  truncated or outside the input is refused too. A package with no end record
 *  at all is not a zip this scan can bound, so it is left to the upstream
 *  parser to name. */
export function scanZipBomb(bytes: Uint8Array): string | null {
  try {
    readCentralDirectory(bytes, "proportional");
    return null;
  } catch (error) {
    if (error instanceof ZipError) return error.message === NO_EOCD ? null : error.message;
    throw error;
  }
}
