/** @vitest-environment node */
// UNI-940 X02 r2: the web runtime's op journal across the host apply path and
// a save boundary. Visual ops ride edit() to the save job untouched, and the
// draft op stream (F4) keeps every edit typed after the save's snapshot.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StableSnapshot } from "@uniwork/core/office";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { createWebXlsxSessionRuntime } from "./xlsx-runtime";
import type { XlsxSessionRuntime } from "./xlsx-adapter";

const api = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), download: vi.fn(), cancel: vi.fn() }));
vi.mock("@uniwork/core/api/endpoints/office", () => ({ startOfficeJob: api.start, getOfficeJob: api.get, downloadOfficeJobOutput: api.download, cancelOfficeJob: api.cancel }));

const workbook = (): XlsxWorkbookSnapshot => ({ revision: 1, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 2 } } }] });
const renderModel = () => ({ revision: 1, activeTab: 0, date1904: false, styles: [], dxfStyles: [], sheets: [{ id: "sheet-1", name: "Data", rowCount: 2, columnCount: 2, cells: { A1: { v: 2 } }, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [] }] });
const anchor = (row: number) => ({ fromRow: row, fromColumn: 1, fromRowOffset: 0, fromColumnOffset: 0, toRow: row + 4, toColumn: 4, toRowOffset: 0, toColumnOffset: 0 });
const insert = { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "v1", anchor: anchor(1), shape: { shapeType: "rect", fillColor: "#4472C4" } } };
const move = { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "v1", anchor: anchor(6) } };
const remove = { op: "remove_visual", target: { sheet: "Data" }, attributes: { id: "v1" } };
const cell = (address: string, value: number) => ({ op: "set_cell", target: { sheet: "Data", cell: address }, attributes: { value } });
const stable = (engine: XlsxSessionRuntime): StableSnapshot<XlsxWorkbookSnapshot> => ({ generation: engine.snapshot("model").revision, fingerprint: "captured", value: engine.snapshot("model") });

async function opened() {
  const engine = createWebXlsxSessionRuntime({ documentId: "doc", baseRevision: "1" });
  expect(await engine.open({ bytes: new Uint8Array([80, 75]), documentId: "doc" })).toMatchObject({ outcome: "opened" });
  return engine;
}
const editRequests = () => api.start.mock.calls.map((call) => call[1]).filter((body) => body.operation === "edit");

beforeEach(() => {
  vi.resetAllMocks();
  api.start.mockResolvedValue({ jobId: "job" });
  api.get.mockResolvedValue({ jobId: "job", state: "completed" });
  api.cancel.mockResolvedValue({});
  api.download.mockResolvedValue({ text: async () => JSON.stringify({ snapshot: workbook(), render_model: renderModel() }), arrayBuffer: async () => new Uint8Array([80, 75, 3, 4]).buffer });
});

describe("web XLSX runtime journal (visuals, save boundary)", () => {
  it("takes a visual insert, move and remove through edit() and sends them unchanged in the save job", async () => {
    const engine = await opened();
    await engine.edit("model", [insert]);
    await engine.edit("model", [move]);
    await engine.edit("model", [cell("A1", 5), remove]);
    expect(engine.snapshot("model").sheets[0]!.cells.A1).toEqual({ value: 5 });
    await engine.serialize("model", { intentId: "save-1", snapshot: stable(engine) });
    expect(editRequests()[0]?.edits).toEqual([insert, move, cell("A1", 5), remove]);
  });

  it("keeps the edits typed during an in-flight save in the draft stream, so a restore still saves them", async () => {
    const engine = await opened();
    await engine.edit("model", [cell("A1", 3)]);
    const saving = stable(engine);
    await engine.serialize("model", { intentId: "save-1", snapshot: saving });
    // Typed after the save's snapshot, before its commit lands.
    await engine.edit("model", [cell("B2", 8), insert]);
    engine.setBaseRevision?.("2", "save-1");
    await engine.edit("model", [cell("C3", 9)]);
    const draft = stable(engine).value as XlsxWorkbookSnapshot & { pendingOps?: unknown[] };
    // The saved op left the stream; the in-flight and later ones stayed.
    expect(draft.pendingOps).toEqual([cell("B2", 8), insert, cell("C3", 9)]);

    // Crash: a new tab opens the saved revision (it holds A1 = 3) and restores the draft.
    const saved = workbook();
    saved.sheets[0]!.cells.A1 = { value: 3 };
    api.download.mockResolvedValueOnce({ text: async () => JSON.stringify({ snapshot: saved, render_model: renderModel() }) });
    const restored = createWebXlsxSessionRuntime({ documentId: "doc", baseRevision: "2" });
    await restored.open({ bytes: new Uint8Array([80, 75]), documentId: "doc" });
    await restored.restore?.("model", JSON.parse(JSON.stringify(draft)) as XlsxWorkbookSnapshot);
    api.start.mockClear();
    await restored.serialize("model", { intentId: "save-2", snapshot: stable(restored) });
    expect(editRequests()[0]?.edits).toEqual([cell("B2", 8), insert, cell("C3", 9)]);
  });
});
