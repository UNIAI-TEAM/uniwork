// BIFF8 workbook reader for the Q7 .xls -> .xlsx converter. It reads the
// Workbook stream record by record: BOUNDSHEET names, the SST shared string
// table, and the cell records of each sheet substream (labels, RK/number
// values, booleans, and formula cached values). Formatting, charts, pivot
// tables and macros are outside the reader on purpose - the converter names
// those as losses instead of guessing.

export interface BiffCell {
  readonly text: string;
  readonly number?: number;
}

export interface BiffSheet {
  readonly name: string;
  readonly cells: Map<string, BiffCell>;
}

export class BiffError extends Error {
  /** biff_unreadable, or xls_encrypted for a password-protected workbook. */
  readonly reason: "biff_unreadable" | "xls_encrypted";
  constructor(detail: string, reason: "biff_unreadable" | "xls_encrypted" = "biff_unreadable") {
    super(detail);
    this.name = "BiffError";
    this.reason = reason;
  }
}

interface Record {
  readonly type: number;
  readonly data: Uint8Array;
}

const BOF = 0x0809;
const EOF = 0x000a;
const BOUNDSHEET = 0x0085;
const SST = 0x00fc;
const CONTINUE = 0x003c;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const RK = 0x027e;
const NUMBER = 0x0203;
const MULRK = 0x00bd;
const FORMULA = 0x0006;
const STRING = 0x0207;
const BOOLERR = 0x0205;
const FILEPASS = 0x002f;
const MAX_RECORDS = 500_000;

/** Parse the Workbook stream of a BIFF8 compound file into sheets and cells. */
export function readBiff8Workbook(stream: Uint8Array): BiffSheet[] {
  if (stream.byteLength < 8 || recordType(stream, 0) !== BOF) throw new BiffError("workbook stream does not start with a BOF record");
  const version = readU16(stream, 4);
  if (version !== 0x0600) throw new BiffError(`BIFF version ${version.toString(16)} is not BIFF8`);

  const bounds: { name: string; position: number }[] = [];
  let sst: string[] = [];
  const records: Record[] = [];
  let at = 0;
  let count = 0;
  while (at + 4 <= stream.byteLength && count < MAX_RECORDS) {
    const type = readU16(stream, at);
    const length = readU16(stream, at + 2);
    if (at + 4 + length > stream.byteLength) throw new BiffError("a record runs past the stream");
    // Every record after FILEPASS is encrypted: reading on would turn
    // ciphertext into cell values, so the workbook is refused by name.
    if (type === FILEPASS) throw new BiffError("the workbook is password-protected", "xls_encrypted");
    records.push({ type, data: stream.subarray(at + 4, at + 4 + length) });
    at += 4 + length;
    count++;
    if (type === 0 && length === 0) break; // zero padding after the last EOF
  }

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    if (record.type === BOUNDSHEET) {
      bounds.push(readBoundsheet(record.data));
    } else if (record.type === SST) {
      const parts = [record.data];
      let j = i + 1;
      while (j < records.length && records[j]?.type === CONTINUE) {
        parts.push(records[j]!.data);
        j++;
      }
      sst = readSst(parts);
    }
  }
  if (bounds.length === 0) throw new BiffError("no BOUNDSHEET records in the workbook stream");
  if (bounds.length > 256) throw new BiffError(`${bounds.length} sheets is past the converter's bound`);

  return bounds.map((sheet) => {
    if (sheet.position + 4 > stream.byteLength) throw new BiffError(`sheet ${sheet.name} starts past the stream`);
    if (readU16(stream, sheet.position) !== BOF) throw new BiffError(`sheet ${sheet.name} does not start with a BOF record`);
    return { name: sheet.name, cells: readSheet(stream, sheet.position, sst) };
  });
}

function recordType(stream: Uint8Array, at: number): number {
  return readU16(stream, at);
}

