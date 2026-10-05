import { describe, expect, it, vi } from "vitest";
import { createDesktopPdfSurface } from "./pdf-surface";
import type { DesktopSurfaceSettings } from "./surface";

const PDF_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PNG_BASE64 = "iVBORw0KGgo=";

function settings(call: (channel: string, payload: unknown) => Promise<unknown>, overrides: Partial<DesktopSurfaceSettings> = {}): DesktopSurfaceSettings {
  return {
    documentId: "doc-1",
    readBytes: async () => PDF_BYTES,
    generation: 2,
    readOnly: false,
    bridge: { call } as unknown as DesktopSurfaceSettings["bridge"],
    sessionGeneration: "session_1234",
    ...overrides,
  };
}

describe("desktop PDF surface", () => {
  it("opens through the engine channel and reports a view-safe page summary", async () => {
    const call = vi.fn(async () => ({ ok: true, operation: "open", probe: { pageCount: 3 } }));
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    expect(call).toHaveBeenCalledWith("desktop:engine-call", expect.objectContaining({ operation: "open", handle: "doc-1" }));
    expect(surface.getPdfSnapshot()).toMatchObject({ pageCount: 3, pages: [{ pageNumber: 1 }, { pageNumber: 2 }, { pageNumber: 3 }] });
    expect(surface.openOutcome()).toMatchObject({ outcome: "opened", document_id: "doc-1" });
  });

  it("sends the rendered bytes with no filesystem path in the payload", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => ({ ok: true, operation: "open", probe: { pageCount: 1 }, payload }));
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    const payload = call.mock.calls[0]![1] as { args: { dataBase64: string } };
    expect(Object.keys(payload)).toEqual(["sessionGeneration", "operation", "handle", "args"]);
    expect(Buffer.from(payload.args.dataBase64, "base64")).toEqual(Buffer.from(PDF_BYTES));
  });

  it("exposes a renderer and real canvas page sizes from the open probe (U2)", async () => {
    const call = vi.fn(async () => ({ ok: true, operation: "open", probe: { pageCount: 2 }, pageSizes: [{ width: 595.28, height: 841.89 }, { width: 841.89, height: 595.28 }] }));
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    expect(surface.renderer).toBeTypeOf("object");
    expect(surface.getCanvasPages?.()).toEqual([
      { pageNumber: 1, width: 595.28, height: 841.89, rotation: 0, boxes: [] },
      { pageNumber: 2, width: 841.89, height: 595.28, rotation: 0, boxes: [] },
    ]);
    // The surface identity is stable so React does not re-render in a loop.
    expect(surface.getCanvasPages?.()).toEqual(surface.getCanvasPages?.());
  });

  it("falls back to an A4 portrait box when the probe omits a page size", async () => {
    const call = vi.fn(async () => ({ ok: true, operation: "open", probe: { pageCount: 1 } }));
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    expect(surface.getCanvasPages?.()).toEqual([{ pageNumber: 1, width: 595.28, height: 841.89, rotation: 0, boxes: [] }]);
  });

  it("renders a page through the engine channel and returns a non-empty data URL", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string; args: { pageIndex?: number; scale?: number } };
      if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 1 }, pageSizes: [{ width: 595.28, height: 841.89 }] };
      return { ok: true, operation: "render", pngBase64: PNG_BASE64, width: 1191, height: 1684 };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    const result = await surface.renderer!.renderPage({ pageNumber: 1, width: 595.28, height: 841.89, scale: 2 });
    expect(result).toEqual({ src: `data:image/png;base64,${PNG_BASE64}`, width: 1191, height: 1684 });
    const renderCall = call.mock.calls.find(([, payload]) => (payload as { operation: string }).operation === "render")!;
    expect(renderCall[1]).toMatchObject({ operation: "render", args: { pageIndex: 0, scale: 2 } });
  });

  it("re-probes page geometry after an edit and bumps the dirty generation", async () => {
    let pageCount = 2;
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount }, pageSizes: Array.from({ length: pageCount }, () => ({ width: 595.28, height: 841.89 })) };
      pageCount = 1;
      return { ok: true, operation: "edit", dataBase64: Buffer.from(PDF_BYTES).toString("base64") };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    expect(surface.getCanvasPages?.()).toHaveLength(2);
    const dirty: number[] = [];
    surface.subscribeDirty((generation) => dirty.push(generation));
    await surface.edit([{ op: "delete_page", target: { page: 1 } }]);
    expect(dirty).toEqual([3]);
    expect(surface.getDirtyGeneration()).toBe(3);
    expect(surface.getCanvasPages?.()).toHaveLength(1);
  });

  it("submits panel engine envelopes (notes) through the edit channel and reports skips", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 1 }, pageSizes: [{ width: 595.28, height: 841.89 }] };
      return { ok: true, operation: "edit", dataBase64: Buffer.from(PDF_BYTES).toString("base64"), warnings: [] };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    expect(surface.submitEngineOperations).toBeTypeOf("function");
    // The panel providers hand over already-bridged camelCase envelopes, so they
    // must reach the engine unaltered (no second snake_case bridge).
    const result = (await surface.submitEngineOperations!([{ op: "addNote", attributes: { note: { pageIndex: 0, rect: [10, 20, 34, 44], contents: "Ghi chu" } } }])) as { skipped: { op: string; reason: string }[] };
    expect(result).toEqual({ skipped: [] });
    const editCall = call.mock.calls.find(([, payload]) => (payload as { operation: string }).operation === "edit")!;
    expect(editCall[1]).toMatchObject({ operation: "edit", args: { edits: [{ op: "addNote", attributes: { note: { pageIndex: 0, rect: [10, 20, 34, 44], contents: "Ghi chu" } } }] } });
    expect(surface.getDirtyGeneration()).toBe(3);
  });

  it("surfaces an engine note skip so the view reports it instead of claiming success", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 1 } };
      return { ok: true, operation: "edit", dataBase64: Buffer.from(PDF_BYTES).toString("base64"), warnings: [{ code: "edit_skipped", detail: "note page=1: page out of range" }] };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    const result = (await surface.submitEngineOperations!([{ op: "addNote", attributes: { note: { pageIndex: 0, rect: [1, 2, 3, 4], contents: "x" } } }])) as { skipped: { op: string; reason: string }[] };
    expect(result.skipped).toEqual([{ op: "addNote", reason: "note page=1: page out of range" }]);
  });

  it("keeps a form refusal identifiable in the skipped entries", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 1 } };
      return { ok: true, operation: "edit", dataBase64: Buffer.from(PDF_BYTES).toString("base64"), warnings: [{ code: "edit_skipped", detail: 'form field "fullName": WinAnsi cannot encode' }] };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    const result = (await surface.submitEngineOperations!([{ op: "setFormValue", field: { name: "fullName", kind: "text", value: "x" } }])) as { skipped: { op: string; reason: string }[] };
    expect(result.skipped).toEqual([{ op: "setFormValue", reason: 'form field "fullName": WinAnsi cannot encode' }]);
  });

  it("refuses an edit when the capability is read-only", async () => {
    const call = vi.fn(async () => ({ ok: true, operation: "open", probe: { pageCount: 1 } }));
    const surface = createDesktopPdfSurface(settings(call, { readOnly: true }));
    await surface.open();
    await expect(surface.edit([{ op: "delete_page", target: { page: 1 } }])).rejects.toThrow("pdf_readonly");
  });

  it("throws a typed error when the engine refuses the open", async () => {
    const call = vi.fn(async () => ({ ok: false }));
    const surface = createDesktopPdfSurface(settings(call));
    await expect(surface.open()).rejects.toThrow("pdf_open_failed");
  });

  it("omits the password on the first open and carries it on the retry", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const args = (payload as { args: { password?: string } }).args;
      if (args.password === undefined) return { ok: false, error: { kind: "password", status: "required" } };
      if (args.password === "    ") return { ok: true, operation: "open", probe: { pageCount: 1 } };
      return { ok: false, error: { kind: "password", status: "wrong" } };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    expect(call.mock.calls[0]![1]).toMatchObject({ args: { dataBase64: expect.any(String) } });
    expect((call.mock.calls[0]![1] as { args: Record<string, unknown> }).args).not.toHaveProperty("password");
    expect(surface.openOutcome()).toMatchObject({ outcome: "failed", failure_class: "password_required" });
    await surface.open(undefined, "nope");
    expect(surface.openOutcome()).toMatchObject({ outcome: "failed", failure_class: "wrong_password" });
    await surface.open(undefined, "    ");
    expect(surface.openOutcome()).toMatchObject({ outcome: "opened" });
  });
  it("searches the engine text layer and returns per-line quads so find paints on desktop (F-13)", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 1 }, pageSizes: [{ width: 100, height: 100 }] };
      return {
        ok: true,
        operation: "text",
        pageCount: 1,
        pages: [{
          page: 1,
          width: 100,
          height: 100,
          text: "Bao cao tong hop",
          // Two boxes on one line, display space (top-left origin).
          charBoxes: "Bao cao tong hop".split("").map((_c, index) => ({ x: index * 5, y: 20, width: 5, height: 8 })),
        }],
      };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    expect(surface.searchText).toBeTypeOf("function");
    const hits = await surface.searchText!("Bao cao");
    expect(hits).toEqual([{ id: "1:0", page: 1, start: 0, end: 7, text: "Bao cao", quads: [[0, 72, 35, 80]] }]);
    // The engine read the text layer for this document, not the render lane.
    const textCall = call.mock.calls.find(([, payload]) => (payload as { operation: string }).operation === "text")!;
    expect(textCall[1]).toMatchObject({ operation: "text", handle: "doc-1" });
    expect(await surface.searchText!("   ")).toEqual([]);
    expect(await surface.searchText!("absent")).toEqual([]);
  });

  it("reads the engine text layer once per generation and drops the cache after an edit", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 1 }, pageSizes: [{ width: 100, height: 100 }] };
      if (request.operation === "edit") return { ok: true, operation: "edit", dataBase64: Buffer.from(PDF_BYTES).toString("base64") };
      return { ok: true, operation: "text", pageCount: 1, pages: [{ page: 1, width: 100, height: 100, text: "alpha", charBoxes: [{ x: 0, y: 0, width: 1, height: 1 }] }] };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    await surface.searchText!("alpha");
    await surface.searchText!("alpha");
    const textReads = () => call.mock.calls.filter(([, payload]) => (payload as { operation: string }).operation === "text").length;
    expect(textReads()).toBe(1);
    await surface.edit([{ op: "delete_page", target: { page: 1 } }]);
    await surface.searchText!("alpha");
    expect(textReads()).toBe(2);
  });

  it("reports no hits when the engine answers a password wall on the text channel", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 1 } };
      return { ok: false, error: { kind: "password", status: "required" } };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    await expect(surface.searchText!("anything")).resolves.toEqual([]);
  });
});
