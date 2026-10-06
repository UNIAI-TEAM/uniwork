import i18n from "i18next";
import { expect, it } from "vitest";
import { DESKTOP_DOCUMENT_FORMATS } from "../shared/document-formats";
import { SUPPORTED_FORMAT_ORDER, supportedFormatsLabel } from "./supported-formats";

it("orders every format of the shared table exactly once", () => {
  expect([...SUPPORTED_FORMAT_ORDER].sort()).toEqual([...DESKTOP_DOCUMENT_FORMATS].sort());
});

it("names all six formats in the empty state and the unsupported toast alike", () => {
  const formats = supportedFormatsLabel("vi");
  for (const name of ["DOCX", "XLSX", "PPTX", "PDF", "Markdown", "HTML"]) expect(formats).toContain(name);
  for (const key of ["officeDesktop.local.emptyDescription", "officeDesktop.local.unsupported"]) {
    expect(i18n.t(key, { formats })).toContain(formats);
    expect(i18n.t(key, { formats })).not.toContain("{{");
  }
});
