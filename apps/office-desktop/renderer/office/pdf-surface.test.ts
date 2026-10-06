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
    const call = vi.fn(async () => ({ ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 3 } }));
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    expect(call).toHaveBeenCalledWith("desktop:engine-call", expect.objectContaining({ operation: "open", handle: "doc-1" }));
    expect(surface.getPdfSnapshot()).toMatchObject({ pageCount: 3, pages: [{ pageNumber: 1 }, { pageNumber: 2 }, { pageNumber: 3 }] });
    expect(surface.openOutcome()).toMatchObject({ outcome: "opened", document_id: "doc-1" });
  });

  it("sends the rendered bytes with no filesystem path in the payload", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => ({ ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 1 }, payload }));
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    const payload = call.mock.calls[0]![1] as { args: { dataBase64: string } };
    expect(Object.keys(payload)).toEqual(["sessionGeneration", "operation", "handle", "args"]);
    expect(Buffer.from(payload.args.dataBase64, "base64")).toEqual(Buffer.from(PDF_BYTES));
  });

  it("exposes a renderer and real canvas page sizes from the open probe (U2)", async () => {
    const call = vi.fn(async () => ({ ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 2 }, pageSizes: [{ width: 595.28, height: 841.89 }, { width: 841.89, height: 595.28 }] }));
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
    const call = vi.fn(async () => ({ ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 1 } }));
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    expect(surface.getCanvasPages?.()).toEqual([{ pageNumber: 1, width: 595.28, height: 841.89, rotation: 0, boxes: [] }]);
  });

  it("renders a page through the engine channel and returns a non-empty data URL", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string; args: { pageIndex?: number; scale?: number } };
      if (request.operation === "open") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 1 }, pageSizes: [{ width: 595.28, height: 841.89 }] };
      return { ok: true, operation: "render", pngBase64: PNG_BASE64, width: 1191, height: 1684 };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    const result = await surface.renderer!.renderPage({ pageNumber: 1, width: 595.28, height: 841.89, scale: 2 });
    expect(result).toEqual({ src: `data:image/png;base64,${PNG_BASE64}`, width: 1191, height: 1684 });
    const renderCall = call.mock.calls.find(([, payload]) => (payload as { operation: string }).operation === "render")!;
    expect(renderCall[1]).toMatchObject({ operation: "render", args: { pageIndex: 0, scale: 2 } });
  });

  it("keeps an uncached (print) render out of the view cache but serves one the view already holds", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 1 }, pageSizes: [{ width: 595.28, height: 841.89 }] };
      return { ok: true, operation: "render", pngBase64: PNG_BASE64, width: 10, height: 10 };
    });
    const renders = () => call.mock.calls.filter(([, payload]) => (payload as { operation: string }).operation === "render").length;
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    const page = { pageNumber: 1, width: 595.28, height: 841.89 };
    await surface.renderer!.renderPage({ ...page, scale: 3, cache: false });
    await surface.renderer!.renderPage({ ...page, scale: 3, cache: false });
    expect(renders()).toBe(2);
    // The view's own request was not served from a print raster: nothing was kept.
    await surface.renderer!.renderPage({ ...page, scale: 3 });
    expect(renders()).toBe(3);
    // An entry the view already holds is reused by print instead of re-rendered.
    await surface.renderer!.renderPage({ ...page, scale: 3, cache: false });
    expect(renders()).toBe(3);
  });

  it("answers an abort while the engine is still rendering instead of waiting for it", async () => {
    let finish: (value: unknown) => void = () => undefined;
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 1 }, pageSizes: [{ width: 595.28, height: 841.89 }] };
      return await new Promise((resolve) => { finish = resolve; });
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    const controller = new AbortController();
    const pending = surface.renderer!.renderPage({ pageNumber: 1, width: 595.28, height: 841.89, scale: 2, cache: false, signal: controller.signal });
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    finish({ ok: true, operation: "render", pngBase64: PNG_BASE64, width: 1, height: 1 });
  });

  it("re-probes page geometry after an edit and bumps the dirty generation", async () => {
    let pageCount = 2;
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount }, pageSizes: Array.from({ length: pageCount }, () => ({ width: 595.28, height: 841.89 })) };
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
      if (request.operation === "open") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 1 }, pageSizes: [{ width: 595.28, height: 841.89 }] };
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
      if (request.operation === "open") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 1 } };
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
      if (request.operation === "open") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 1 } };
      return { ok: true, operation: "edit", dataBase64: Buffer.from(PDF_BYTES).toString("base64"), warnings: [{ code: "edit_skipped", detail: 'form field "fullName": WinAnsi cannot encode' }] };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    const result = (await surface.submitEngineOperations!([{ op: "setFormValue", field: { name: "fullName", kind: "text", value: "x" } }])) as { skipped: { op: string; reason: string }[] };
    expect(result.skipped).toEqual([{ op: "setFormValue", reason: 'form field "fullName": WinAnsi cannot encode' }]);
  });

  it("refuses an edit when the capability is read-only", async () => {
    const call = vi.fn(async () => ({ ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 1 } }));
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
      if (args.password === "    ") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 1 } };
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
  /** An engine fake whose `text` answers follow the page-range contract. */
  function textEngine(pages: readonly { text: string; width?: number; height?: number }[], failures: { remaining: number } = { remaining: 0 }) {
    return vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string; args: { pageIndex?: number; pageLimit?: number; geometry?: boolean } };
      if (request.operation === "open") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: pages.length }, pageSizes: pages.map((page) => ({ width: page.width ?? 100, height: page.height ?? 100 })) };
      if (request.operation === "edit") return { ok: true, operation: "edit", dataBase64: Buffer.from(PDF_BYTES).toString("base64") };
      if (failures.remaining > 0) { failures.remaining -= 1; throw new Error("ipc down"); }
      const start = request.args.pageIndex ?? -1;
      if (start < 0 || start >= pages.length) throw new Error("page_range");
      const end = Math.min(start + (request.args.pageLimit ?? 1), pages.length);
      const slice = pages.slice(start, end).map((page, offset) => ({
        page: start + offset + 1,
        width: page.width ?? 100,
        height: page.height ?? 100,
        text: page.text,
        // Display-space boxes, 5 wide, only when geometry was asked for.
        charBoxes: request.args.geometry ? page.text.split("").map((_c, at) => ({ x: at * 5, y: 20, width: 5, height: 8 })) : [],
      }));
      return { ok: true, operation: "text", pageCount: pages.length, pages: slice };
    });
  }
  const textCalls = (call: ReturnType<typeof textEngine>) => call.mock.calls
    .map(([, payload]) => payload as { operation: string; args: { pageIndex: number; pageLimit: number; geometry: boolean } })
    .filter((payload) => payload.operation === "text")
    .map((payload) => ({ pageIndex: payload.args.pageIndex, pageLimit: payload.args.pageLimit, geometry: payload.args.geometry }));

  it("searches the engine text layer and returns per-line quads so find paints on desktop (F-13)", async () => {
    const call = textEngine([{ text: "Bao cao tong hop" }]);
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    expect(surface.searchText).toBeTypeOf("function");
    const hits = await surface.searchText!("Bao cao");
    expect(hits).toEqual([{ id: "1:0", page: 1, start: 0, end: 7, text: "Bao cao", quads: [[0, 72, 35, 80]] }]);
    const textCall = call.mock.calls.find(([, payload]) => (payload as { operation: string }).operation === "text")!;
    expect(textCall[1]).toMatchObject({ operation: "text", handle: "doc-1" });
    expect(await surface.searchText!("   ")).toEqual([]);
    expect(await surface.searchText!("absent")).toEqual([]);
  });

  it("walks the text layer in 16-page chunks and requests geometry only for pages with a hit", async () => {
    const pages = Array.from({ length: 20 }, (_, index) => ({ text: index === 0 ? "alpha beta" : index === 17 ? "beta again beta" : "gamma" }));
    const call = textEngine(pages);
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    const hits = await surface.searchText!("beta");
    expect(hits.map((hit) => hit.id)).toEqual(["1:6", "18:0", "18:11"]);
    expect(hits.every((hit) => hit.quads !== undefined)).toBe(true);
    expect(textCalls(call)).toEqual([
      { pageIndex: 0, pageLimit: 16, geometry: false },
      { pageIndex: 0, pageLimit: 1, geometry: true },
      { pageIndex: 16, pageLimit: 16, geometry: false },
      { pageIndex: 17, pageLimit: 1, geometry: true },
    ]);
  });

  it("reuses both caches within a generation and drops them after an edit", async () => {
    const call = textEngine([{ text: "alpha" }, { text: "alpha two" }]);
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    await surface.searchText!("alpha");
    await surface.searchText!("alpha");
    // One text chunk plus one geometry read per hit page, read once.
    expect(textCalls(call)).toHaveLength(3);
    await surface.edit([{ op: "delete_page", target: { page: 1 } }]);
    await surface.searchText!("alpha");
    expect(textCalls(call)).toHaveLength(6);
  });

  it("encodes the document once per generation, not once per engine call", async () => {
    const call = textEngine([{ text: "alpha" }, { text: "alpha two" }]);
    const encode = vi.spyOn(globalThis, "btoa");
    try {
      const surface = createDesktopPdfSurface(settings(call));
      await surface.open();
      await surface.searchText!("alpha");
      await surface.searchText!("alpha two");
      // open encodes once; the three text calls reuse that string.
      expect(encode).toHaveBeenCalledTimes(1);
      await surface.edit([{ op: "delete_page", target: { page: 1 } }]);
      const afterEdit = encode.mock.calls.length;
      await surface.searchText!("alpha");
      // The edit swapped the bytes, so the next generation encodes at most once more.
      expect(encode.mock.calls.length - afterEdit).toBeLessThanOrEqual(1);
    } finally {
      encode.mockRestore();
    }
  });

  it("does not poison the cache with a failed chunk read and retries it on the next query", async () => {
    const failures = { remaining: 0 };
    const call = textEngine([{ text: "alpha" }, { text: "alpha" }], failures);
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    failures.remaining = 1;
    // The only chunk fails and is skipped; nothing is found.
    expect(await surface.searchText!("alpha")).toEqual([]);
    expect((await surface.searchText!("alpha")).map((hit) => hit.id)).toEqual(["1:0", "2:0"]);
  });

  it("still reports a hit, without quads, when the geometry read fails or is empty", async () => {
    let geometryAnswers = 0;
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string; args: { geometry?: boolean } };
      if (request.operation === "open") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 1 }, pageSizes: [{ width: 100, height: 100 }] };
      if (request.args.geometry) {
        geometryAnswers += 1;
        if (geometryAnswers === 1) throw new Error("geometry down");
      }
      return { ok: true, operation: "text", pageCount: 1, pages: [{ page: 1, width: 100, height: 100, text: "alpha", charBoxes: [] }] };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    expect(await surface.searchText!("alpha")).toEqual([{ id: "1:0", page: 1, start: 0, end: 5, text: "alpha" }]);
    expect(await surface.searchText!("alpha")).toEqual([{ id: "1:0", page: 1, start: 0, end: 5, text: "alpha" }]);
  });

  it("discards a search that an edit overtook instead of writing stale pages into the new caches", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string; args: { pageIndex?: number } };
      if (request.operation === "open") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 20 }, pageSizes: [] };
      if (request.operation === "edit") return { ok: true, operation: "edit", dataBase64: Buffer.from(PDF_BYTES).toString("base64") };
      if (request.args.pageIndex === 0) await gate;
      return { ok: true, operation: "text", pageCount: 20, pages: [{ page: (request.args.pageIndex ?? 0) + 1, width: 100, height: 100, text: "alpha", charBoxes: [] }] };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    const stale = surface.searchText!("alpha");
    await surface.edit([{ op: "delete_page", target: { page: 1 } }]);
    release?.();
    expect(await stale).toEqual([]);
    const textReads = () => call.mock.calls.filter(([, payload]) => (payload as { operation: string }).operation === "text").length;
    const before = textReads();
    // The fresh generation reads the first chunk again instead of reusing the stale entry.
    await surface.searchText!("alpha");
    expect(textReads()).toBeGreaterThan(before);
  });

  it("stops the walk at the first password wall and retries on the next query", async () => {
    const call = vi.fn(async (_channel: string, payload: unknown) => {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 40 } };
      return { ok: false, error: { kind: "password", status: "required" } };
    });
    const surface = createDesktopPdfSurface(settings(call));
    await surface.open();
    await expect(surface.searchText!("anything")).resolves.toEqual([]);
    const textReads = () => call.mock.calls.filter(([, payload]) => (payload as { operation: string }).operation === "text").length;
    // 40 pages is three chunks; the wall on the first one ends the query.
    expect(textReads()).toBe(1);
    await surface.searchText!("anything");
    expect(textReads()).toBe(2);
  });

  describe("form and saved-note facets (R18-2)", () => {
    /** A one-page PDF with a text form field and a /Text note annotation, with real xref offsets. */
    function formAndNotePdf(fieldValue = "hello"): Uint8Array {
      const objects = [
        "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] >> >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R 5 0 R] >>",
        "<< /Type /Annot /Subtype /Text /Rect [10 20 34 44] /Contents (Ghi chu) /T (Lan) >>",
        `<< /Type /Annot /Subtype /Widget /FT /Tx /T (fullName) /V (${fieldValue}) /Rect [50 50 150 70] /P 3 0 R >>`,
      ];
      let body = "%PDF-1.7\n";
      const offsets: number[] = [];
      objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
      const xref = body.length;
      body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
      body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      return Uint8Array.from(Buffer.from(body, "latin1"));
    }
    const openWith = async (bytes: Uint8Array, editedBytes?: Uint8Array) => {
      const call = vi.fn(async (_channel: string, payload: unknown) => {
        const request = payload as { operation: string };
        if (request.operation === "open") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 1 }, pageSizes: [{ width: 200, height: 200 }] };
        return { ok: true, operation: "edit", dataBase64: Buffer.from(editedBytes ?? bytes).toString("base64") };
      });
      const surface = createDesktopPdfSurface(settings(call, { readBytes: async () => bytes }));
      await surface.open();
      return { surface, call };
    };

    it("reads the real form fields of the current bytes without an IPC call", async () => {
      const { surface, call } = await openWith(formAndNotePdf());
      expect(surface.readFormFields).toBeTypeOf("function");
      const before = call.mock.calls.length;
      expect(await surface.readFormFields!()).toMatchObject([{ name: "fullName", kind: "text", value: "hello" }]);
      expect(call.mock.calls.length).toBe(before);
    });

    it("reads saved note threads as bound rows", async () => {
      const { surface } = await openWith(formAndNotePdf());
      const threads = await surface.readSavedNotes!();
      expect(threads).toHaveLength(1);
      expect(threads[0]!.root).toMatchObject({ page: 1, pageIndex: 0, rect: [10, 20, 34, 44], contents: "Ghi chu", author: "Lan", binding: "bound" });
      expect(threads[0]!.replies).toEqual([]);
    });

    it("reflects the bytes after an edit", async () => {
      const { surface } = await openWith(formAndNotePdf("hello"), formAndNotePdf("changed"));
      await surface.submitEngineOperations!([{ op: "setFormValue", field: { name: "fullName", kind: "text", value: "changed" } }]);
      expect(await surface.readFormFields!()).toMatchObject([{ name: "fullName", value: "changed" }]);
    });

    it("rejects for bytes the reader cannot parse, like the web lane, so the panel shows its error (R-3)", async () => {
      const { surface } = await openWith(PDF_BYTES);
      await expect(surface.readFormFields!()).rejects.toThrow();
      await expect(surface.readSavedNotes!()).rejects.toThrow();
      // A disposed surface holds no bytes: nothing to read, not a failure.
      await surface.dispose();
      await expect(surface.readFormFields!()).resolves.toEqual([]);
      await expect(surface.readSavedNotes!()).resolves.toEqual([]);
    });
  });
  describe("byte history (G-1)", () => {
    const versions = [Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x31]), Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x32]), Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x33])];
    /** Each edit answers the next version; every engine call records the bytes it was handed. */
    const historySurface = (budget?: number, overrides: Partial<DesktopSurfaceSettings> = {}) => {
      let next = 1;
      const sent: string[] = [];
      const call = vi.fn(async (_channel: string, payload: unknown) => {
        const request = payload as { operation: string; args: { dataBase64: string } };
        sent.push(`${request.operation}:${Buffer.from(request.args.dataBase64, "base64").at(-1)}`);
        if (request.operation === "open") return { ok: true, operation: "open", pdfHandle: "pdf_1", probe: { pageCount: 1 }, pageSizes: [{ width: 100, height: 100 }] };
        const edited = versions[next]!;
        next += 1;
        return { ok: true, operation: "edit", dataBase64: Buffer.from(edited).toString("base64") };
      });
      const surface = createDesktopPdfSurface(settings(call, { readBytes: async () => versions[0]!, ...overrides }), budget);
      return { surface, call, sent };
    };
    const lastByte = async (surface: ReturnType<typeof createDesktopPdfSurface>) => (await surface.captureSnapshot()).value.at(-1);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("steps back and forward through the edits and notifies both listener sets", async () => {
      const { surface } = historySurface();
      await surface.open();
      await surface.submitEngineOperations([{ op: "a" }]);
      await surface.submitEngineOperations([{ op: "b" }]);
      expect(await lastByte(surface)).toBe(0x33);
      const changes = vi.fn();
      const dirty: number[] = [];
      surface.subscribe(changes);
      surface.subscribeDirty((generation) => dirty.push(generation));

      surface.undo();
      await settle();
      expect(await lastByte(surface)).toBe(0x32);
      surface.undo();
      await settle();
      expect(await lastByte(surface)).toBe(0x31);
      surface.redo();
      await settle();
      expect(await lastByte(surface)).toBe(0x32);
      expect(changes).toHaveBeenCalledTimes(3);
      // Every step bumps the generation so the coordinator saves the swapped bytes.
      expect(dirty).toEqual([5, 6, 7]);
      expect(surface.getDirtyGeneration()).toBe(7);
    });

    it("is a no-op on an empty stack, like the web lane", async () => {
      const { surface } = historySurface();
      await surface.open();
      const changes = vi.fn();
      surface.subscribe(changes);
      surface.undo();
      surface.redo();
      await settle();
      expect(changes).not.toHaveBeenCalled();
      expect(surface.getDirtyGeneration()).toBe(2);
    });

    it("clears redo on a new edit and edits from the undone bytes", async () => {
      const { surface, sent } = historySurface();
      await surface.open();
      await surface.submitEngineOperations([{ op: "a" }]);
      surface.undo();
      await surface.submitEngineOperations([{ op: "b" }]);
      // The second edit queued behind the undo, so the engine saw the original bytes.
      expect(sent.filter((entry) => entry.startsWith("edit"))).toEqual(["edit:49", "edit:49"]);
      const generation = surface.getDirtyGeneration();
      surface.redo();
      await settle();
      expect(surface.getDirtyGeneration()).toBe(generation);
    });

    it("re-probes the page geometry after a step so a restored page is drawn", async () => {
      const { surface, sent } = historySurface();
      await surface.open();
      await surface.submitEngineOperations([{ op: "a" }]);
      const probes = sent.filter((entry) => entry.startsWith("open")).length;
      surface.undo();
      await settle();
      expect(sent.filter((entry) => entry.startsWith("open"))).toHaveLength(probes + 1);
      expect(sent.at(-1)).toBe("open:49");
    });

    it("drops the oldest snapshots past the byte budget but keeps the newest", async () => {
      const { surface } = historySurface(5);
      await surface.open();
      await surface.submitEngineOperations([{ op: "a" }]);
      await surface.submitEngineOperations([{ op: "b" }]);
      surface.undo();
      await settle();
      surface.undo();
      await settle();
      expect(await lastByte(surface)).toBe(0x32);
    });

    it("does not step a read-only document", async () => {
      const { surface } = historySurface(undefined, { readOnly: true });
      await surface.open();
      const changes = vi.fn();
      surface.subscribe(changes);
      surface.undo();
      await settle();
      expect(changes).not.toHaveBeenCalled();
    });

    it("resets the history on a re-open and on dispose", async () => {
      const { surface } = historySurface();
      await surface.open();
      await surface.submitEngineOperations([{ op: "a" }]);
      await surface.open();
      const changes = vi.fn();
      surface.subscribe(changes);
      surface.undo();
      await settle();
      expect(changes).not.toHaveBeenCalled();
      await surface.submitEngineOperations([{ op: "b" }]);
      await surface.dispose();
      surface.undo();
      await settle();
      expect(changes).toHaveBeenCalledTimes(1);
    });
  });

  describe("retained engine document (H-pdf-handle)", () => {
    type Request = { operation: string; args: Record<string, unknown> };
    /** An engine fake that retains on open, renders by handle, and answers a
     * handle it no longer holds as typed stale data, like the main process. */
    const handleEngine = (pageCount: number) => {
      let issued = 0;
      const live = new Set<string>();
      const state = { staleNext: 0, failReopen: false };
      const call = vi.fn(async (_channel: string, payload: unknown) => {
        const request = payload as Request;
        if (request.operation === "open") {
          if (state.failReopen && issued > 0) throw new Error("ipc down");
          issued += 1;
          const pdfHandle = `pdf_${issued}`;
          live.clear();
          if (request.args.retain === true) live.add(pdfHandle);
          return { ok: true, operation: "open", pdfHandle, probe: { pageCount }, pageSizes: Array.from({ length: pageCount }, () => ({ width: 100, height: 100 })) };
        }
        if (request.operation === "close") {
          live.delete(request.args.pdfHandle as string);
          return { ok: true, operation: "close" };
        }
        if (request.operation === "edit") return { ok: true, operation: "edit", dataBase64: Buffer.from(PDF_BYTES).toString("base64") };
        if (state.staleNext > 0 || !live.has(request.args.pdfHandle as string)) {
          state.staleNext = Math.max(0, state.staleNext - 1);
          return { ok: false, error: { kind: "handle", status: "unknown" } };
        }
        if (request.operation === "text") return { ok: true, operation: "text", pageCount, pages: [{ page: (request.args.pageIndex as number) + 1, width: 100, height: 100, text: "alpha", charBoxes: [] }] };
        return { ok: true, operation: "render", pngBase64: PNG_BASE64, width: 10, height: 10 };
      });
      const requests = () => call.mock.calls.map(([, payload]) => payload as Request);
      const transfers = () => requests().filter((request) => typeof request.args.dataBase64 === "string");
      const ofOperation = (operation: string) => requests().filter((request) => request.operation === operation);
      return { call, live, state, transfers, ofOperation };
    };
    const page = (pageNumber: number) => ({ pageNumber, width: 100, height: 100, scale: 2, cache: false });

    it("prints N pages with one document transfer and N page requests that carry no bytes", async () => {
      const engine = handleEngine(5);
      const surface = createDesktopPdfSurface(settings(engine.call));
      await surface.open();
      for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) await surface.renderer!.renderPage(page(pageNumber));
      expect(engine.transfers()).toHaveLength(1);
      expect(engine.transfers()[0]).toMatchObject({ operation: "open", args: { retain: true } });
      const renders = engine.ofOperation("render");
      expect(renders).toHaveLength(5);
      for (const [index, render] of renders.entries()) {
        expect(render.args).toEqual({ pageIndex: index, scale: 2, pdfHandle: "pdf_1" });
      }
    });

    it("reads text by handle and keeps the password out of every per-page request", async () => {
      const engine = handleEngine(2);
      const surface = createDesktopPdfSurface(settings(engine.call));
      await surface.open(undefined, "    ");
      expect(engine.transfers()[0]!.args).toMatchObject({ retain: true, password: "    " });
      await surface.searchText!("alpha");
      await surface.renderer!.renderPage(page(1));
      for (const request of [...engine.ofOperation("text"), ...engine.ofOperation("render")]) {
        expect(request.args).toMatchObject({ pdfHandle: "pdf_1" });
        expect(request.args).not.toHaveProperty("password");
        expect(request.args).not.toHaveProperty("dataBase64");
      }
    });

    it("re-opens once on a stale handle, shared by every page waiting on it, and retries", async () => {
      const engine = handleEngine(3);
      const surface = createDesktopPdfSurface(settings(engine.call));
      await surface.open();
      engine.live.clear();
      const results = await Promise.all([1, 2, 3].map((pageNumber) => surface.renderer!.renderPage(page(pageNumber))));
      expect(results.every((result) => result.src.startsWith("data:image/png"))).toBe(true);
      // The first open plus one shared re-open.
      expect(engine.ofOperation("open")).toHaveLength(2);
      expect(engine.transfers()).toHaveLength(2);
      expect(engine.ofOperation("render").slice(-3).map((request) => request.args.pdfHandle)).toEqual(["pdf_2", "pdf_2", "pdf_2"]);
    });

    it("fails a render closed when the handle is still stale after the one re-open", async () => {
      const engine = handleEngine(1);
      const surface = createDesktopPdfSurface(settings(engine.call));
      await surface.open();
      engine.state.staleNext = 2;
      await expect(surface.renderer!.renderPage(page(1))).rejects.toThrow("pdf_render_failed");
      expect(engine.ofOperation("open")).toHaveLength(2);
      expect(engine.ofOperation("render")).toHaveLength(2);
    });

    it("fails a render closed when the re-open itself fails", async () => {
      const engine = handleEngine(1);
      const surface = createDesktopPdfSurface(settings(engine.call));
      await surface.open();
      engine.live.clear();
      engine.state.failReopen = true;
      await expect(surface.renderer!.renderPage(page(1))).rejects.toThrow("ipc down");
    });

    it("closes the handle on dispose, and a disposed surface sends nothing more", async () => {
      const engine = handleEngine(1);
      const surface = createDesktopPdfSurface(settings(engine.call));
      await surface.open();
      await surface.dispose();
      expect(engine.ofOperation("close").map((request) => request.args)).toEqual([{ pdfHandle: "pdf_1" }]);
      expect(engine.live.size).toBe(0);
      const before = engine.call.mock.calls.length;
      await expect(surface.renderer!.renderPage(page(1))).rejects.toThrow("pdf_surface_disposed");
      expect(engine.call.mock.calls.length).toBe(before);
    });

    it("moves to the new handle on a document change and closes the old one", async () => {
      const engine = handleEngine(1);
      const surface = createDesktopPdfSurface(settings(engine.call));
      await surface.open();
      await surface.edit([{ op: "delete_page", target: { page: 1 } }]);
      expect(engine.ofOperation("close").map((request) => request.args)).toEqual([{ pdfHandle: "pdf_1" }]);
      await surface.renderer!.renderPage(page(1));
      expect(engine.ofOperation("render").at(-1)!.args.pdfHandle).toBe("pdf_2");
    });

    it("re-sends the edited bytes when the post-edit re-probe failed, never the pre-edit document", async () => {
      const engine = handleEngine(1);
      const surface = createDesktopPdfSurface(settings(engine.call));
      await surface.open();
      engine.state.failReopen = true;
      await surface.edit([{ op: "delete_page", target: { page: 1 } }]);
      engine.state.failReopen = false;
      // The old handle was dropped with the failed re-probe: the render re-opens the edited bytes.
      await surface.renderer!.renderPage(page(1));
      expect(engine.ofOperation("render").map((request) => request.args.pdfHandle)).toEqual(["pdf_2"]);
      expect(engine.ofOperation("close").map((request) => request.args)).toEqual([{ pdfHandle: "pdf_1" }]);
    });
  });
});
