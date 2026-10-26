// Direct tests of the legacy .xls readers: BIFF8 records (biff8.ts), the
// compound-file container (cfb.ts) and the error mapping of
// convertLegacySpreadsheet (index.ts). The byte streams are built here, record
// by record, so each branch is reached with a known input.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BiffError, readBiff8Workbook } from "./biff8.ts";
import { CfbError, readCompoundStreams } from "./cfb.ts";
import { ConvertTypedError, convertLegacySpreadsheet } from "./index.ts";

// ── BIFF8 byte builders ────────────────────────────────────────────────────

const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const f64 = (v: number): number[] => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return [...b];
};
const latin = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const utf16 = (s: string): number[] => [...s].flatMap((c) => u16(c.charCodeAt(0)));
const rec = (type: number, body: number[]): number[] => [...u16(type), ...u16(body.length), ...body];

const BOF_GLOBALS = rec(0x0809, [...u16(0x0600), ...u16(5), ...new Array<number>(12).fill(0)]);
const BOF_SHEET = rec(0x0809, [...u16(0x0600), ...u16(0x10), ...new Array<number>(12).fill(0)]);
const EOF = rec(0x000a, []);

function boundsheet(position: number, name: string, wide = false): number[] {
  return rec(0x0085, [...u32(position), 0, 0, name.length, wide ? 1 : 0, ...(wide ? utf16(name) : latin(name))]);
}

/** SST string: cch, grbit, then chars (plus optional rich runs / phonetic). */
function sstString(text: string, opts: { wide?: boolean; runs?: number; phonetic?: number } = {}): number[] {
  const grbit = (opts.wide ? 1 : 0) | (opts.phonetic !== undefined ? 4 : 0) | (opts.runs !== undefined ? 8 : 0);
  return [
    ...u16(text.length),
    grbit,
    ...(opts.runs !== undefined ? u16(opts.runs) : []),
    ...(opts.phonetic !== undefined ? u32(opts.phonetic) : []),
    ...(opts.wide ? utf16(text) : latin(text)),
    ...new Array<number>((opts.runs ?? 0) * 4).fill(0xee),
    ...new Array<number>(opts.phonetic ?? 0).fill(0xdd),
  ];
}

const sstRecord = (unique: number, strings: number[], total = unique): number[] => rec(0x00fc, [...u32(total), ...u32(unique), ...strings]);
const cont = (body: number[]): number[] => rec(0x003c, body);

const labelSst = (row: number, col: number, index: number): number[] => rec(0x00fd, [...u16(row), ...u16(col), ...u16(0), ...u32(index)]);
const numberCell = (row: number, col: number, v: number): number[] => rec(0x0203, [...u16(row), ...u16(col), ...u16(0), ...f64(v)]);
const rkCell = (row: number, col: number, rk: number): number[] => rec(0x027e, [...u16(row), ...u16(col), ...u16(0), ...u32(rk)]);
const labelCell = (row: number, col: number, text: string, wide = false): number[] =>
  rec(0x0204, [...u16(row), ...u16(col), ...u16(0), ...u16(text.length), wide ? 1 : 0, ...(wide ? utf16(text) : latin(text))]);
const boolErr = (row: number, col: number, value: number, isError: number): number[] =>
  rec(0x0205, [...u16(row), ...u16(col), ...u16(0), value, isError]);
const formula = (row: number, col: number, result: number[]): number[] =>
  rec(0x0006, [...u16(row), ...u16(col), ...u16(0), ...result, ...u16(0), ...u32(0)]);
const stringRecord = (text: string): number[] => rec(0x0207, [...u16(text.length), 0, ...latin(text)]);

/** Assemble globals (one boundsheet per sheet, optional SST) and sheet bodies. */
function workbook(sheets: { name: string; wide?: boolean; body: number[] }[], sstRecords: number[] = []): Uint8Array {
  const headSize = (positions: number[]): number[] => [
    ...BOF_GLOBALS,
    ...sheets.flatMap((s, i) => boundsheet(positions[i] ?? 0, s.name, s.wide)),
    ...sstRecords,
    ...EOF,
  ];
  const headLength = headSize(sheets.map(() => 0)).length;
  const positions: number[] = [];
  let at = headLength;
  for (const sheet of sheets) {
    positions.push(at);
    at += BOF_SHEET.length + sheet.body.length + EOF.length;
  }
  return new Uint8Array([...headSize(positions), ...sheets.flatMap((s) => [...BOF_SHEET, ...s.body, ...EOF])]);
}

