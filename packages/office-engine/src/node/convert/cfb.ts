// Compound File Binary (CFB/OLE2) reader for the Q7 BIFF8 converter. It
// implements the container only: header -> DIFAT -> FAT -> directory, regular
// sector streams and the mini-stream for streams under the 4096-byte cutoff.
// No parsing of any file format happens here.
//
// Every length the file declares is bounded by the file itself before any
// allocation (review BE-R1-01): a chain may only name sectors that exist, may
// not revisit one, and a stream may not be larger than the bytes it can come
// from. A crafted file is a typed refusal, never a multi-gigabyte allocation
// on the shared engine.

export class CfbError extends Error {
  readonly reason = "not_compound_file";
  constructor(detail: string) {
    super(detail);
    this.name = "CfbError";
    this.reason = "not_compound_file";
  }
}

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAXREGSECT = 0xfffffffa;
// MS-CFB fixes these: v3 files use 512-byte sectors, v4 files 4096; mini
// sectors are 64 bytes and the mini-stream cutoff is 4096.
const SECTOR_SHIFTS = new Set([9, 12]);
const MINI_SECTOR_SHIFT = 6;
const MINI_STREAM_CUTOFF = 4096;

interface DirectoryEntry {
  readonly name: string;
  readonly type: number;
  readonly start: number;
  readonly size: number;
}

/** Read every named stream of a compound file into memory. */
export function readCompoundStreams(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.byteLength < 512) throw new CfbError("shorter than a compound file header");
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new CfbError("bad compound file signature");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorShift = view.getUint16(30, true);
  const miniShift = view.getUint16(32, true);
  if (!SECTOR_SHIFTS.has(sectorShift) || miniShift !== MINI_SECTOR_SHIFT) throw new CfbError("implausible sector size");
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniShift;
  const firstDirSector = view.getUint32(48, true);
  if (view.getUint32(56, true) !== MINI_STREAM_CUTOFF) throw new CfbError("implausible mini-stream cutoff");
  const firstMiniFat = view.getUint32(60, true);
  // The sectors that can exist after the header; no chain may be longer.
  const sectorCount = Math.floor((bytes.byteLength - 512) / sectorSize);

  const fat = readFat(view, sectorSize, sectorCount);
  const chain = (start: number): number[] => walk(start, sectorCount, (sector) => fat[sector] ?? ENDOFCHAIN, "FAT");
  const sectorBytes = (sector: number): Uint8Array => {
    const at = 512 + sector * sectorSize;
    return bytes.subarray(at, at + sectorSize);
  };

  const directory = concat(chain(firstDirSector).map(sectorBytes));
  const entries: DirectoryEntry[] = [];
  for (let at = 0; at + 128 <= directory.byteLength; at += 128) {
    const nameLen = dirView(directory, at).getUint16(64, true);
    if (nameLen < 2 || nameLen > 64) continue;
    entries.push({
      name: new TextDecoder("utf-16le").decode(directory.subarray(at, at + nameLen - 2)),
      type: directory[at + 66] ?? 0,
      start: dirView(directory, at).getUint32(116, true),
      size: Number(dirView(directory, at).getBigUint64(120, true)),
    });
  }
  const root = entries.find((e) => e.type === 5);
  if (!root) throw new CfbError("no root directory entry");

  const miniFat = firstMiniFat === ENDOFCHAIN || firstMiniFat === FREESECT
    ? new Uint8Array(0)
    : concat(chain(firstMiniFat).map(sectorBytes));
  const miniStream = root.start === ENDOFCHAIN || root.start === FREESECT
    ? new Uint8Array(0)
    : concat(chain(root.start).map(sectorBytes)).subarray(0, Math.min(root.size, bytes.byteLength));
  const miniCount = Math.min(Math.floor(miniStream.byteLength / miniSectorSize), Math.floor(miniFat.byteLength / 4));
  const miniChain = (start: number): number[] =>
    walk(start, miniCount, (sector) => dirView(miniFat, sector * 4).getUint32(0, true), "mini FAT");

  const out = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.type !== 2 || entry.name === "" || entry.size === 0) continue;
    if (entry.size < MINI_STREAM_CUTOFF && miniStream.byteLength > 0) {
      if (entry.size > miniStream.byteLength) throw new CfbError(`stream ${entry.name} is larger than the mini-stream`);
      const buf = new Uint8Array(entry.size);
      let at = 0;
      for (const sector of miniChain(entry.start)) {
        const from = sector * miniSectorSize;
        const take = Math.min(miniSectorSize, entry.size - at);
        buf.set(miniStream.subarray(from, from + take), at);
        at += take;
        if (at >= entry.size) break;
      }
      if (at < entry.size) throw new CfbError(`stream ${entry.name} is shorter than its declared size`);
      out.set(entry.name, buf);
    } else {
      if (entry.size > bytes.byteLength) throw new CfbError(`stream ${entry.name} is larger than the file`);
      const body = concat(chain(entry.start).map(sectorBytes));
      if (body.byteLength < entry.size) throw new CfbError(`stream ${entry.name} is shorter than its declared size`);
      out.set(entry.name, body.subarray(0, entry.size));
    }
  }
  return out;
}

