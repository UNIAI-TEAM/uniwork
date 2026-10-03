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
    if (result.operation !== "open") throw new Error("unreachable");
    expect(result.probe.pageCount).toBeGreaterThan(0);
    expect(result.probe.features.ocr).toBe(false);
  });

  it("classifies an encrypted open without returning bytes", async () => {
    await expect(handleDesktopEngineCall({ operation: "open", handle: "doc", args: { dataBase64: b64("pdf-password-4spaces.pdf") } })).rejects.toMatchObject({ name: "PdfPasswordError", status: "required" });
  });

  it("applies one edit batch and returns the verified output bytes", async () => {
    const result = await handleDesktopEngineCall({ operation: "edit", handle: "doc", args: { dataBase64: b64("pdf-text-editable.pdf"), edits: [{ op: "deletePage", attributes: { pageIndex: 0 } }] } });
    if (result.operation !== "edit") throw new Error("unreachable");
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
});