const cellsOf = (stream: Uint8Array, sheet = 0): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {};
  for (const [ref, cell] of readBiff8Workbook(stream)[sheet]!.cells) out[ref] = cell.text;
  return out;
};

function biffReason(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof BiffError) return error.message;
    throw error;
  }
  throw new Error("expected a BiffError");
}

// ── BIFF8 ──────────────────────────────────────────────────────────────────

describe("readBiff8Workbook cell records", () => {
  it("reads sheet names (compressed and UTF-16) and returns one sheet per BOUNDSHEET", () => {
    const sheets = readBiff8Workbook(workbook([{ name: "Data", body: [] }, { name: "Bảng", wide: true, body: [] }]));
    expect(sheets.map((s) => s.name)).toEqual(["Data", "Bảng"]);
    expect(sheets[0]!.cells.size).toBe(0);
  });

  it("reads NUMBER cells and prints numbers the way the converter writes them", () => {
    const cells = cellsOf(workbook([{ name: "S", body: [...numberCell(0, 0, 3.25), ...numberCell(1, 0, -7), ...numberCell(2, 0, Number.NaN)] }]));
    expect(cells).toEqual({ A1: "3.25", A2: "-7", A3: "" });
  });

  it("decodes the four RK encodings: integer, integer/100, IEEE and IEEE/100", () => {
    const float15 = new DataView(new Uint8Array(f64(1.5)).buffer).getUint32(4, true); // high dword of 1.5
    // MS-XLS 2.5.122 RkNumber: bit 0 = fX100 (divide by 100), bit 1 = fInt (signed 30-bit integer rk >> 2).
    const body = [
      ...rkCell(0, 0, ((5 << 2) | 2) >>> 0),
      ...rkCell(1, 0, ((500 << 2) | 3) >>> 0),
      ...rkCell(2, 0, float15),
      ...rkCell(3, 0, (float15 | 1) >>> 0),
      ...rkCell(4, 0, ((-3 << 2) | 2) >>> 0),
    ];
    expect(cellsOf(workbook([{ name: "S", body }]))).toEqual({ A1: "5", A2: "5", A3: "1.5", A4: "0.015", A5: "-3" });
  });

  it("expands a MULRK record into consecutive columns", () => {
    const mulrk = rec(0x00bd, [...u16(4), ...u16(1), ...u16(0), ...u32((10 << 2) | 2), ...u16(0), ...u32((20 << 2) | 2), ...u16(2)]);
    expect(cellsOf(workbook([{ name: "S", body: mulrk }]))).toEqual({ B5: "10", C5: "20" });
  });

  it("decodes RK cells in real Apache POI Excel workbooks (poi-FormatKM.xls and poi-44010-TwoCharts.xls)", () => {
    const rkFixture = (name: string): Uint8Array =>
      new Uint8Array(readFileSync(new URL(`../../../test/fixtures/biff8-rk/${name}`, import.meta.url)));

    const formatKm = convertLegacySpreadsheet(rkFixture("poi-FormatKM.xls"));
    expect(formatKm.content.cells?.["Sheet1!A2"]).toBe("1.02");
    expect(formatKm.content.cells?.["Sheet1!A6"]).toBe("1021.02");

    const twoCharts = convertLegacySpreadsheet(rkFixture("poi-44010-TwoCharts.xls"));
    expect(twoCharts.content.cells?.["auto_1!D3"]).toBe("46.4");
    expect(twoCharts.content.cells?.["auto_1!E3"]).toBe("0.7");
  });

  it("reads BOOLERR booleans and drops error values", () => {
    const body = [...boolErr(0, 0, 1, 0), ...boolErr(0, 1, 0, 0), ...boolErr(0, 2, 0x2a, 1)];
    expect(cellsOf(workbook([{ name: "S", body }]))).toEqual({ A1: "TRUE", B1: "FALSE" });
  });

  it("reads LABEL cells as compressed and UTF-16 text and ignores an overlong LABEL", () => {
    const overlong = rec(0x0204, [...u16(3), ...u16(0), ...u16(0), ...u16(50), 0, ...latin("ab")]);
    const body = [...labelCell(0, 0, "plain"), ...labelCell(1, 0, "đủ", true), ...overlong];
    expect(cellsOf(workbook([{ name: "S", body }]))).toEqual({ A1: "plain", A2: "đủ", A4: "" });
  });

  it("reads FORMULA cached values: number, boolean, string (STRING record), missing STRING, error and blank", () => {
    const tag = (kind: number, value = 0): number[] => [kind, 0, value, 0, 0, 0, 0xff, 0xff];
    const body = [
      ...formula(0, 0, f64(12.5)),
      ...formula(1, 0, tag(1, 1)),
      ...formula(2, 0, tag(1, 0)),
      ...formula(3, 0, tag(0)),
      ...stringRecord("cached text"),
      ...formula(4, 0, tag(0)), // string result but no STRING record follows
      ...formula(5, 0, tag(2)),
      ...formula(6, 0, tag(3)),
    ];
    expect(cellsOf(workbook([{ name: "S", body }]))).toEqual({
      A1: "12.5",
      A2: "TRUE",
      A3: "FALSE",
      A4: "cached text",
      A5: "",
    });
  });

  it("skips records that are too short to carry a cell, and unknown record types", () => {
    const body = [
      ...rec(0x00fd, [0, 0, 0, 0]),
      ...rec(0x0204, [0, 0, 0, 0]),
      ...rec(0x027e, [0, 0, 0, 0, 0, 0]),
      ...rec(0x0203, [0, 0, 0, 0, 0, 0, 0, 0]),
      ...rec(0x00bd, [0, 0, 0, 0]),
      ...rec(0x0205, [0, 0, 0, 0, 0, 0]),
      ...rec(0x0006, [0, 0, 0, 0, 0, 0, 0, 0]),
      ...rec(0x0201, [0, 0, 0, 0, 0, 0]), // BLANK: not carried
      ...numberCell(0, 0, 1),
    ];
    expect(cellsOf(workbook([{ name: "S", body }]))).toEqual({ A1: "1" });
  });

  it("names columns past Z and ignores cells outside the sheet grid", () => {
    const body = [...numberCell(0, 25, 1), ...numberCell(0, 26, 2), ...numberCell(0, 701, 3), ...numberCell(0, 702, 4), ...numberCell(0, 16384, 5)];
    expect(cellsOf(workbook([{ name: "S", body }]))).toEqual({ Z1: "1", AA1: "2", ZZ1: "3", AAA1: "4" });
  });

  it("refuses a sheet whose last record is cut off by the end of the stream", () => {
    const stream = workbook([{ name: "S", body: [...numberCell(0, 0, 9), ...u16(0x0203), ...u16(14), 1, 2] }]);
    expect(biffReason(() => readBiff8Workbook(stream))).toMatch(/runs past the stream/);
  });
});

