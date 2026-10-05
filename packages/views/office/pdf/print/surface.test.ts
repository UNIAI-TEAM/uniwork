import { afterEach, describe, expect, it } from "vitest";
import { markPdfPrintSurface, PDF_PRINT_ACTIVE_ATTRIBUTE, PDF_PRINT_ANCESTOR_ATTRIBUTE, PDF_PRINT_SURFACE_ATTRIBUTE } from "./surface";

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute(PDF_PRINT_ACTIVE_ATTRIBUTE);
});

describe("markPdfPrintSurface", () => {
  it("marks the surface and its ancestor chain under the document root, then cleans every mark", () => {
    document.body.innerHTML = '<div id="editor"><div id="scroller"><section id="surface"></section></div></div>';
    const surface = document.getElementById("surface");
    if (!surface) throw new Error("fixture missing");
    const cleanup = markPdfPrintSurface(surface);

    expect(document.documentElement.getAttribute(PDF_PRINT_ACTIVE_ATTRIBUTE)).toBe("");
    expect(surface.getAttribute(PDF_PRINT_SURFACE_ATTRIBUTE)).toBe("");
    expect(surface.hasAttribute(PDF_PRINT_ANCESTOR_ATTRIBUTE)).toBe(false);
    expect(document.getElementById("scroller")?.getAttribute(PDF_PRINT_ANCESTOR_ATTRIBUTE)).toBe("");
    expect(document.getElementById("editor")?.getAttribute(PDF_PRINT_ANCESTOR_ATTRIBUTE)).toBe("");
    expect(document.body.getAttribute(PDF_PRINT_ANCESTOR_ATTRIBUTE)).toBe("");

    cleanup();

    expect(document.documentElement.hasAttribute(PDF_PRINT_ACTIVE_ATTRIBUTE)).toBe(false);
    expect(surface.hasAttribute(PDF_PRINT_SURFACE_ATTRIBUTE)).toBe(false);
    expect(document.body.hasAttribute(PDF_PRINT_ANCESTOR_ATTRIBUTE)).toBe(false);
  });
});
