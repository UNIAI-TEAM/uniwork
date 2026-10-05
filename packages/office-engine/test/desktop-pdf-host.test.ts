import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { DesktopEngineCallError, handleDesktopEngineCall } from "../src/desktop/pdf-host";

const FIXTURES = fileURLToPath(new URL("../../../docs/office/g0/fixtures/files/pdf/", import.meta.url));
const b64 = (name: string) => Buffer.from(readFileSync(FIXTURES + name)).toString("base64");

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
  it("returns per-page text and display-space char boxes so desktop find can match", async () => {
    const result = await handleDesktopEngineCall({ operation: "text", handle: "doc", args: { dataBase64: b64("pdf-table.pdf") } });
    if (!result.ok || result.operation !== "text") throw new Error("unreachable");
    expect(result.pages).toHaveLength(result.pageCount);
    const page = result.pages[0]!;
    expect(page.text).toContain("Bao cao");
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
    // The page has a real text layer: most glyphs carry a positive-width box.
    expect(page.charBoxes.filter((box) => box.width > 0).length).toBeGreaterThan(3);
  });

  it("answers a password wall on the text channel as typed data", async () => {
    await expect(handleDesktopEngineCall({ operation: "text", handle: "doc", args: { dataBase64: b64("pdf-password-4spaces.pdf") } })).resolves.toEqual({ ok: false, error: { kind: "password", status: "required" } });
  });
});