describe("readBiff8Workbook shared strings", () => {
  const withSst = (sst: number[], cells: number[]): Uint8Array => workbook([{ name: "S", body: cells }], sst);

  it("reads compressed and UTF-16 strings and resolves LABELSST indexes", () => {
    const stream = withSst(sstRecord(2, [...sstString("alpha"), ...sstString("beta ✓", { wide: true })]), [...labelSst(0, 0, 0), ...labelSst(0, 1, 1)]);
    expect(cellsOf(stream)).toEqual({ A1: "alpha", B1: "beta ✓" });
  });

  it("skips rich-text runs and phonetic data after the characters", () => {
    const stream = withSst(
      sstRecord(2, [...sstString("rich", { runs: 2 }), ...sstString("ph", { phonetic: 6 })]),
      [...labelSst(0, 0, 0), ...labelSst(0, 1, 1)],
    );
    expect(cellsOf(stream)).toEqual({ A1: "rich", B1: "ph" });
  });

  it("joins a string split across CONTINUE records, re-reading the grbit byte after the split", () => {
    // "abcdef": "abc" compressed in the SST record, "def" as UTF-16 in the CONTINUE.
    const head = [...u32(1), ...u32(1), ...u16(6), 0, ...latin("abc")];
    const stream = withSst([...rec(0x00fc, head), ...cont([1, ...utf16("def")])], labelSst(0, 0, 0));
    expect(cellsOf(stream)).toEqual({ A1: "abcdef" });
  });

  it("starts the next string in a CONTINUE record and skips an empty CONTINUE", () => {
    const first = [...u32(2), ...u32(2), ...sstString("one")];
    const stream = withSst([...rec(0x00fc, first), ...cont([]), ...cont(sstString("two"))], [...labelSst(0, 0, 0), ...labelSst(0, 1, 1)]);
    expect(cellsOf(stream)).toEqual({ A1: "one", B1: "two" });
  });

  it("skips rich-run bytes that continue into the next CONTINUE record", () => {
    const first = [...u32(2), ...u32(2), ...u16(2), 8, ...u16(3), ...latin("hi"), 0xee, 0xee]; // 12 bytes of runs, 2 here
    const stream = withSst([...rec(0x00fc, first), ...cont([...new Array<number>(10).fill(0xee), ...sstString("next")])], [...labelSst(0, 0, 0), ...labelSst(0, 1, 1)]);
    expect(cellsOf(stream)).toEqual({ A1: "hi", B1: "next" });
  });

  it("refuses a LABELSST index outside the table", () => {
    expect(biffReason(() => readBiff8Workbook(withSst(sstRecord(1, sstString("x")), labelSst(0, 0, 5))))).toMatch(/SST index 5 is out of range/);
  });

  it("refuses a truncated SST, implausible counts and a table that ends early", () => {
    expect(biffReason(() => readBiff8Workbook(withSst(rec(0x00fc, [0, 0]), [])))).toMatch(/truncated SST/);
    expect(biffReason(() => readBiff8Workbook(withSst(sstRecord(5, [], 2), [])))).toMatch(/implausible SST counts/);
    expect(biffReason(() => readBiff8Workbook(withSst(sstRecord(2_000_000, []), [])))).toMatch(/implausible SST counts/);
    expect(biffReason(() => readBiff8Workbook(withSst(sstRecord(3, sstString("only")), [])))).toMatch(/SST ended at string 1 of 3/);
  });

  it("refuses a string or its extras that run past the last CONTINUE", () => {
    const longString = [...u32(1), ...u32(1), ...u16(40), 0, ...latin("short")];
    expect(biffReason(() => readBiff8Workbook(withSst(rec(0x00fc, longString), [])))).toMatch(/runs past the chain/);
    const longExtras = [...u32(1), ...u32(1), ...u16(1), 8, ...u16(9), ...latin("x")];
    expect(biffReason(() => readBiff8Workbook(withSst(rec(0x00fc, longExtras), [])))).toMatch(/extras run past the chain/);
  });
});