/** Follow one sector chain: every sector must exist and none may repeat. */
function walk(start: number, count: number, next: (sector: number) => number, table: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  let sector = start;
  while (sector < MAXREGSECT) {
    if (sector >= count) throw new CfbError(`${table} chain names sector ${sector} past the file`);
    if (seen.has(sector)) throw new CfbError(`${table} chain loops at sector ${sector}`);
    seen.add(sector);
    out.push(sector);
    sector = next(sector);
  }
  if (sector !== ENDOFCHAIN) throw new CfbError(`${table} chain ends on a reserved marker`);
  return out;
}

function readFat(view: DataView, sectorSize: number, sectorCount: number): Uint32Array {
  const fatSectors: number[] = [];
  const addFatSector = (sector: number): void => {
    if (sector >= MAXREGSECT) return;
    if (sector >= sectorCount) throw new CfbError(`FAT sector ${sector} is past the file`);
    if (fatSectors.length >= sectorCount) throw new CfbError("more FAT sectors than the file holds");
    fatSectors.push(sector);
  };
  for (let i = 0; i < 109; i++) addFatSector(view.getUint32(76 + i * 4, true));
  let difat = view.getUint32(68, true);
  const difatCount = view.getUint32(72, true);
  if (difatCount > sectorCount) throw new CfbError("more DIFAT sectors than the file holds");
  const perSector = sectorSize / 4 - 1;
  const seen = new Set<number>();
  for (let i = 0; i < difatCount && difat < MAXREGSECT; i++) {
    if (difat >= sectorCount) throw new CfbError(`DIFAT sector ${difat} is past the file`);
    if (seen.has(difat)) throw new CfbError(`DIFAT chain loops at sector ${difat}`);
    seen.add(difat);
    const dview = new DataView(view.buffer, view.byteOffset + 512 + difat * sectorSize, sectorSize);
    for (let j = 0; j < perSector; j++) addFatSector(dview.getUint32(j * 4, true));
    difat = dview.getUint32(perSector * 4, true);
  }
  const fat = new Uint32Array(fatSectors.length * (sectorSize / 4));
  fatSectors.forEach((sector, index) => {
    const sview = new DataView(view.buffer, view.byteOffset + 512 + sector * sectorSize, sectorSize);
    for (let i = 0; i < sectorSize / 4; i++) fat[index * (sectorSize / 4) + i] = sview.getUint32(i * 4, true);
  });
  if (fat.length === 0) throw new CfbError("no FAT sectors");
  return fat;
}

function dirView(bytes: Uint8Array, at: number): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset + at);
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
