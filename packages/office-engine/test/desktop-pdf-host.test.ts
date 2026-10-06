import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopEngineCallError, handleDesktopEngineCall, retainedPdfStatsForTests, setRetainedPdfBudgetForTests } from "../src/desktop/pdf-host";
import { assertRotationAware } from "../src/desktop/pdf-render";

const FIXTURES = fileURLToPath(new URL("../../../docs/office/g0/fixtures/files/pdf/", import.meta.url));
const b64 = (name: string) => Buffer.from(readFileSync(FIXTURES + name)).toString("base64");

/** A 100x200 portrait page with one text line near the top-left, optionally carrying a /Rotate. */
async function rotatedTextPdf(rotation: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([100, 200]);
  if (rotation !== 0) page.setRotation(degrees(rotation));
  page.drawText("Rotated text", { x: 10, y: 150, size: 14, font });
  return doc.save();
}

describe("desktop PDF engine host", () => {
  it("probes a real PDF into a view-safe page summary", async () => {
    const result = await handleDesktopEngineCall({ operation: "open", handle: "doc", args: { dataBase64: b64("pdf-text-editable.pdf") } });
    expect(result).toMatchObject({ ok: true, operation: "open" });
    if (!result.ok || result.operation !== "open") throw new Error("unreachable");
    expect(result.probe.pageCount).toBeGreaterThan(0);
    expect(result.probe.features.ocr).toBe(false);
  });

  it("reports per-page sizes in points so the renderer can lay out the right page box", async () => {
    const result = await handleDesktopEngineCall({ operation: "open", handle: "doc", args: { dataBase64: b64("pdf-text-editable.pdf") } });
    if (!result.ok || result.operation !== "open") throw new Error("unreachable");
    expect(result.pageSizes).toHaveLength(result.probe.pageCount);
    for (const size of result.pageSizes) {
      // A4 portrait: taller than wide, so the canvas does not draw a landscape box.
      expect(size.width).toBeCloseTo(595.28, 1);
      expect(size.height).toBeCloseTo(841.89, 1);
      expect(size.height).toBeGreaterThan(size.width);
    }
  });

  it("rasterises one page to a non-empty PNG at the requested scale", async () => {
    const result = await handleDesktopEngineCall({ operation: "render", handle: "doc", args: { dataBase64: b64("pdf-text-editable.pdf"), pageIndex: 0, scale: 1 } });
    if (!result.ok || result.operation !== "render") throw new Error("unreachable");
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(result.width);
    const png = Buffer.from(result.pngBase64, "base64");
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.byteLength).toBeGreaterThan(100);
  });

  it("refuses a render for an out-of-range page or a malformed request", async () => {
    await expect(handleDesktopEngineCall({ operation: "render", handle: "doc", args: { dataBase64: b64("pdf-text-editable.pdf"), pageIndex: 9, scale: 1 } })).rejects.toMatchObject({ name: "DesktopEngineCallError", code: "engine_render_unavailable" });
    await expect(handleDesktopEngineCall({ operation: "render", handle: "doc", args: { dataBase64: b64("pdf-text-editable.pdf"), pageIndex: 0 } })).rejects.toMatchObject({ name: "DesktopEngineCallError", code: "engine_input_missing" });
    await expect(handleDesktopEngineCall({ operation: "render", handle: "doc", args: { dataBase64: b64("pdf-text-editable.pdf"), pageIndex: 0, scale: 0 } })).rejects.toMatchObject({ name: "DesktopEngineCallError", code: "engine_input_missing" });
  });

  it("renders an encrypted page with the supplied password and answers a wall as typed data", async () => {
    await expect(handleDesktopEngineCall({ operation: "render", handle: "doc", args: { dataBase64: b64("pdf-password-4spaces.pdf"), pageIndex: 0, scale: 1 } })).resolves.toEqual({ ok: false, error: { kind: "password", status: "required" } });
    const opened = await handleDesktopEngineCall({ operation: "render", handle: "doc", args: { dataBase64: b64("pdf-password-4spaces.pdf"), pageIndex: 0, scale: 1, password: "    " } });
    expect(opened).toMatchObject({ ok: true, operation: "render" });
  });

  it("answers a password wall as typed data so it survives the IPC hop", async () => {
    await expect(handleDesktopEngineCall({ operation: "open", handle: "doc", args: { dataBase64: b64("pdf-password-4spaces.pdf") } })).resolves.toEqual({ ok: false, error: { kind: "password", status: "required" } });
  });

  it("opens an encrypted file with the supplied password and answers wrong as typed data", async () => {
    const opened = await handleDesktopEngineCall({ operation: "open", handle: "doc", args: { dataBase64: b64("pdf-password-4spaces.pdf"), password: "    " } });
    expect(opened).toMatchObject({ ok: true, operation: "open" });
    await expect(handleDesktopEngineCall({ operation: "open", handle: "doc", args: { dataBase64: b64("pdf-password-4spaces.pdf"), password: "nope" } })).resolves.toEqual({ ok: false, error: { kind: "password", status: "wrong" } });
  });

  it("refuses an unbound operation by name before reading the payload", async () => {
    await expect(handleDesktopEngineCall({ operation: "serialize", handle: "doc", args: {} })).rejects.toMatchObject({ name: "DesktopEngineCallError", code: "engine_operation_unsupported" });
    await expect(handleDesktopEngineCall({ operation: "cancel", handle: "doc", args: {} })).rejects.toMatchObject({ name: "DesktopEngineCallError", code: "engine_operation_unsupported" });
  });

  it("refuses a malformed edit payload instead of fabricating an empty batch", async () => {
    await expect(handleDesktopEngineCall({ operation: "edit", handle: "doc", args: { dataBase64: b64("pdf-text-editable.pdf"), edits: "not-an-array" } })).rejects.toMatchObject({ name: "DesktopEngineCallError", code: "engine_input_missing" });
  });

  it("applies one edit batch and returns the verified output bytes", async () => {
    const result = await handleDesktopEngineCall({ operation: "edit", handle: "doc", args: { dataBase64: b64("pdf-text-editable.pdf"), edits: [{ op: "deletePage", attributes: { pageIndex: 0 } }] } });
    if (!result.ok || result.operation !== "edit") throw new Error("unreachable");
    expect(result.report.pageOps.deletions).toBe(1);
    const reopened = await PDFDocument.load(Buffer.from(result.dataBase64, "base64"));
    expect(reopened.getPageCount()).toBe(1);
  });

  it("refuses a malformed call instead of fabricating a document", async () => {
    await expect(handleDesktopEngineCall({ operation: "open", handle: "doc", args: {} })).rejects.toBeInstanceOf(DesktopEngineCallError);
  });

  it("keeps the original bytes when an edit is refused", async () => {
    await expect(handleDesktopEngineCall({ operation: "edit", handle: "doc", args: { dataBase64: b64("pdf-password-4spaces.pdf"), edits: [] } })).rejects.toMatchObject({ name: "PdfTypedError", reason: "encrypted_pdf" });
  });
  const textCall = (name: string, extra: Record<string, unknown>) => handleDesktopEngineCall({ operation: "text", handle: "doc", args: { dataBase64: b64(name), ...extra } });

  it("reads a single page of text by default and skips char boxes unless geometry is asked for", async () => {
    const result = await textCall("pdf-table.pdf", { pageIndex: 0 });
    if (!result.ok || result.operation !== "text") throw new Error("unreachable");
    expect(result.pages[0]!.page).toBe(1);
    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.pages[0]!.text).toContain("Bao cao");
    expect(result.pages[0]!.charBoxes).toEqual([]);
  });

  it("returns display-space char boxes when geometry is on so desktop find can match", async () => {
    const result = await textCall("pdf-table.pdf", { pageIndex: 0, geometry: true });
    if (!result.ok || result.operation !== "text") throw new Error("unreachable");
    const page = result.pages[0]!;
    // One box per text character, so the find quad union stays aligned.
    expect(page.charBoxes).toHaveLength(page.text.length);
    for (const box of page.charBoxes) {
      expect(Number.isFinite(box.x)).toBe(true);
      expect(Number.isFinite(box.y)).toBe(true);
      expect(box.width).toBeGreaterThanOrEqual(0);
      expect(box.height).toBeGreaterThanOrEqual(0);
      expect(box.x).toBeGreaterThanOrEqual(-0.01);
      expect(box.y).toBeGreaterThanOrEqual(-0.01);
      expect(box.x + box.width).toBeLessThanOrEqual(page.width + 0.01);
      expect(box.y + box.height).toBeLessThanOrEqual(page.height + 0.01);
    }
    expect(page.charBoxes.filter((box) => box.width > 0).length).toBeGreaterThan(3);
  });

  it("refuses a text read with a missing, malformed or out-of-range page index", async () => {
    await expect(textCall("pdf-table.pdf", {})).rejects.toMatchObject({ name: "DesktopEngineCallError", code: "engine_input_missing" });
    await expect(textCall("pdf-table.pdf", { pageIndex: -1 })).rejects.toMatchObject({ code: "engine_input_missing" });
    await expect(textCall("pdf-table.pdf", { pageIndex: 1.5 })).rejects.toMatchObject({ code: "engine_input_missing" });
    await expect(textCall("pdf-table.pdf", { pageIndex: "0" })).rejects.toMatchObject({ code: "engine_input_missing" });
    await expect(textCall("pdf-table.pdf", { pageIndex: 999 })).rejects.toMatchObject({ name: "DesktopEngineCallError", code: "engine_text_unavailable" });
  });

  it("reads a bounded page range in order and clamps it at the last page", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let n = 1; n <= 5; n += 1) doc.addPage([100, 100]).drawText(`Page number ${n}`, { x: 5, y: 50, size: 10, font });
    const data = Buffer.from(await doc.save()).toString("base64");
    const read = async (args: Record<string, unknown>) => {
      const result = await handleDesktopEngineCall({ operation: "text", handle: "doc", args: { dataBase64: data, ...args } });
      if (!result.ok || result.operation !== "text") throw new Error("unreachable");
      return result;
    };
    const middle = await read({ pageIndex: 1, pageLimit: 3 });
    expect(middle.pageCount).toBe(5);
    expect(middle.pages.map((p) => p.page)).toEqual([2, 3, 4]);
    expect(middle.pages.map((p) => p.text)).toEqual(["Page number 2", "Page number 3", "Page number 4"]);
    expect(middle.pages.every((p) => p.charBoxes.length === 0)).toBe(true);
    const clamped = await read({ pageIndex: 3, pageLimit: 32, geometry: true });
    expect(clamped.pages.map((p) => p.page)).toEqual([4, 5]);
    for (const p of clamped.pages) expect(p.charBoxes).toHaveLength(p.text.length);
    expect((await read({ pageIndex: 4 })).pages.map((p) => p.page)).toEqual([5]);
  });

  it("refuses a pageLimit outside the integers 1..32", async () => {
    for (const pageLimit of [0, 33, 1.5, -1, "2"]) {
      await expect(textCall("pdf-table.pdf", { pageIndex: 0, pageLimit })).rejects.toMatchObject({ name: "DesktopEngineCallError", code: "engine_input_missing" });
    }
    await expect(textCall("pdf-table.pdf", { pageIndex: 0, pageLimit: 32 })).resolves.toMatchObject({ ok: true });
  });

  it.each([
    [90, "right"],
    [270, "left"],
  ] as const)("maps char boxes into display space on a /Rotate %i page", async (rotation, side) => {
    const bytes = Buffer.from(await rotatedTextPdf(rotation)).toString("base64");
    const result = await handleDesktopEngineCall({ operation: "text", handle: "doc", args: { dataBase64: bytes, pageIndex: 0, geometry: true } });
    if (!result.ok || result.operation !== "text") throw new Error("unreachable");
    expect(result.pages).toHaveLength(1);
    const page = result.pages[0]!;
    // A 100x200 page rotated a quarter turn displays as 200x100.
    expect(page.width).toBeCloseTo(200, 1);
    expect(page.height).toBeCloseTo(100, 1);
    expect(page.text).toContain("Rotated text");
    const boxes = page.charBoxes.filter((box) => box.width > 0);
    expect(boxes.length).toBeGreaterThan(3);
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(-0.01);
      expect(box.y).toBeGreaterThanOrEqual(-0.01);
      expect(box.x + box.width).toBeLessThanOrEqual(200.01);
      expect(box.y + box.height).toBeLessThanOrEqual(100.01);
    }
    // The line sits near the unrotated top-left. /Rotate 90 sends the unrotated
    // top to the display right; /Rotate 270 sends it to the display left.
    if (side === "right") expect(Math.min(...boxes.map((box) => box.x))).toBeGreaterThan(100);
    else expect(Math.max(...boxes.map((box) => box.x + box.width))).toBeLessThan(100);
  });

  it("fails loudly when the pdfium module lacks the rotation export", () => {
    expect(() => assertRotationAware({} as never)).toThrow("pdfium_export_missing: FPDFPage_GetRotation");
    expect(() => assertRotationAware({ _FPDFPage_GetRotation: () => 0 } as never)).not.toThrow();
  });

  it("answers a password wall on the text channel as typed data", async () => {
    await expect(handleDesktopEngineCall({ operation: "text", handle: "doc", args: { dataBase64: b64("pdf-password-4spaces.pdf"), pageIndex: 0 } })).resolves.toEqual({ ok: false, error: { kind: "password", status: "required" } });
  });
});