describe("readBiff8Workbook structural refusals", () => {
  it("refuses a stream that is too short, does not start with BOF, or is not BIFF8", () => {
    expect(biffReason(() => readBiff8Workbook(new Uint8Array([1, 2, 3])))).toMatch(/does not start with a BOF/);
    expect(biffReason(() => readBiff8Workbook(new Uint8Array([...EOF, ...EOF])))).toMatch(/does not start with a BOF/);
    const biff5 = new Uint8Array(rec(0x0809, [...u16(0x0500), ...u16(5), 0, 0, 0, 0]));
    expect(biffReason(() => readBiff8Workbook(biff5))).toMatch(/BIFF version 500 is not BIFF8/);
  });

  it("refuses a record that runs past the stream", () => {
    expect(biffReason(() => readBiff8Workbook(new Uint8Array([...BOF_GLOBALS, ...u16(0x0085), ...u16(100), 1, 2])))).toMatch(/runs past the stream/);
  });

  it("refuses a workbook without sheets and one past the 256-sheet bound", () => {
    expect(biffReason(() => readBiff8Workbook(new Uint8Array([...BOF_GLOBALS, ...EOF])))).toMatch(/no BOUNDSHEET/);
    const many = new Uint8Array([...BOF_GLOBALS, ...Array.from({ length: 257 }, () => boundsheet(0, "S")).flat(), ...EOF]);
    expect(biffReason(() => readBiff8Workbook(many))).toMatch(/257 sheets/);
  });

  it("refuses truncated BOUNDSHEET records and sheet positions that do not lead to a BOF", () => {
    expect(biffReason(() => readBiff8Workbook(new Uint8Array([...BOF_GLOBALS, ...rec(0x0085, [1, 2, 3]), ...EOF])))).toMatch(/truncated BOUNDSHEET/);
    expect(biffReason(() => readBiff8Workbook(new Uint8Array([...BOF_GLOBALS, ...rec(0x0085, [...u32(0), 0, 0, 40, 0, 65]), ...EOF])))).toMatch(/name runs past its record/);
    expect(biffReason(() => readBiff8Workbook(new Uint8Array([...BOF_GLOBALS, ...boundsheet(99999, "Far"), ...EOF])))).toMatch(/sheet Far starts past the stream/);
    const notBof = [...BOF_GLOBALS, ...boundsheet(BOF_GLOBALS.length + 11 + 4, "Bad"), ...EOF, ...EOF, ...EOF];
    expect(biffReason(() => readBiff8Workbook(new Uint8Array(notBof)))).toMatch(/does not start with a BOF/);
  });

  it("stops at zero padding after the last record", () => {
    const stream = workbook([{ name: "S", body: numberCell(0, 0, 1) }]);
    expect(cellsOf(new Uint8Array([...stream, 0, 0, 0, 0, 9, 9]))).toEqual({ A1: "1" });
  });

  it("refuses an encrypted workbook with the xls_encrypted reason", () => {
    const stream = new Uint8Array([...BOF_GLOBALS, ...rec(0x002f, [1, 0, 0, 0])]);
    try {
      readBiff8Workbook(stream);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ name: "BiffError", reason: "xls_encrypted" });
    }
  });
});

