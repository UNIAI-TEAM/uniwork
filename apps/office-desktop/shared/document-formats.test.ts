import { describe, expect, it } from "vitest";
import { DEFAULT_DESKTOP_DOCUMENT_FORMAT, DESKTOP_DOCUMENT_FORMATS, desktopDialogFilters, desktopDocumentFormatForMime, desktopDocumentFormatForName, desktopDocumentMimeTypes, desktopEngineBuild, desktopMimeTypeForFormat, desktopUntitledName, isDesktopDocumentFormat } from "./document-formats";

describe("desktop document format table", () => {
  it("resolves every format from its extension and MIME type", () => {
    expect(desktopDocumentFormatForName("Report.PDF")).toBe("pdf");
    expect(desktopDocumentFormatForName("Plan.docx")).toBe("docx");
    expect(desktopDocumentFormatForName("budget.XLSX")).toBe("xlsx");
    expect(desktopDocumentFormatForName("deck.pptx")).toBeUndefined();
    expect(desktopDocumentFormatForName("trailing.")).toBeUndefined();
    expect(desktopDocumentFormatForName("notes.txt")).toBeUndefined();
    expect(desktopDocumentFormatForMime("application/pdf; charset=binary")).toBe("pdf");
    expect(desktopDocumentFormatForMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("xlsx");
    expect(desktopDocumentFormatForMime("text/plain")).toBeUndefined();
  });

  it("derives dialog filters, untitled names and MIME types from the table", () => {
    expect(desktopDialogFilters()).toEqual([
      { name: "Word", extensions: ["docx"] },
      { name: "PDF", extensions: ["pdf"] },
      { name: "Excel", extensions: ["xlsx"] },
    ]);
    expect(desktopUntitledName("pdf")).toBe("Untitled.pdf");
    expect(desktopMimeTypeForFormat("pdf")).toBe("application/pdf");
    expect(desktopDocumentMimeTypes()).toEqual([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]);
  });

  it("keeps the default format inside the table and stamps an engine build per format", () => {
    expect(DESKTOP_DOCUMENT_FORMATS).toContain(DEFAULT_DESKTOP_DOCUMENT_FORMAT);
    expect(isDesktopDocumentFormat("pdf")).toBe(true);
    expect(isDesktopDocumentFormat("xlsx")).toBe(true);
    expect(isDesktopDocumentFormat("pptx")).toBe(false);
    for (const format of DESKTOP_DOCUMENT_FORMATS) expect(desktopEngineBuild(format).length).toBeGreaterThan(0);
  });
});
