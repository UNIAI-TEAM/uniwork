// bindXlsxGateway's positional contract: every XlsxGatewayArguments slot
// reaches applyCellEditsToXlsx in its upstream position, and an absent (or
// empty) argument reproduces the exact call this lane made before the slots
// existed.
import { describe, expect, it } from "vitest";
import type { XlsxCellEdit, XlsxMutation } from "../src/xlsx/engine";
import { bindXlsxGateway } from "../src/xlsx/vendor";

const mutation = (): XlsxMutation => ({
  buffer: new Uint8Array([1, 2, 3]),
  touchedEntries: [],
  removedEntries: [],
  addedEntries: [],
  beforeEntries: [],
  afterEntries: [],
});

function fakeGateway() {
  const calls: unknown[][] = [];
  const mod = {
    readBasicWorkbook: async () => ({ snapshot: { revision: 0, sheets: [] }, sheetNamesById: {} }),
    inventoryXlsx: async () => [],
    createBufferEntrySource: async () => ({
      paths: async () => [],
      has: async () => false,
      readText: async () => "",
    }),
    applyCellEditsToXlsx: async (...args: unknown[]) => {
      calls.push(args);
      return mutation();
    },
    assertOnlyTouchedEntriesChanged: () => undefined,
  };
  return { mod, calls };
}

const source = new Uint8Array([80, 75, 3, 4]);
const edits: XlsxCellEdit[] = [{ sheetName: "Data", row: 0, column: 0, writeValue: true, cell: { value: 1 } }];

describe("bindXlsxGateway applyCellEdits arguments", () => {
  it("passes an absent XlsxGatewayArguments exactly as the pre-slot call", async () => {
    const { mod, calls } = fakeGateway();
    const bound = bindXlsxGateway(mod);
    await bound.applyCellEdits(source, edits);
    expect(calls).toHaveLength(1);
    const args = calls[0]!;
    expect(args).toHaveLength(16);
    expect(Array.from(args[0] as Uint8Array)).toEqual([80, 75, 3, 4]);
    expect(args[1]).toBe(edits);
    expect(args[2]).toEqual([]); // structuralOps
    expect(args[3]).toEqual([]); // chartEdits
    expect(args[4]).toBeUndefined(); // sheetPlan
    expect(args[5]).toEqual([]); // filterStates
    expect(args[6]).toEqual([]); // hyperlinkEdits
    expect(args[7]).toEqual([]); // cfStates
    expect(args[8]).toEqual([]); // dvStates
    expect(args[9]).toEqual([]); // sheetProtections
    expect(args[10]).toBeNull(); // definedNamesState
    expect(args[11]).toEqual([]); // pageSetupStates
    expect(args[12]).toEqual([]); // noteStates
    expect(args[13]).toEqual([]); // tableAdditions
    expect(args[14]).toEqual([]); // visualAdditions (patch 0010)
    expect(args[15]).toEqual([]); // formulaValues default
  });

  it("routes every filled slot to its upstream position and keeps the tail call shape", async () => {
    const { mod, calls } = fakeGateway();
    const bound = bindXlsxGateway(mod);
    const structuralOps = [{ op: "insertRows" }];
    const chartEdits = [{ op: "addChart" }];
    const sheetPlan = { addSheets: ["Data"] };
    const filterStates = [{ sheetName: "Data" }];
    const hyperlinkEdits = [{ sheetName: "Data" }];
    const cfStates = [{ sheetName: "Data" }];
    const dvStates = [{ sheetName: "Data" }];
    const sheetProtections = [{ sheetName: "Data" }];
    const definedNamesState = { names: ["Total"] };
    const pageSetupStates = [{ sheetName: "Data" }];
    const noteStates = [{ sheetName: "Data" }];
    const tableAdditions = [{ sheetName: "Data", name: "Sales" }];
    const visualAdditions = [{ sheetName: "Data", shape: { shapeType: "rect" } }];
    const formulaValues = [{ sheetName: "Data", cells: [] }];
    await bound.applyCellEdits(source, edits, formulaValues, {
      structuralOps,
      chartEdits,
      sheetPlan,
      filterStates,
      hyperlinkEdits,
      cfStates,
      dvStates,
      sheetProtections,
      definedNamesState,
      pageSetupStates,
      noteStates,
      tableAdditions,
      visualAdditions,
    });
    const args = calls[0]!;
    expect(args).toHaveLength(16);
    expect(args[2]).toBe(structuralOps);
    expect(args[3]).toBe(chartEdits);
    expect(args[4]).toBe(sheetPlan);
    expect(args[5]).toBe(filterStates);
    expect(args[6]).toBe(hyperlinkEdits);
    expect(args[7]).toBe(cfStates);
    expect(args[8]).toBe(dvStates);
    expect(args[9]).toBe(sheetProtections);
    expect(args[10]).toBe(definedNamesState);
    expect(args[11]).toBe(pageSetupStates);
    expect(args[12]).toBe(noteStates);
    expect(args[13]).toBe(tableAdditions);
    expect(args[14]).toBe(visualAdditions);
    expect(args[15]).toBe(formulaValues);
  });

  it("treats explicitly empty slots as the same defaults", async () => {
    const { mod, calls } = fakeGateway();
    const bound = bindXlsxGateway(mod);
    await bound.applyCellEdits(source, edits, [], {
      structuralOps: [],
      chartEdits: [],
      sheetPlan: undefined,
      filterStates: [],
      hyperlinkEdits: [],
      cfStates: [],
      dvStates: [],
      sheetProtections: [],
      definedNamesState: undefined,
      pageSetupStates: [],
      noteStates: [],
    });
    const args = calls[0]!;
    expect(args.slice(2, 13)).toEqual([[], [], undefined, [], [], [], [], [], null, [], []]);
    expect(args[13]).toEqual([]); // tableAdditions
    expect(args[14]).toEqual([]); // visualAdditions
    expect(args[15]).toEqual([]); // formulaValues
  });
});