// ── CFB ────────────────────────────────────────────────────────────────────

const SECTOR = 512;
const MINI = 64;
const FREE = 0xffffffff;
const EOC = 0xfffffffe;

/** A minimal v3 compound file: FAT at 0, directory next, then the mini FAT,
    the mini-stream and regular streams. Streams under 4096 bytes go through
    the mini-stream like real files. */
function buildCfb(streams: { name: string; data: Uint8Array; type?: number }[]): Uint8Array {
  const small = streams.filter((s) => s.data.length > 0 && s.data.length < 4096);
  const big = streams.filter((s) => s.data.length >= 4096);
  const dirSectors = Math.ceil((streams.length + 1) / 4);
  const miniChunks = small.map((s) => Math.ceil(s.data.length / MINI));
  const miniTotal = miniChunks.reduce((a, b) => a + b, 0);
  const miniFatSectors = miniTotal > 0 ? Math.ceil(miniTotal / 128) : 0;
  const miniStreamSectors = Math.ceil((miniTotal * MINI) / SECTOR);
  const bigSectors = big.map((s) => Math.ceil(s.data.length / SECTOR));
  const firstDir = 1;
  const firstMiniFat = firstDir + dirSectors;
  const firstMiniStream = firstMiniFat + miniFatSectors;
  const firstBig = firstMiniStream + miniStreamSectors;
  const total = firstBig + bigSectors.reduce((a, b) => a + b, 0);
  if (total > 128) throw new Error("test cfb builder supports one FAT sector");

  const out = new Uint8Array((total + 1) * SECTOR);
  const view = new DataView(out.buffer);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  view.setUint16(24, 0x3e, true);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, firstDir, true);
  view.setUint32(56, 4096, true);
  view.setUint32(60, miniFatSectors > 0 ? firstMiniFat : EOC, true);
  view.setUint32(64, miniFatSectors, true);
  view.setUint32(68, EOC, true);
  for (let i = 0; i < 109; i++) view.setUint32(76 + i * 4, i === 0 ? 0 : FREE, true);

  const at = (sector: number): number => (sector + 1) * SECTOR;
  const fat = new DataView(out.buffer, at(0), SECTOR);
  for (let i = 0; i < 128; i++) fat.setUint32(i * 4, FREE, true);
  fat.setUint32(0, 0xfffffffd, true);
  const chain = (first: number, count: number): void => {
    for (let k = 0; k < count; k++) fat.setUint32((first + k) * 4, k === count - 1 ? EOC : first + k + 1, true);
  };
  chain(firstDir, dirSectors);
  if (miniFatSectors > 0) chain(firstMiniFat, miniFatSectors);
  if (miniStreamSectors > 0) chain(firstMiniStream, miniStreamSectors);

  const miniFat = new DataView(out.buffer, at(firstMiniFat), Math.max(miniFatSectors, 1) * SECTOR);
  const dirEntry = (index: number, name: string, type: number, start: number, size: number): void => {
    const base = at(firstDir) + index * 128;
    for (let i = 0; i < name.length; i++) view.setUint16(base + i * 2, name.charCodeAt(i), true);
    view.setUint16(base + 64, (name.length + 1) * 2, true);
    out[base + 66] = type;
    view.setUint32(base + 116, start, true);
    view.setBigUint64(base + 120, BigInt(size), true);
  };
  dirEntry(0, "Root Entry", 5, miniStreamSectors > 0 ? firstMiniStream : EOC, miniTotal * MINI);

  let miniCursor = 0;
  let bigCursor = firstBig;
  let smallIndex = 0;
  let bigIndex = 0;
  streams.forEach((stream, index) => {
    const type = stream.type ?? 2;
    if (stream.data.length === 0) {
      dirEntry(index + 1, stream.name, type, EOC, 0);
    } else if (stream.data.length < 4096) {
      const chunks = miniChunks[smallIndex++]!;
      dirEntry(index + 1, stream.name, type, miniCursor, stream.data.length);
      out.set(stream.data, at(firstMiniStream) + miniCursor * MINI);
      for (let k = 0; k < chunks; k++) miniFat.setUint32((miniCursor + k) * 4, k === chunks - 1 ? EOC : miniCursor + k + 1, true);
      miniCursor += chunks;
    } else {
      const sectors = bigSectors[bigIndex++]!;
      dirEntry(index + 1, stream.name, type, bigCursor, stream.data.length);
      out.set(stream.data, at(bigCursor));
      chain(bigCursor, sectors);
      bigCursor += sectors;
    }
  });
  return out;
}

