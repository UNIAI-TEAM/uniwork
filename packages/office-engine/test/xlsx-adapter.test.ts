// XLSX adapter tests — P3 typed open outcomes, session-bound edits, the
// save pipeline (recalc → assemble → preserve → rebase), and the guards the
// lane is graded on: a formula save with no recalc port refuses, a failed
// save changes nothing, a release purges the native model.
import { describe, expect, it, vi } from "vitest";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import { createXlsxAdapter, type XlsxAdapter } from "../src/xlsx";
import {
  createFakeRecalc,
  createFakeXlsxEngine,
  makeCorruptZipXlsx,
  makeFakeXlsxBytes,
  makeNonOfficeBytes,
} from "./fake-xlsx-engine";

const fixture = () =>
  makeFakeXlsxBytes({
    sheets: [
      {
        name: "Data",
        cells: {
          A1: { value: 1 },
          A2: { value: 2 },
          A3: { value: 3 },
          B1: { value: null, formula: "=SUM(A1:A3)" },
        },
      },
      { name: "Report", cells: { B2: { value: null, formula: "=SUM(Data!A1:A3)" } } },
    ],
    parts: ["xl/charts/chart1.xml", "xl/vbaProject.bin"],
  });

const openWith = async (deps: Parameters<typeof createXlsxAdapter>[0]) => {
  const adapter = createXlsxAdapter(deps);
  const out = await adapter.open({ bytes: fixture(), format: "xlsx", document_id: "doc-1" });
  return { adapter, out };
};

