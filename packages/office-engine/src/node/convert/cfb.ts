// Compound File Binary (CFB/OLE2) reader for the Q7 BIFF8 converter. It
// implements the container only: header -> DIFAT -> FAT -> directory, regular
// sector streams and the mini-stream for streams under the 4096-byte cutoff.
// No parsing of any file format happens here.

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
const MAX_SECTORS = 1 << 22; // 2 GiB of 512-byte sectors: far past any fixture, bounded work

interface DirectoryEntry {
  readonly name: string;
  readonly type: number;
  readonly start: number;
  readonly size: number;
}

/** Read every named stream of a compound file into memory. */
export function readCompoundStreams(bytes: Uint8Array): Map<string, Uint8Array> {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new CfbError("bad compound file signature");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorSize = 1 << view.getUint16(30, true);
  const miniSectorSize = 1 << view.getUint16(32, true);
  const firstDirSector = view.getUint32(48, true);
  const miniCutoff = view.getUint32(56, true);
  const firstMiniFat = view.getUint32(60, true);
  if (sectorSize < 512 || miniSectorSize < 16) throw new CfbError("implausible sector size");

  const fat = readFat(view, sectorSize);
  const chain = (start: number): number[] => {
    const out: number[] = [];
    let sector = start;
    while (sector < 0xfffffffa && out.length <= MAX_SECTORS) {
      out.push(sector);
      sector = fat[sector] ?? 0xfffffffe;
    }
    return out;
  };
  const sectorBytes = (sector: number): Uint8Array => {
    const at = 512 + sector * sectorSize;
    if (at + sectorSize > bytes.byteLength) throw new CfbError(`sector ${sector} is past the file`);
    return bytes.subarray(at, at + sectorSize);
  };

  const directory = concat(chain(firstDirSector).map(sectorBytes));
  const entries: DirectoryEntry[] = [];
  for (let at = 0; at + 128 <= directory.byteLength; at += 128) {
    const nameLen = dirView(directory, at).getUint16(64, true);
    if (nameLen < 2) continue;
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
    : concat(chain(root.start).map(sectorBytes));
  const miniChain = (start: number): number[] => {
    const out: number[] = [];
    let sector = start;
    while (sector < 0xfffffffa && out.length <= MAX_SECTORS) {
      out.push(sector);
      const next = dirView(miniFat, sector * 4).getUint32(0, true);
      sector = next;
    }
    return out;
  };

  const out = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.type !== 2 || entry.name === "" || entry.size === 0) continue;
    if (entry.size < miniCutoff && miniStream.byteLength > 0) {
      const buf = new Uint8Array(entry.size);
      let at = 0;
      for (const sector of miniChain(entry.start)) {
        const from = sector * miniSectorSize;
        const take = Math.min(miniSectorSize, entry.size - at);
        buf.set(miniStream.subarray(from, from + take), at);
        at += take;
        if (at >= entry.size) break;
      }
      out.set(entry.name, buf);
    } else {
      out.set(entry.name, concat(chain(entry.start).map(sectorBytes)).subarray(0, entry.size));
    }
  }
  return out;
}

function readFat(view: DataView, sectorSize: number): Uint32Array {
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const sector = view.getUint32(76 + i * 4, true);
    if (sector < 0xfffffffa) fatSectors.push(sector);
  }
  let difat = view.getUint32(68, true);
  const difatCount = view.getUint32(72, true);
  const perSector = sectorSize / 4 - 1;
  for (let i = 0; i < difatCount && difat < 0xfffffffa; i++) {
    const at = 512 + difat * sectorSize;
    const dview = new DataView(view.buffer, view.byteOffset + at, sectorSize);
    for (let j = 0; j < perSector; j++) {
      const sector = dview.getUint32(j * 4, true);
      if (sector < 0xfffffffa) fatSectors.push(sector);
    }
    difat = dview.getUint32(perSector * 4, true);
  }
  const fat = new Uint32Array(fatSectors.length * (sectorSize / 4));
  fatSectors.forEach((sector, index) => {
    const at = 512 + sector * sectorSize;
    const sview = new DataView(view.buffer, view.byteOffset + at, sectorSize);
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