const bytesOf = (n: number, fill: number): Uint8Array => new Uint8Array(n).fill(fill);

function cfbMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof CfbError) {
      expect(error.reason).toBe("not_compound_file");
      return error.message;
    }
    throw error;
  }
  throw new Error("expected a CfbError");
}

describe("readCompoundStreams", () => {
  it("reads mini-stream and regular streams, skipping empty streams and storages", () => {
    const small = Uint8Array.from({ length: 100 }, (_, i) => i);
    const medium = bytesOf(130, 7);
    const large = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);
    const file = buildCfb([
      { name: "Small", data: small },
      { name: "Medium", data: medium },
      { name: "Large", data: large },
      { name: "Empty", data: new Uint8Array(0) },
      { name: "Storage", data: bytesOf(10, 1), type: 1 },
    ]);
    const streams = readCompoundStreams(file);
    expect([...streams.keys()].sort()).toEqual(["Large", "Medium", "Small"]);
    expect(streams.get("Small")).toEqual(small);
    expect(streams.get("Medium")).toEqual(medium);
    expect(streams.get("Large")).toEqual(large);
  });

  it("works with no mini-stream at all", () => {
    const large = bytesOf(4200, 9);
    expect(readCompoundStreams(buildCfb([{ name: "Big", data: large }])).get("Big")).toEqual(large);
  });

  it("refuses a short file and a bad signature", () => {
    expect(cfbMessage(() => readCompoundStreams(new Uint8Array(100)))).toMatch(/shorter than/);
    const file = buildCfb([{ name: "A", data: bytesOf(10, 1) }]);
    file[0] = 0;
    expect(cfbMessage(() => readCompoundStreams(file))).toMatch(/bad compound file signature/);
  });

  it("refuses an implausible mini sector size", () => {
    const file = buildCfb([{ name: "A", data: bytesOf(10, 1) }]);
    new DataView(file.buffer).setUint16(32, 7, true);
    expect(cfbMessage(() => readCompoundStreams(file))).toMatch(/implausible sector size/);
  });

  it("refuses a file without a root entry, skipping directory entries with an impossible name length", () => {
    const file = buildCfb([{ name: "A", data: bytesOf(10, 1) }]);
    const dirAt = 2 * SECTOR; // directory sector 1
    file[dirAt + 66] = 0; // root entry loses its type
    expect(cfbMessage(() => readCompoundStreams(file))).toMatch(/no root directory entry/);
    const second = buildCfb([{ name: "A", data: bytesOf(10, 1) }]);
    new DataView(second.buffer).setUint16(dirAt + 128 + 64, 200, true); // stream entry name length out of range
    expect([...readCompoundStreams(second).keys()]).toEqual([]);
  });

  it("refuses a FAT with no sectors, a FAT sector past the file and more FAT sectors than the file holds", () => {
    const none = buildCfb([{ name: "A", data: bytesOf(10, 1) }]);
    new DataView(none.buffer).setUint32(76, FREE, true);
    expect(cfbMessage(() => readCompoundStreams(none))).toMatch(/no FAT sectors/);

    const past = buildCfb([{ name: "A", data: bytesOf(10, 1) }]);
    new DataView(past.buffer).setUint32(80, 9999, true);
    expect(cfbMessage(() => readCompoundStreams(past))).toMatch(/FAT sector 9999 is past the file/);

    const many = buildCfb([{ name: "A", data: bytesOf(10, 1) }]);
    for (let i = 0; i < 109; i++) new DataView(many.buffer).setUint32(76 + i * 4, 0, true);
    expect(cfbMessage(() => readCompoundStreams(many))).toMatch(/more FAT sectors than the file holds/);
  });

  it("follows DIFAT sectors, and refuses one past the file or one that loops", () => {
    const base = buildCfb([{ name: "A", data: bytesOf(10, 1) }]);
    const sectorCount = base.length / SECTOR - 1;
    const withDifat = (last: number, count: number, startOverride?: number): Uint8Array => {
      const out = new Uint8Array(base.length + SECTOR);
      out.set(base);
      const view = new DataView(out.buffer);
      for (let i = 0; i < 128; i++) view.setUint32(base.length + i * 4, FREE, true);
      view.setUint32(base.length + 127 * 4, last, true);
      view.setUint32(68, startOverride ?? sectorCount, true);
      view.setUint32(72, count, true);
      return out;
    };
    expect(readCompoundStreams(withDifat(EOC, 1)).get("A")).toEqual(bytesOf(10, 1));
    expect(cfbMessage(() => readCompoundStreams(withDifat(EOC, 1, 9999)))).toMatch(/DIFAT sector 9999 is past the file/);
    expect(cfbMessage(() => readCompoundStreams(withDifat(sectorCount, 2)))).toMatch(/DIFAT chain loops/);
  });

  it("refuses chains that end on a reserved marker or name a sector past the file", () => {
    const file = buildCfb([{ name: "Large", data: bytesOf(5000, 1) }]);
    const fatAt = SECTOR; // FAT is sector 0
    const lastBig = (file.length / SECTOR - 1) - 1; // last data sector
    const reserved = file.slice();
    new DataView(reserved.buffer).setUint32(fatAt + lastBig * 4, 0xfffffffb, true);
    expect(cfbMessage(() => readCompoundStreams(reserved))).toMatch(/ends on a reserved marker/);
    const past = file.slice();
    new DataView(past.buffer).setUint32(fatAt + lastBig * 4, 5000, true);
    expect(cfbMessage(() => readCompoundStreams(past))).toMatch(/past the file/);
  });

  it("refuses streams whose declared size lies", () => {
    const dirAt = 2 * SECTOR;
    const sizeAt = (index: number): number => dirAt + index * 128 + 120;
    const hugeBig = buildCfb([{ name: "Large", data: bytesOf(5000, 1) }]);
    new DataView(hugeBig.buffer).setBigUint64(sizeAt(1), 1_000_000n, true);
    expect(cfbMessage(() => readCompoundStreams(hugeBig))).toMatch(/larger than the file/);

    const shortBig = buildCfb([{ name: "Large", data: bytesOf(5000, 1) }]);
    new DataView(shortBig.buffer).setBigUint64(sizeAt(1), 5200n, true); // 10 sectors hold 5120
    expect(cfbMessage(() => readCompoundStreams(shortBig))).toMatch(/shorter than its declared size/);

    const hugeSmall = buildCfb([{ name: "Small", data: bytesOf(100, 1) }]);
    new DataView(hugeSmall.buffer).setBigUint64(sizeAt(1), 4000n, true);
    expect(cfbMessage(() => readCompoundStreams(hugeSmall))).toMatch(/larger than the mini-stream/);

    const shortSmall = buildCfb([{ name: "Small", data: bytesOf(60, 1) }, { name: "Next", data: bytesOf(120, 2) }]);
    new DataView(shortSmall.buffer).setBigUint64(sizeAt(1), 100n, true); // chain is one 64-byte sector
    expect(cfbMessage(() => readCompoundStreams(shortSmall))).toMatch(/shorter than its declared size/);
  });
});

