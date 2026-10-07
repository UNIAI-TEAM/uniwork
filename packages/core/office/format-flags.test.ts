import { describe, expect, it } from "vitest";
import { officeFlagsAllow, officeFormatFlagKey } from "./format-flags";

describe("officeFormatFlagKey", () => {
  it("maps every editable format to its server flag", () => {
    expect(["docx", "xlsx", "pptx", "pdf", "md", "html"].map(officeFormatFlagKey)).toEqual([
      "office_docx",
      "office_xlsx",
      "office_pptx",
      "office_pdf",
      "office_markdown",
      "office_html",
    ]);
  });

  it("has no flag for an unknown format", () => {
    expect(officeFormatFlagKey("xls")).toBeNull();
    expect(officeFormatFlagKey("toString")).toBeNull();
    expect(officeFormatFlagKey(null)).toBeNull();
  });
});

describe("officeFlagsAllow", () => {
  it("needs the engine on and treats an absent format flag as on", () => {
    expect(officeFlagsAllow({ office_engine: true }, "docx")).toBe(true);
    expect(officeFlagsAllow({ office_engine: true, office_docx: false }, "docx")).toBe(false);
    expect(officeFlagsAllow({ office_engine: true, office_docx: false }, "pdf")).toBe(true);
    expect(officeFlagsAllow({ office_docx: true }, "docx")).toBe(false);
    expect(officeFlagsAllow({}, "docx")).toBe(false);
  });

  it("gates an unknown format on the engine alone", () => {
    expect(officeFlagsAllow({ office_engine: true }, "xls")).toBe(true);
    expect(officeFlagsAllow({ office_engine: false }, null)).toBe(false);
  });
});
