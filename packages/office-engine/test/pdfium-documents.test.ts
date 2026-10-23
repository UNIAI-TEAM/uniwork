import { describe, expect, it } from "vitest";
import { closeDocument, openDocument, PdfOpenError, withDocument, type Pdfium } from "../src/pdf/pdfium";

/** A heap-only stand-in for the wasm module: enough of the FPDF surface to
 * watch what withDocument allocates, wipes, loads and frees, in order. */
function fakePdfium(options: { loadResult?: number; lastError?: number; failMallocAt?: number } = {}) {
  const heap = new Uint8Array(4096);
  const events: string[] = [];
  let next = 16;
  let mallocs = 0;
  let passwordAtLoad: string | null = null;
  let passwordRegion: [number, number] | null = null;
  const m = {
    HEAPU8: heap,
    _malloc(size: number) {
      mallocs += 1;
      if (mallocs === options.failMallocAt) return 0;
      const ptr = next;
      next += size;
      events.push(`malloc:${ptr}:${size}`);
      return ptr;
    },
    _free(ptr: number) { events.push(`free:${ptr}`); },
    _FPDF_LoadMemDocument(_docPtr: number, _size: number, passwordPtr: number) {
      if (passwordPtr) {
        let end = passwordPtr;
        while (heap[end] !== 0) end += 1;
        passwordAtLoad = new TextDecoder().decode(heap.subarray(passwordPtr, end));
        passwordRegion = [passwordPtr, end + 1];
      }
      events.push("load");
      return options.loadResult ?? 99;
    },
    _FPDF_GetLastError() { return options.lastError ?? 3; },
    _FPDF_CloseDocument(doc: number) { events.push(`close:${doc}`); },
  } as unknown as Pdfium;
  return { m, heap, events, passwordAtLoad: () => passwordAtLoad, passwordRegion: () => passwordRegion };
}

describe("withDocument on top of openDocument/closeDocument", () => {
  it("loads, runs fn, then closes the document and frees its heap copy", async () => {
    const fake = fakePdfium();
    const result = await withDocument(fake.m, Uint8Array.from([1, 2, 3]), async (doc) => {
      fake.events.push(`fn:${doc}`);
      return "done";
    });
    expect(result).toBe("done");
    expect(fake.events).toEqual(["malloc:16:3", "load", "fn:99", "close:99", "free:16"]);
    expect([...fake.heap.subarray(16, 19)]).toEqual([1, 2, 3]);
  });

  it("closes and frees when fn throws", async () => {
    const fake = fakePdfium();
    await expect(withDocument(fake.m, Uint8Array.from([1]), async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(fake.events.slice(-2)).toEqual(["close:99", "free:16"]);
  });

  it("passes the password NUL-terminated for the load only, then wipes and frees it before fn runs", async () => {
    const fake = fakePdfium();
    await withDocument(fake.m, Uint8Array.from([1]), async () => {
      const [start, end] = fake.passwordRegion() ?? [0, 0];
      expect([...fake.heap.subarray(start, end)].every((byte) => byte === 0)).toBe(true);
      fake.events.push("fn");
    }, "pw");
    expect(fake.passwordAtLoad()).toBe("pw");
    expect(fake.events).toEqual(["malloc:16:1", "malloc:17:3", "load", "free:17", "fn", "close:99", "free:16"]);
  });

  it("frees the copy and throws the pdfium error code when the load fails", async () => {
    const fake = fakePdfium({ loadResult: 0, lastError: 4 });
    await expect(withDocument(fake.m, Uint8Array.from([1]), async () => "never")).rejects.toMatchObject({ name: "PdfOpenError", detail: 4 });
    expect(fake.events).toEqual(["malloc:16:1", "load", "free:16"]);
  });

  it("answers a heap failure for the document copy or the password", async () => {
    await expect(withDocument(fakePdfium({ failMallocAt: 1 }).m, Uint8Array.from([1]), async () => "never")).rejects.toBeInstanceOf(PdfOpenError);
    const fake = fakePdfium({ failMallocAt: 2 });
    await expect(withDocument(fake.m, Uint8Array.from([1]), async () => "never", "pw")).rejects.toMatchObject({ detail: "heap" });
    expect(fake.events).toEqual(["malloc:16:1", "free:16"]);
  });

  it("lets a caller keep a document open across turns until closeDocument", () => {
    const fake = fakePdfium();
    const opened = openDocument(fake.m, Uint8Array.from([1, 2]));
    expect(opened).toEqual({ doc: 99, docPtr: 16 });
    expect(fake.events).toEqual(["malloc:16:2", "load"]);
    closeDocument(fake.m, opened);
    expect(fake.events.slice(-2)).toEqual(["close:99", "free:16"]);
  });
});
