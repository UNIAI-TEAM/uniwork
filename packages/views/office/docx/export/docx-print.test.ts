import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOCX_PRINT_ATTRIBUTE,
  DOCX_PRINT_STYLE_ID,
  docxPrintStyleSheet,
  installDocxPrintStyles,
  printDocxDocument,
} from "./docx-print";

function mountSurface(): HTMLElement {
  const surface = document.createElement("div");
  surface.setAttribute("data-testid", "docx-document-surface");
  document.body.appendChild(surface);
  return surface;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.getElementById(DOCX_PRINT_STYLE_ID)?.remove();
  vi.restoreAllMocks();
});

describe("docxPrintStyleSheet", () => {
  it("hides UniWork chrome and isolates the document surface under the print marker", () => {
    const css = docxPrintStyleSheet();
    expect(css).toContain("@media print");
    expect(css).toContain(`body[${DOCX_PRINT_ATTRIBUTE}] [data-testid="docx-toolbar"]`);
    expect(css).toContain(`body[${DOCX_PRINT_ATTRIBUTE}] [data-testid="docx-status-bar"]`);
    expect(css).toContain(`body[${DOCX_PRINT_ATTRIBUTE}] * {`);
    expect(css).toContain("visibility: visible !important");
  });
});

describe("installDocxPrintStyles", () => {
  it("installs the sheet once per document", () => {
    installDocxPrintStyles();
    installDocxPrintStyles();
    expect(document.querySelectorAll(`#${DOCX_PRINT_STYLE_ID}`)).toHaveLength(1);
  });
});

describe("printDocxDocument", () => {
  it("refuses without a mounted document surface", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    expect(printDocxDocument()).toBe(false);
    expect(print).not.toHaveBeenCalled();
  });

  it("stamps the print marker, prints and clears it on afterprint", () => {
    mountSurface();
    let stampedDuringPrint = false;
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      stampedDuringPrint = document.body.hasAttribute(DOCX_PRINT_ATTRIBUTE);
    });
    expect(printDocxDocument()).toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
    expect(stampedDuringPrint).toBe(true);
    window.dispatchEvent(new Event("afterprint"));
    expect(document.body.hasAttribute(DOCX_PRINT_ATTRIBUTE)).toBe(false);
  });

  it("clears the marker and reports the refusal when the host cannot print", () => {
    mountSurface();
    vi.spyOn(window, "print").mockImplementation(() => {
      throw new Error("print_unavailable");
    });
    expect(printDocxDocument()).toBe(false);
    expect(document.body.hasAttribute(DOCX_PRINT_ATTRIBUTE)).toBe(false);
  });
});
