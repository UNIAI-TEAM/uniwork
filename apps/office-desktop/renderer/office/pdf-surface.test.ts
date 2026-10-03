import { describe, expect, it, vi } from "vitest";
import { createDesktopPdfSurface } from "./pdf-surface";
import type { DesktopSurfaceSettings } from "./surface";

const PDF_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

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

  it("applies an edit batch and bumps the dirty generation", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 2 } };
      return { ok: true, operation: "edit", dataBase64: Buffer.from(PDF_BYTES).toString("base64") };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    const dirty: number[] = [];
    surface.subscribeDirty((generation) => dirty.push(generation));
    await surface.edit([{ op: "delete_page", target: { page: 1 } }]);
    expect(dirty).toEqual([3]);
    expect(surface.getDirtyGeneration()).toBe(3);
    expect((await surface.captureSnapshot()).value).toEqual(PDF_BYTES);
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
});
