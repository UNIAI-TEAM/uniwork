// Fake XLSX gateway + recalc port for adapter tests — a deterministic JSON
// convention that exercises the seam without the vendored artifacts.
//
// Conventions:
//   bytes      = "PK\x03\x04" + UTF-8 JSON {sheets:[{id,name,cells}], parts?}
//   inventory  = the parts array (defaults derived from sheets)
//   applyEdits = applies set/clear + formulaValues into the JSON, returns a
//                mutation with before/after entries; preservation assert is a
//                no-op unless failAssert is armed
import type {
  XlsxCellEdit,
  XlsxCellState,
  XlsxGatewayFunctions,
  XlsxImported,
  XlsxMutation,
  XlsxPackageEntry,
  XlsxRecalcEdit,
  XlsxRecalcPort,
  XlsxRecalcRead,
  XlsxRecalcResult,
  XlsxSheetFormulaValues,
  XlsxWorksheet,
} from "../src/xlsx";

const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface FakeXlsxFixture {
  sheets: Array<{ name: string; cells: Record<string, XlsxCellState> }>;
  /** Extra package parts beyond the well-known worksheet set. */
  parts?: string[];
  /** Parts matching preserved families (vba/charts/etc) the warning lists. */
}

export function makeFakeXlsxBytes(fixture: FakeXlsxFixture): Uint8Array {
  const sheets = fixture.sheets.map((s, i) => ({ id: `sheet-${i + 1}`, name: s.name, cells: s.cells }));
  const payload = encoder.encode(JSON.stringify({ magic: "fake-xlsx", sheets, parts: fixture.parts ?? [] }));
  const out = new Uint8Array(ZIP_MAGIC.length + payload.length);
  out.set(ZIP_MAGIC);
  out.set(payload, ZIP_MAGIC.length);
  return out;
}

export function makeNonOfficeBytes(): Uint8Array {
  return encoder.encode("this is plainly not an office package");
}

export function makeCorruptZipXlsx(): Uint8Array {
  const out = new Uint8Array(ZIP_MAGIC.length + 8);
  out.set(ZIP_MAGIC);
  out.set(encoder.encode("not json"), ZIP_MAGIC.length);
  return out;
}

interface FakePackage {
  magic: string;
  sheets: XlsxWorksheet[];
  parts: string[];
}

function decode(bytes: Uint8Array): FakePackage {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("not a valid zip archive");
  }
  try {
    return JSON.parse(decoder.decode(bytes.subarray(4))) as FakePackage;
  } catch {
    throw new Error("not a valid zip archive (corrupt json)");
  }
}

function encode(pkg: FakePackage): Uint8Array {
  const payload = encoder.encode(JSON.stringify(pkg));
  const out = new Uint8Array(ZIP_MAGIC.length + payload.length);
  out.set(ZIP_MAGIC);
  out.set(payload, ZIP_MAGIC.length);
  return out;
}

