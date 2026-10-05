import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserPdfPrintPort } from "./browser-print";
import { PDF_PRINT_ACTIVE_ATTRIBUTE, PDF_PRINT_ANCESTOR_ATTRIBUTE, PDF_PRINT_SURFACE_ATTRIBUTE } from "./surface";
import { PdfPrintError } from "./types";

function fakeWindow(print?: () => void): Window {
  return (print ? { print } : {}) as unknown as Window;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute(PDF_PRINT_ACTIVE_ATTRIBUTE);
});

describe("createBrowserPdfPrintPort", () => {
  it("scopes the surface while the browser dialog prints and clears the scope afterwards", async () => {
    const surface = document.createElement("div");
    document.body.append(surface);
    const print = vi.fn(() => {
      expect(document.documentElement.hasAttribute(PDF_PRINT_ACTIVE_ATTRIBUTE)).toBe(true);
      expect(surface.hasAttribute(PDF_PRINT_SURFACE_ATTRIBUTE)).toBe(true);
    });

    await createBrowserPdfPrintPort({ window: fakeWindow(print) }).printSurface(surface);

    expect(print).toHaveBeenCalledTimes(1);
    expect(document.documentElement.hasAttribute(PDF_PRINT_ACTIVE_ATTRIBUTE)).toBe(false);
    expect(surface.hasAttribute(PDF_PRINT_SURFACE_ATTRIBUTE)).toBe(false);
    expect(document.body.hasAttribute(PDF_PRINT_ANCESTOR_ATTRIBUTE)).toBe(false);
  });

  it("reports an unavailable print API without touching the surface", async () => {
    const surface = document.createElement("div");
    document.body.append(surface);
    const port = createBrowserPdfPrintPort({ window: fakeWindow() });

    await expect(async () => port.printSurface(surface)).rejects.toBeInstanceOf(PdfPrintError);
    await expect(async () => port.printSurface(surface)).rejects.toMatchObject({ code: "unavailable" });
    expect(surface.hasAttribute(PDF_PRINT_SURFACE_ATTRIBUTE)).toBe(false);
  });

  it("wraps a dialog failure and still clears the print scope", async () => {
    const surface = document.createElement("div");
    document.body.append(surface);
    const print = vi.fn(() => {
      throw new Error("dialog crashed");
    });
    const port = createBrowserPdfPrintPort({ window: fakeWindow(print) });

    await expect(async () => port.printSurface(surface)).rejects.toBeInstanceOf(PdfPrintError);
    await expect(async () => port.printSurface(surface)).rejects.toMatchObject({ code: "failed" });
    expect(document.documentElement.hasAttribute(PDF_PRINT_ACTIVE_ATTRIBUTE)).toBe(false);
    expect(surface.hasAttribute(PDF_PRINT_SURFACE_ATTRIBUTE)).toBe(false);
  });
});
