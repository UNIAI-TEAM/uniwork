import { describe, expect, it } from "vitest";
import { officeFormatFlagKey } from "./format-flags";

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