/** Walk one sheet substream (from its BOF to its EOF) and keep the cells. */
function readSheet(stream: Uint8Array, start: number, sst: readonly string[]): Map<string, BiffCell> {
  const cells = new Map<string, BiffCell>();
  let at = start;
  let count = 0;
  while (at + 4 <= stream.byteLength && count < MAX_RECORDS) {
    const type = readU16(stream, at);
    const length = readU16(stream, at + 2);
    if (at + 4 + length > stream.byteLength) break;
    const data = stream.subarray(at + 4, at + 4 + length);
    at += 4 + length;
    count++;
    switch (type) {
      case LABELSST: {
        if (length < 10) break;
        const index = readU32(data, 6);
        const text = sst[index];
        if (text === undefined) throw new BiffError(`SST index ${index} is out of range`);
        put(cells, readU16(data, 0), readU16(data, 2), { text });
        break;
      }
      case LABEL: {
        if (length < 8) break;
        put(cells, readU16(data, 0), readU16(data, 2), { text: readXLUnicodeString(data, 6) });
        break;
      }
      case RK: {
        if (length < 10) break;
        const number = decodeRk(readU32(data, 6));
        put(cells, readU16(data, 0), readU16(data, 2), { text: numberText(number), number });
        break;
      }
      case NUMBER: {
        if (length < 14) break;
        const number = readDouble(data, 6);
        put(cells, readU16(data, 0), readU16(data, 2), { text: numberText(number), number });
        break;
      }
      case MULRK: {
        if (length < 12) break;
        const row = readU16(data, 0);
        const first = readU16(data, 2);
        const n = (length - 6) / 6;
        for (let i = 0; i < n; i++) {
          const number = decodeRk(readU32(data, 4 + i * 6 + 2));
          put(cells, row, first + i, { text: numberText(number), number });
        }
        break;
      }
      case BOOLERR: {
        if (length < 8 || data[7] !== 0) break; // error values are not carried as content
        put(cells, readU16(data, 0), readU16(data, 2), { text: data[6] !== 0 ? "TRUE" : "FALSE" });
        break;
      }
      case FORMULA: {
        if (length < 14) break;
        const row = readU16(data, 0);
        const col = readU16(data, 2);
        if (data[12] === 0xff && data[13] === 0xff) {
          if (data[6] === 1) put(cells, row, col, { text: data[8] !== 0 ? "TRUE" : "FALSE" });
          else if (data[6] === 0) {
            // A string result lives in the STRING record right after the FORMULA.
            const next = readRecord(stream, at);
            if (next && next.type === STRING) put(cells, row, col, { text: readXLUnicodeString(next.data, 0) });
            else put(cells, row, col, { text: "" });
          }
          // kind 2 (error) and 3 (blank) carry no content.
        } else {
          const number = readDouble(data, 6);
          put(cells, row, col, { text: numberText(number), number });
        }
        break;
      }
      default:
        break;
    }
    if (type === EOF) break;
  }
  return cells;
}

function readRecord(stream: Uint8Array, at: number): Record | null {
  if (at + 4 > stream.byteLength) return null;
  const type = readU16(stream, at);
  const length = readU16(stream, at + 2);
  if (at + 4 + length > stream.byteLength) return null;
  return { type, data: stream.subarray(at + 4, at + 4 + length) };
}

function readBoundsheet(data: Uint8Array): { name: string; position: number } {
  if (data.byteLength < 8) throw new BiffError("truncated BOUNDSHEET record");
  const cch = data[6] ?? 0;
  const grbit = data[7] ?? 0;
  const bytes = grbit & 1 ? cch * 2 : cch;
  if (data.byteLength < 8 + bytes) throw new BiffError("BOUNDSHEET name runs past its record");
  const name = grbit & 1
    ? new TextDecoder("utf-16le").decode(data.subarray(8, 8 + bytes))
    : latin1(data.subarray(8, 8 + bytes));
  return { name, position: readU32(data, 0) };
}

/** Read the SST + CONTINUE chain. A CONTINUE that splits character data starts
    with a fresh grbit byte; split headers do not (MS-XLS 2.4.265). */