describe("xlsx adapter open", () => {
  it("opens a workbook: typed opened outcome bound to document_id, parts warning listed", async () => {
    const { out } = await openWith({ engine: createFakeXlsxEngine() });
    expect(out).toMatchObject({
      outcome: "opened",
      document_id: "doc-1",
      document_model_ref: expect.stringMatching(/^xlsx-session-/),
    });
    const warnings = (out as { warnings: { code: string }[] }).warnings;
    expect(warnings.some((w) => w.code === "parts_preserved_not_editable")).toBe(true);
  });

  it("non-office bytes => not_office_file", async () => {
    const adapter = createXlsxAdapter({ engine: createFakeXlsxEngine() });
    const out = await adapter.open({ bytes: makeNonOfficeBytes(), format: "xlsx", document_id: "d" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "not_office_file" });
  });

  it("CFB container => not_office_file (Q7 stays 501)", async () => {
    const adapter = createXlsxAdapter({ engine: createFakeXlsxEngine() });
    const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const out = await adapter.open({ bytes: cfb, format: "xlsx", document_id: "d" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "not_office_file" });
  });

  it("corrupt zip => corrupted failure, no session to serialize", async () => {
    const adapter = createXlsxAdapter({ engine: createFakeXlsxEngine() });
    const out = await adapter.open({ bytes: makeCorruptZipXlsx(), format: "xlsx", document_id: "d" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "corrupted" });
    await expect(adapter.serialize({ document_model_ref: "xlsx-session-999", format: "xlsx" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("oversize input => too_large before the engine is touched", async () => {
    const adapter = createXlsxAdapter({ engine: createFakeXlsxEngine(), maxInputBytes: 10 });
    const out = await adapter.open({ bytes: fixture(), format: "xlsx", document_id: "d" });
    expect(out).toMatchObject({ outcome: "failed", failure_class: "too_large" });
  });

  it("wrong format => unsupported_operation throws", async () => {
    const adapter = createXlsxAdapter({ engine: createFakeXlsxEngine() });
    await expect(adapter.open({ bytes: fixture(), format: "docx", document_id: "d" })).rejects.toBeInstanceOf(
      EngineBoundaryError,
    );
  });
});

describe("xlsx adapter edit + serialize", () => {
  it("applies ops and saves through the assemble pass; checksum is of the output", async () => {
    const recalc = createFakeRecalc();
    const { adapter, out } = await openWith({ engine: createFakeXlsxEngine(), recalc });
    expect(out.outcome).toBe("opened");
    const ref = (out as { document_model_ref: string }).document_model_ref;
    adapter.edit(ref, [
      { op: "set_cell", target: { sheet: "Data", cell: "A4" }, attributes: { value: 7 } },
    ]);
    const saved = await adapter.serialize({ document_model_ref: ref, format: "xlsx" });
    expect(saved.bytes.length).toBeGreaterThan(4);
    expect(saved.checksum).toMatch(/^[0-9a-f]{64}$/);
    // The recalc port was driven with the pending edit and reads covering formulas.
    expect(recalc.calls.length).toBeGreaterThan(0);
    expect(recalc.calls[0]!.edits).toEqual([{ sheet: "Data", row: 3, column: 0, input: "7" }]);
  });

  it("formula-bearing workbook with NO recalc port => unsupported_operation", async () => {
    const { adapter, out } = await openWith({ engine: createFakeXlsxEngine() });
    const ref = (out as { document_model_ref: string }).document_model_ref;
    await expect(adapter.serialize({ document_model_ref: ref, format: "xlsx" })).rejects.toMatchObject({
      code: "unsupported_operation",
    });
  });

  it("workbook with no formulas saves without a recalc port", async () => {
    const adapter = createXlsxAdapter({ engine: createFakeXlsxEngine() });
    const bytes = makeFakeXlsxBytes({ sheets: [{ name: "S", cells: { A1: { value: "x" } } }] });
    const out = await adapter.open({ bytes, format: "xlsx", document_id: "d" });
    const ref = (out as { document_model_ref: string }).document_model_ref;
    const saved = await adapter.serialize({ document_model_ref: ref, format: "xlsx" });
    expect(saved.bytes.length).toBeGreaterThan(0);
  });

  it("two consecutive saves chain: save2's base is save1's output", async () => {
    const recalc = createFakeRecalc();
    const { adapter, out } = await openWith({ engine: createFakeXlsxEngine(), recalc });
    const ref = (out as { document_model_ref: string }).document_model_ref;
    adapter.edit(ref, [{ op: "set_cell", target: { sheet: "Data", cell: "A4" }, attributes: { value: 7 } }]);
    const save1 = await adapter.serialize({ document_model_ref: ref, format: "xlsx" });
    adapter.edit(ref, [{ op: "set_cell", target: { sheet: "Data", cell: "A5" }, attributes: { value: 9 } }]);
    const save2 = await adapter.serialize({ document_model_ref: ref, format: "xlsx" });
    expect(save1.checksum).not.toBe(save2.checksum);
    // save2's bytes still carry A4's edit — the base advanced.
    const probe = await adapter.snapshotOf(ref);
    const data = probe.sheets.find((s) => s.name === "Data")!;
    expect(data.cells["A4"]?.value).toBe(7);
    expect(data.cells["A5"]?.value).toBe(9);
    // And the second recalc saw only the NEW edit against the rebased file.
    expect(recalc.calls.at(-1)!.edits).toEqual([{ sheet: "Data", row: 4, column: 0, input: "9" }]);
  });

  it("preservation assertion failure => typed refusal, model stays on old base", async () => {
    const recalc = createFakeRecalc();
    const engine = createFakeXlsxEngine({ failAssert: true });
    const { adapter, out } = await openWith({ engine, recalc });
    const ref = (out as { document_model_ref: string }).document_model_ref;
    adapter.edit(ref, [{ op: "set_cell", target: { sheet: "Data", cell: "A4" }, attributes: { value: 7 } }]);
    await expect(adapter.serialize({ document_model_ref: ref, format: "xlsx" })).rejects.toMatchObject({
      code: "engine_result_invalid",
    });
    // The model did not rebase: still dirty with the pending edit intact.
    expect(adapter.isDirty(ref)).toBe(true);
  });

  it("malformed ops fail before any byte is touched", async () => {
    const recalc = createFakeRecalc();
    const { adapter, out } = await openWith({ engine: createFakeXlsxEngine(), recalc });
    const ref = (out as { document_model_ref: string }).document_model_ref;
    expect(() => adapter.edit(ref, [{ op: "drop_sheet", target: { sheet: "Data" } }])).toThrow();
    expect(() => adapter.edit(ref, [{ op: "set_cell", target: { sheet: "Nope", cell: "A1" }, text: "x" }])).toThrow();
    expect(recalc.calls.length).toBe(0);
  });

  it("release drops the session AND purges the native model", async () => {
    const recalc = createFakeRecalc();
    const { adapter, out } = await openWith({ engine: createFakeXlsxEngine(), recalc });
    const ref = (out as { document_model_ref: string }).document_model_ref;
    expect(adapter.release(ref)).toBe(true);
    expect(adapter.release(ref)).toBe(false);
    await vi.waitFor(() => expect(recalc.closed).toBe(true));
    await expect(adapter.serialize({ document_model_ref: ref, format: "xlsx" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("capability rows are honest: recalc pending without a port, proven with one", async () => {
    const bare = await createXlsxAdapter({ engine: createFakeXlsxEngine() }).capability("xlsx");
    const rows = (bare.rows as { operation: string; supported: boolean; evidence_level: string }[]);
    expect(rows.find((r) => r.operation === "serialize")).toMatchObject({ supported: false, evidence_level: "pending" });
    const withPort = await createXlsxAdapter({ engine: createFakeXlsxEngine(), recalc: createFakeRecalc() }).capability("xlsx");
    const rows2 = (withPort.rows as { operation: string; supported: boolean }[]);
    expect(rows2.find((r) => r.operation === "serialize")?.supported).toBe(true);
  });
});

describe("xlsx session binding (engine version + protocol)", () => {
  it("engine build drift after open => engine_incompatible, snapshot untouched", async () => {
    const deps = {
      engine: createFakeXlsxEngine(),
      recalc: createFakeRecalc(),
      engineVersion: "build-A",
    };
    const adapter = createXlsxAdapter(deps);
    const out = await adapter.open({ bytes: fixture(), format: "xlsx", document_id: "doc-1" });
    const ref = (out as { document_model_ref: string }).document_model_ref;
    adapter.edit(ref, [{ op: "set_cell", target: { sheet: "Data", cell: "A4" }, attributes: { value: 7 } }]);
    const snapshotBefore = adapter.snapshotOf(ref);
    // The artifact was swapped between open and serialize.
    deps.engineVersion = "build-B";
    await expect(adapter.serialize({ document_model_ref: ref, format: "xlsx" })).rejects.toMatchObject({
      code: "engine_incompatible",
    });
    // Nothing rebased: the pending edit and the base are exactly as before.
    expect(adapter.isDirty(ref)).toBe(true);
    expect(adapter.snapshotOf(ref)).toBe(snapshotBefore);
    expect(deps.recalc.calls.length).toBe(0);
  });

  it("protocol drift after open => protocol_mismatch, snapshot untouched", async () => {
    const deps = {
      engine: createFakeXlsxEngine(),
      recalc: createFakeRecalc(),
      protocolVersion: 1,
    };
    const adapter = createXlsxAdapter(deps);
    const out = await adapter.open({ bytes: fixture(), format: "xlsx", document_id: "doc-1" });
    const ref = (out as { document_model_ref: string }).document_model_ref;
    adapter.edit(ref, [{ op: "set_cell", target: { sheet: "Data", cell: "A4" }, attributes: { value: 7 } }]);
    const snapshotBefore = adapter.snapshotOf(ref);
    deps.protocolVersion = 2;
    await expect(adapter.serialize({ document_model_ref: ref, format: "xlsx" })).rejects.toMatchObject({
      code: "protocol_mismatch",
    });
    expect(adapter.isDirty(ref)).toBe(true);
    expect(adapter.snapshotOf(ref)).toBe(snapshotBefore);
    expect(deps.recalc.calls.length).toBe(0);
  });

  it("a recalc-bound adapter refuses a second live session", async () => {
    const recalc = createFakeRecalc();
    const adapter = createXlsxAdapter({ engine: createFakeXlsxEngine(), recalc });
    const first = await adapter.open({ bytes: fixture(), format: "xlsx", document_id: "doc-1" });
    expect(first.outcome).toBe("opened");
    const second = await adapter.open({ bytes: fixture(), format: "xlsx", document_id: "doc-2" });
    expect(second).toMatchObject({ outcome: "failed", engine_error: "engine_overloaded" });
    // The refusal touched no port: still open, never asked to recalc.
    expect(recalc.closed).toBe(false);
    expect(recalc.calls.length).toBe(0);
    // Releasing the first frees the lane — the native state died with it.
    const ref = (first as { document_model_ref: string }).document_model_ref;
    adapter.release(ref);
    const third = await adapter.open({ bytes: fixture(), format: "xlsx", document_id: "doc-3" });
    expect(third.outcome).toBe("opened");
  });
});
