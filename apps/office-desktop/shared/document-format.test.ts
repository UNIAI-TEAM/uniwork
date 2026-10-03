import { describe, expect, it } from "vitest";
import {
  DESKTOP_FORMAT_PROFILES,
  desktopDocumentFormats,
  extensionForFormat,
  formatFromFilename,
  formatFromMimeType,
  isDesktopDocumentFormat,
  isLocalDocumentFormat,
  mimeTypeForFormat,
} from "./document-format";

describe("desktop document format seam", () => {
  it("carries docx and xlsx today and extends by one table row", () => {
    expect([...desktopDocumentFormats]).toEqual(["docx", "xlsx"]);
    expect(DESKTOP_FORMAT_PROFILES.map((profile) => profile.format)).toEqual([...desktopDocumentFormats]);
    for (const profile of DESKTOP_FORMAT_PROFILES) {
      expect(mimeTypeForFormat(profile.format)).toBe(profile.mimeType);
      expect(extensionForFormat(profile.format)).toBe(profile.extension);
    }
  });

  it("narrows unknown format strings", () => {
    expect(isDesktopDocumentFormat("docx")).toBe(true);
    expect(isDesktopDocumentFormat("xlsx")).toBe(true);
    expect(isDesktopDocumentFormat("pptx")).toBe(false);
    expect(isDesktopDocumentFormat("pdf")).toBe(false);
    expect(isDesktopDocumentFormat("")).toBe(false);
  });

  it("opens only docx locally in C1a and reserves xlsx for the cloud lane", () => {
    expect(isLocalDocumentFormat("docx")).toBe(true);
    expect(isLocalDocumentFormat("xlsx")).toBe(false);
  });

  it("resolves a filename by extension case-insensitively and refuses unknown ones", () => {
    expect(formatFromFilename("Plan.DOCX")).toBe("docx");
    expect(formatFromFilename("budget.xlsx")).toBe("xlsx");
    expect(formatFromFilename("deck.pptx")).toBeUndefined();
    expect(formatFromFilename("no-extension")).toBeUndefined();
    expect(formatFromFilename("trailing.")).toBeUndefined();
  });

  it("resolves a server document by MIME first, then filename", () => {
    expect(formatFromMimeType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "row")).toBe("xlsx");
    expect(formatFromMimeType("application/octet-stream", "row.xlsx")).toBe("xlsx");
    expect(formatFromMimeType("", "row.docx")).toBe("docx");
    expect(formatFromMimeType("application/pdf", "row.pdf")).toBeUndefined();
    expect(formatFromMimeType(undefined, undefined)).toBeUndefined();
  });
});