const toA1 = (row: number, col: number): string => {
  let s = "";
  for (let c = col + 1; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s + (row + 1);
};

const entryOf = (path: string): XlsxPackageEntry => ({ path, size: 1, sha256: "sha-" + path });

export function createFakeXlsxEngine(opts: { failAssert?: boolean } = {}): XlsxGatewayFunctions & { listParts(bytes: Uint8Array): string[] } {
  return {
    async readWorkbook(bytes: Uint8Array): Promise<XlsxImported> {
      const pkg = decode(bytes);
      if (pkg.magic !== "fake-xlsx" || !Array.isArray(pkg.sheets) || pkg.sheets.length === 0) {
        throw new Error("Workbook contains no readable worksheets.");
      }
      const sheetNamesById: Record<string, string> = {};
      for (const s of pkg.sheets) sheetNamesById[s.id] = s.name;
      return { snapshot: { revision: 0, sheets: pkg.sheets }, sheetNamesById };
    },
    async inventory(bytes: Uint8Array): Promise<readonly XlsxPackageEntry[]> {
      const pkg = decode(bytes);
      const base = ["[Content_Types].xml", "xl/workbook.xml", ...pkg.sheets.map((s) => `xl/worksheets/${s.id}.xml`)];
      return [...base, ...pkg.parts].map(entryOf);
    },
    async readEntryText(_bytes: Uint8Array, path: string): Promise<string | null> {
      return path.endsWith(".xml") ? "<xml/>" : null;
    },
    async applyCellEdits(
      source: Uint8Array,
      edits: readonly XlsxCellEdit[],
      formulaValues: readonly XlsxSheetFormulaValues[] = [],
    ): Promise<XlsxMutation> {
      const pkg = decode(source);
      const before = await this.inventory(source);
      for (const edit of edits) {
        const sheet = pkg.sheets.find((s) => s.name === edit.sheetName);
        if (!sheet) throw new Error("unknown sheet " + edit.sheetName);
        const cells = { ...(sheet.cells as Record<string, XlsxCellState>) };
        if (edit.writeValue) {
          cells[toA1(edit.row, edit.column)] = edit.cell;
          if (edit.cell.value === null && edit.cell.formula === undefined) delete cells[toA1(edit.row, edit.column)];
        }
        (sheet as { cells: Record<string, XlsxCellState> }).cells = cells;
      }
      for (const fv of formulaValues) {
        const sheet = pkg.sheets.find((s) => s.name === fv.sheetName);
        if (!sheet) throw new Error("unknown formulaValues sheet " + fv.sheetName);
        const cells = { ...(sheet.cells as Record<string, XlsxCellState>) };
        for (const c of fv.cells) {
          const addr = toA1(c.row, c.column);
          const cur = cells[addr];
          if (cur?.formula !== undefined) {
            cells[addr] = { ...cur, value: typeof c.value === "object" && c.value !== null ? c.value.error : c.value };
          }
        }
        (sheet as { cells: Record<string, XlsxCellState> }).cells = cells;
      }
      const buffer = encode(pkg);
      const touched = pkg.sheets.map((s) => `xl/worksheets/${s.id}.xml`);
      return {
        buffer,
        touchedEntries: touched,
        removedEntries: [],
        addedEntries: [],
        beforeEntries: [...before],
        afterEntries: [...(await this.inventory(buffer))],
      };
    },
    assertPreserved(mutation: XlsxMutation): void {
      if (opts.failAssert) throw new Error("Saving would unexpectedly modify xl/workbook.xml — aborted.");
      void mutation;
    },
    listParts(bytes: Uint8Array): string[] {
      const pkg = decode(bytes);
      return ["xl/workbook.xml", ...pkg.parts];
    },
  };
}

/** Fake native recalc: a spreadsheet evaluator over the JSON convention —
 *  SUM ranges and literal arithmetic only, enough to prove the wiring. */
export function createFakeRecalc(): XlsxRecalcPort & { calls: { edits: XlsxRecalcEdit[]; reads: XlsxRecalcRead[] }[]; closed: boolean } {
  const calls: { edits: XlsxRecalcEdit[]; reads: XlsxRecalcRead[] }[] = [];
  return {
    calls,
    closed: false,
    async recalc(bytes, edits, reads): Promise<XlsxRecalcResult> {
      calls.push({ edits: [...edits], reads: [...reads] });
      const pkg = decode(bytes);
      // Overlay edits into a working cell map per sheet (value/formula).
      const grids = new Map<string, Map<string, { input: string }>>();
      for (const sheet of pkg.sheets) {
        const grid = new Map<string, { input: string }>();
        for (const [addr, cell] of Object.entries(sheet.cells)) {
          grid.set(addr, { input: cell.formula ?? String(cell.value ?? "") });
        }
        grids.set(sheet.name, grid);
      }
      for (const e of edits) {
        const grid = grids.get(e.sheet);
        if (grid) grid.set(toA1(e.row, e.column), { input: e.input });
      }
      const evalCell = (sheetName: string, addr: string): string | number => {
        const cell = grids.get(sheetName)?.get(addr);
        const input = cell?.input ?? "";
        if (input.startsWith("=SUM(")) {
          const m = /^=SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/.exec(input);
          if (m && m[1] && m[2] && m[3] && m[4]) {
            let sum = 0;
            const colOf = (l: string) => l.charCodeAt(0) - 65;
            for (let r = Number(m[2]); r <= Number(m[4]); r++) {
              for (let c = colOf(m[1]); c <= colOf(m[3]); c++) {
                const v = evalCell(sheetName, toA1(r - 1, c));
                sum += typeof v === "number" ? v : Number(v) || 0;
              }
            }
            return sum;
          }
        }
        const n = Number(input);
        return input === "" ? "" : Number.isFinite(n) ? n : input;
      };
      const cells = [];
      for (const read of reads) {
        const grid = grids.get(read.sheet) ?? new Map();
        for (let r = read.range.startRow; r <= read.range.endRow; r++) {
          for (let c = read.range.startColumn; c <= read.range.endColumn; c++) {
            const addr = toA1(r, c);
            const input = grid.get(addr)?.input ?? "";
            if (input === "") continue;
            const isFormula = input.startsWith("=");
            const v = evalCell(read.sheet, addr);
            cells.push({
              sheet: read.sheet,
              row: r,
              column: c,
              formatted: String(v),
              ...(typeof v === "number" ? { number: v } : {}),
              isError: false,
              isFormula,
            });
          }
        }
      }
      return { cells, cached: false };
    },
    async close() {
      this.closed = true;
    },
  };
}