function readSst(parts: readonly Uint8Array[]): string[] {
  if (parts.length === 0 || parts[0]!.byteLength < 8) throw new BiffError("truncated SST record");
  const total = readU32(parts[0]!, 0);
  const unique = readU32(parts[0]!, 4);
  if (unique > 1_000_000 || total < unique) throw new BiffError(`implausible SST counts ${total}/${unique}`);
  const out: string[] = [];
  let part = 0;
  let at = 8;
  const advance = (): boolean => {
    if (part + 1 >= parts.length) return false;
    part++;
    at = 0;
    return true;
  };
  const byte = (): number => {
    const value = parts[part]![at] ?? 0;
    at++;
    return value;
  };
  const u16 = (): number => {
    let value = byte();
    value |= byte() << 8;
    return value;
  };
  const u32 = (): number => {
    let value = u16();
    value += u16() * 0x10000;
    return value;
  };
  for (let index = 0; index < unique; index++) {
    while (at >= parts[part]!.byteLength && advance()) {
      /* skip empty CONTINUE payloads */
    }
    if (at >= parts[part]!.byteLength) throw new BiffError(`SST ended at string ${index} of ${unique}`);
    const cch = u16();
    const grbit = byte();
    const rich = (grbit & 0x08) !== 0;
    const phonetic = (grbit & 0x04) !== 0;
    const runs = rich ? u16() : 0;
    const extension = phonetic ? u32() : 0;
    let high = (grbit & 0x01) !== 0;
    let text = "";
    let remaining = cch;
    while (remaining > 0) {
      if (at >= parts[part]!.byteLength) {
        if (!advance()) throw new BiffError(`SST string ${index} runs past the chain`);
        if (parts[part]!.byteLength === 0) continue;
        const grbitByte = byte();
        high = (grbitByte & 0x01) !== 0;
        continue;
      }
      const take = Math.min(remaining, Math.floor((parts[part]!.byteLength - at) / (high ? 2 : 1)));
      if (take > 0) {
        const end = at + take * (high ? 2 : 1);
        text += high
          ? new TextDecoder("utf-16le").decode(parts[part]!.subarray(at, end))
          : latin1(parts[part]!.subarray(at, end));
        at = end;
        remaining -= take;
      } else if (!advance()) {
        throw new BiffError(`SST string ${index} runs past the chain`);
      }
    }
    // Rich runs and phonetic data follow the characters, possibly across a
    // CONTINUE boundary; skip them by their declared sizes.
    let skip = runs * 4 + extension;
    while (skip > 0) {
      const available = parts[part]!.byteLength - at;
      if (available >= skip) {
        at += skip;
        skip = 0;
      } else {
        skip -= available;
        if (!advance()) throw new BiffError(`SST string ${index} extras run past the chain`);
      }
    }
    out.push(text);
  }
  return out;
}

function readXLUnicodeString(data: Uint8Array, at: number): string {
  if (at + 3 > data.byteLength) return "";
  const cch = readU16(data, at);
  const grbit = data[at + 2] ?? 0;
  const start = at + 3;
  const bytes = grbit & 1 ? cch * 2 : cch;
  if (start + bytes > data.byteLength) return "";
  return grbit & 1
    ? new TextDecoder("utf-16le").decode(data.subarray(start, start + bytes))
    : latin1(data.subarray(start, start + bytes));
}

function put(cells: Map<string, BiffCell>, row: number, col: number, cell: BiffCell): void {
  if (row < 0 || col < 0 || row > 1_048_575 || col > 16_383) return;
  cells.set(`${columnName(col)}${row + 1}`, cell);
}

export function columnName(col: number): string {
  let name = "";
  for (let c = col; c >= 0; c = Math.floor(c / 26) - 1) name = String.fromCharCode(65 + (c % 26)) + name;
  return name;
}

function decodeRk(rk: number): number {
  let value: number;
  if (rk & 1) {
    value = rk >> 2; // signed 30-bit integer
  } else {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(0, rk & 0xfffffffc);
    value = view.getFloat64(0);
  }
  return rk & 2 ? value / 100 : value;
}

function numberText(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

function latin1(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i < data.byteLength; i++) out += String.fromCharCode(data[i] ?? 0);
  return out;
}

function readU16(data: Uint8Array, at: number): number {
  return (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8);
}

function readU32(data: Uint8Array, at: number): number {
  return ((data[at] ?? 0) | ((data[at + 1] ?? 0) << 8) | ((data[at + 2] ?? 0) << 16)) + (data[at + 3] ?? 0) * 0x1000000;
}

function readDouble(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset + at, 8).getFloat64(0, true);
}
