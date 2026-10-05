import { describe, expect, it } from "vitest";
import { DEFAULT_DESKTOP_DOCUMENT_FORMAT, DESKTOP_DOCUMENT_FORMATS, desktopDialogFilters, desktopDocumentFormatForMime, desktopDocumentFormatForName, desktopDocumentMimeTypes, desktopEngineBuild, desktopMimeTypeForFormat, desktopUntitledName, isDesktopDocumentFormat } from "./document-formats";
import { blankDocumentBytes, blankDocumentName } from "../main/files/blank-documents";

describe("desktop document format table", () => {
  it("resolves every format from its extension and MIME type", () => {
    expect(desktopDocumentFormatForName("Report.PDF")).toBe("pdf");
    expect(desktopDocumentFormatForName("Plan.docx")).toBe("docx");
    expect(desktopDocumentFormatForName("budget.XLSX")).toBe("xlsx");
    expect(desktopDocumentFormatForName("trailing.")).toBeUndefined();
    expect(desktopDocumentFormatForName("Deck.PPTX")).toBe("pptx");
    expect(desktopDocumentFormatForName("notes.txt")).toBeUndefined();
    expect(desktopDocumentFormatForMime("application/pdf; charset=binary")).toBe("pdf");
    expect(desktopDocumentFormatForMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("xlsx");
    expect(desktopDocumentFormatForMime("text/plain")).toBeUndefined();
  });

  it("resolves Markdown and HTML by every extension and MIME spelling", () => {
    expect(desktopDocumentFormatForName("README.md")).toBe("md");
    expect(desktopDocumentFormatForName("Ghi chú.MARKDOWN")).toBe("md");
    expect(desktopDocumentFormatForName("index.html")).toBe("html");
    expect(desktopDocumentFormatForName("Trang.HTM")).toBe("html");
    expect(desktopDocumentFormatForName("page.xhtml")).toBeUndefined();
    expect(desktopDocumentFormatForName("notes.mdx")).toBeUndefined();
    expect(desktopDocumentFormatForMime("text/markdown; charset=utf-8")).toBe("md");
    expect(desktopDocumentFormatForMime("text/x-markdown")).toBe("md");
    expect(desktopDocumentFormatForMime("TEXT/HTML")).toBe("html");
    expect(desktopDocumentFormatForMime("application/xhtml+xml")).toBeUndefined();
  });

  it("derives dialog filters, untitled names and MIME types from the table", () => {
    expect(desktopDialogFilters()).toEqual([
      { name: "Word", extensions: ["docx"] },
      { name: "PDF", extensions: ["pdf"] },
      { name: "Markdown", extensions: ["md", "markdown"] },
      { name: "HTML", extensions: ["html", "htm"] },
      { name: "Excel", extensions: ["xlsx"] },
      { name: "PowerPoint", extensions: ["pptx"] },
    ]);
    expect(desktopUntitledName("pdf")).toBe("Untitled.pdf");
    expect(desktopUntitledName("md")).toBe("Untitled.md");
    expect(desktopUntitledName("html")).toBe("Untitled.html");
    expect(desktopMimeTypeForFormat("pdf")).toBe("application/pdf");
    expect(desktopMimeTypeForFormat("md")).toBe("text/markdown");
    expect(desktopMimeTypeForFormat("html")).toBe("text/html");
    expect(desktopDocumentMimeTypes()).toEqual([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/pdf",
      "text/markdown",
      "text/x-markdown",
      "text/html",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]);
  });

  it("keeps the default format inside the table and stamps an engine build per format", () => {
    expect(DESKTOP_DOCUMENT_FORMATS).toContain(DEFAULT_DESKTOP_DOCUMENT_FORMAT);
    expect(isDesktopDocumentFormat("pdf")).toBe(true);
    expect(isDesktopDocumentFormat("md")).toBe(true);
    expect(isDesktopDocumentFormat("html")).toBe(true);
    expect(isDesktopDocumentFormat("markdown")).toBe(false);
    expect(isDesktopDocumentFormat("xlsx")).toBe(true);
    expect(isDesktopDocumentFormat("pptx")).toBe(true);
    for (const format of DESKTOP_DOCUMENT_FORMATS) expect(desktopEngineBuild(format).length).toBeGreaterThan(0);
  });

  it("creates a blank document for every format with a generator", () => {
    // XLSX and PPTX have no blank generator yet: creating one through IPC is refused.
    expect(() => blankDocumentBytes("xlsx")).toThrow("document_format_unbound");
    expect(() => blankDocumentBytes("pptx")).toThrow("document_format_unbound");
    for (const format of DESKTOP_DOCUMENT_FORMATS.filter((candidate) => candidate !== "xlsx" && candidate !== "pptx")) {
      expect(blankDocumentBytes(format)).toBeInstanceOf(Uint8Array);
      expect(blankDocumentName(format)).toBe(desktopUntitledName(format));
    }
    expect(blankDocumentBytes("md").byteLength).toBe(0);
    const html = new TextDecoder("utf-8", { fatal: true }).decode(blankDocumentBytes("html"));
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).not.toMatch(/<script/i);
  });
});