// ── conversion pipeline over a built compound file ─────────────────────────

describe("convertLegacySpreadsheet over a built compound file", () => {
  const sheet = workbook([{ name: "Tổng", wide: true, body: [...numberCell(0, 0, 41.5), ...labelCell(1, 0, "ok")] }]);
  const padded = (data: Uint8Array): Uint8Array => new Uint8Array([...data, ...new Array<number>(Math.max(0, 4200 - data.length)).fill(0)]);

  it("converts a workbook stored under the Workbook name and under the older Book name", () => {
    for (const name of ["Workbook", "Book"]) {
      const result = convertLegacySpreadsheet(buildCfb([{ name, data: padded(sheet) }]));
      expect(result.content.sheets).toEqual(["Tổng"]);
      expect(result.content.cells).toEqual({ "Tổng!A1": "41.5", "Tổng!A2": "ok" });
    }
  });

  it("reads a workbook small enough to live in the mini-stream", () => {
    expect(convertLegacySpreadsheet(buildCfb([{ name: "Workbook", data: sheet }])).content.cells).toEqual({ "Tổng!A1": "41.5", "Tổng!A2": "ok" });
  });

  function typed(run: () => unknown): ConvertTypedError {
    try {
      run();
    } catch (error) {
      if (error instanceof ConvertTypedError) return error;
      throw error;
    }
    throw new Error("expected a ConvertTypedError");
  }

  it("answers not_compound_file when the container has no Workbook stream", () => {
    const error = typed(() => convertLegacySpreadsheet(buildCfb([{ name: "Other", data: padded(sheet) }])));
    expect(error).toMatchObject({ code: "engine_result_invalid", reason: "not_compound_file" });
  });

  it("answers unsupported_operation for an encrypted workbook and engine_result_invalid for other BIFF faults", () => {
    const encrypted = new Uint8Array([...BOF_GLOBALS, ...rec(0x002f, [1, 0, 0, 0])]);
    expect(typed(() => convertLegacySpreadsheet(buildCfb([{ name: "Workbook", data: encrypted }])))).toMatchObject({
      code: "unsupported_operation",
      reason: "xls_encrypted",
    });
    const broken = new Uint8Array([...BOF_GLOBALS, ...EOF]);
    expect(typed(() => convertLegacySpreadsheet(buildCfb([{ name: "Workbook", data: broken }])))).toMatchObject({
      code: "engine_result_invalid",
      reason: "biff_unreadable",
    });
  });
});