describe("desktop PDF engine host: retained documents", () => {
  const SESSION = "session_1234";
  let restoreBudget: (() => void) | null = null;
  afterEach(async () => {
    restoreBudget?.();
    restoreBudget = null;
    // Close whatever a test left so the next one starts from an empty store.
    for (let index = 0; index < 40; index += 1) await handleDesktopEngineCall({ operation: "close", handle: `doc-${index}`, sessionGeneration: SESSION, args: {} });
    await handleDesktopEngineCall({ operation: "close", handle: "doc", sessionGeneration: SESSION, args: {} });
  });

  const openRetained = async (handle: string, name = "pdf-text-editable.pdf", extra: Record<string, unknown> = {}, sessionGeneration = SESSION): Promise<string> => {
    const result = await handleDesktopEngineCall({ operation: "open", handle, sessionGeneration, args: { dataBase64: b64(name), retain: true, ...extra } });
    if (!result.ok || result.operation !== "open" || !result.pdfHandle) throw new Error("open did not retain");
    return result.pdfHandle;
  };

  it("does not retain an open that did not ask for it", async () => {
    const result = await handleDesktopEngineCall({ operation: "open", handle: "doc", sessionGeneration: SESSION, args: { dataBase64: b64("pdf-text-editable.pdf") } });
    expect(result).not.toHaveProperty("pdfHandle");
    expect(retainedPdfStatsForTests().documents).toBe(0);
  });

  it("renders and reads text by handle with no document bytes in the request", async () => {
    const pdfHandle = await openRetained("doc");
    const rendered = await handleDesktopEngineCall({ operation: "render", handle: "doc", sessionGeneration: SESSION, args: { pdfHandle, pageIndex: 0, scale: 1 } });
    expect(rendered).toMatchObject({ ok: true, operation: "render" });
    const text = await handleDesktopEngineCall({ operation: "text", handle: "doc", sessionGeneration: SESSION, args: { pdfHandle, pageIndex: 0 } });
    expect(text).toMatchObject({ ok: true, operation: "text" });
  });

  it("renders an encrypted document by handle with the password its open retained", async () => {
    const pdfHandle = await openRetained("doc", "pdf-password-4spaces.pdf", { password: "    " });
    expect(retainedPdfStatsForTests()).toMatchObject({ documents: 1, withPassword: 1 });
    const rendered = await handleDesktopEngineCall({ operation: "render", handle: "doc", sessionGeneration: SESSION, args: { pdfHandle, pageIndex: 0, scale: 1 } });
    expect(rendered).toMatchObject({ ok: true, operation: "render" });
  });

  it("never retains a document whose open hit the password wall", async () => {
    await expect(handleDesktopEngineCall({ operation: "open", handle: "doc", sessionGeneration: SESSION, args: { dataBase64: b64("pdf-password-4spaces.pdf"), retain: true } })).resolves.toEqual({ ok: false, error: { kind: "password", status: "required" } });
    expect(retainedPdfStatsForTests().documents).toBe(0);
  });

  it("answers an unknown handle as typed data", async () => {
    await expect(handleDesktopEngineCall({ operation: "render", handle: "doc", sessionGeneration: SESSION, args: { pdfHandle: "pdf_unknown", pageIndex: 0, scale: 1 } })).resolves.toEqual({ ok: false, error: { kind: "handle", status: "unknown" } });
    await expect(handleDesktopEngineCall({ operation: "text", handle: "doc", sessionGeneration: SESSION, args: { pdfHandle: "pdf_unknown", pageIndex: 0 } })).resolves.toEqual({ ok: false, error: { kind: "handle", status: "unknown" } });
  });

  it("refuses a handle presented by another document or another session", async () => {
    const pdfHandle = await openRetained("doc");
    const stale = { ok: false, error: { kind: "handle", status: "unknown" } };
    await expect(handleDesktopEngineCall({ operation: "render", handle: "doc-other", sessionGeneration: SESSION, args: { pdfHandle, pageIndex: 0, scale: 1 } })).resolves.toEqual(stale);
    await expect(handleDesktopEngineCall({ operation: "render", handle: "doc", sessionGeneration: "session_9999", args: { pdfHandle, pageIndex: 0, scale: 1 } })).resolves.toEqual(stale);
    // Another owner cannot close it either.
    await handleDesktopEngineCall({ operation: "close", handle: "doc-other", sessionGeneration: SESSION, args: { pdfHandle } });
    expect(retainedPdfStatsForTests().documents).toBe(1);
  });

  it("frees the document and its password on close, and a later render answers stale", async () => {
    const pdfHandle = await openRetained("doc", "pdf-password-4spaces.pdf", { password: "    " });
    await expect(handleDesktopEngineCall({ operation: "close", handle: "doc", sessionGeneration: SESSION, args: { pdfHandle } })).resolves.toEqual({ ok: true, operation: "close" });
    expect(retainedPdfStatsForTests()).toEqual({ documents: 0, bytes: 0, withPassword: 0 });
    await expect(handleDesktopEngineCall({ operation: "render", handle: "doc", sessionGeneration: SESSION, args: { pdfHandle, pageIndex: 0, scale: 1 } })).resolves.toEqual({ ok: false, error: { kind: "handle", status: "unknown" } });
  });

  it("keeps one live document per owner: a new retained open replaces the previous one", async () => {
    const first = await openRetained("doc");
    const second = await openRetained("doc");
    expect(second).not.toBe(first);
    expect(retainedPdfStatsForTests().documents).toBe(1);
    await expect(handleDesktopEngineCall({ operation: "render", handle: "doc", sessionGeneration: SESSION, args: { pdfHandle: first, pageIndex: 0, scale: 1 } })).resolves.toEqual({ ok: false, error: { kind: "handle", status: "unknown" } });
  });

  it("evicts the least recently used document past the count budget, password included", async () => {
    restoreBudget = setRetainedPdfBudgetForTests({ maxDocuments: 2, maxBytes: Number.MAX_SAFE_INTEGER });
    const first = await openRetained("doc-0", "pdf-password-4spaces.pdf", { password: "    " });
    const second = await openRetained("doc-1");
    // Touch the first so the second becomes the least recently used.
    await handleDesktopEngineCall({ operation: "render", handle: "doc-0", sessionGeneration: SESSION, args: { pdfHandle: first, pageIndex: 0, scale: 0.1 } });
    await openRetained("doc-2");
    expect(retainedPdfStatsForTests()).toMatchObject({ documents: 2, withPassword: 1 });
    await expect(handleDesktopEngineCall({ operation: "render", handle: "doc-1", sessionGeneration: SESSION, args: { pdfHandle: second, pageIndex: 0, scale: 0.1 } })).resolves.toEqual({ ok: false, error: { kind: "handle", status: "unknown" } });
    await openRetained("doc-3");
    // The encrypted document is now the oldest: it goes, and its password with it.
    expect(retainedPdfStatsForTests()).toMatchObject({ documents: 2, withPassword: 0 });
  });

  it("evicts past the byte budget but always keeps the newest document", async () => {
    const size = Buffer.from(b64("pdf-text-editable.pdf"), "base64").byteLength;
    restoreBudget = setRetainedPdfBudgetForTests({ maxDocuments: 10, maxBytes: size + 1 });
    const first = await openRetained("doc-0");
    await openRetained("doc-1");
    expect(retainedPdfStatsForTests()).toEqual({ documents: 1, bytes: size, withPassword: 0 });
    await expect(handleDesktopEngineCall({ operation: "render", handle: "doc-0", sessionGeneration: SESSION, args: { pdfHandle: first, pageIndex: 0, scale: 0.1 } })).resolves.toEqual({ ok: false, error: { kind: "handle", status: "unknown" } });
    restoreBudget();
    restoreBudget = setRetainedPdfBudgetForTests({ maxDocuments: 10, maxBytes: 1 });
    const kept = await openRetained("doc-2");
    expect(retainedPdfStatsForTests().documents).toBe(1);
    await expect(handleDesktopEngineCall({ operation: "render", handle: "doc-2", sessionGeneration: SESSION, args: { pdfHandle: kept, pageIndex: 0, scale: 0.1 } })).resolves.toMatchObject({ ok: true });
  });

  it("refuses a malformed handle instead of falling back to missing bytes", async () => {
    await expect(handleDesktopEngineCall({ operation: "render", handle: "doc", sessionGeneration: SESSION, args: { pdfHandle: 42, pageIndex: 0, scale: 1 } })).rejects.toMatchObject({ name: "DesktopEngineCallError", code: "engine_input_missing" });
  });
});
