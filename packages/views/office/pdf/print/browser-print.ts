import "./pdf-print.css";
import { markPdfPrintSurface } from "./surface";
import { PdfPrintError, type PdfPrintPort } from "./types";

export interface BrowserPdfPrintEnvironment {
  /** The window that owns the surface; defaults to the global window. */
  window?: Window;
}

function browserWindow(environment: BrowserPdfPrintEnvironment): Window | null {
  if (environment.window) return environment.window;
  return typeof window === "undefined" ? null : window;
}

/** Browser print of the document surface: the surface is scoped for the print
 * stylesheet, the native dialog renders it, and the scope comes down when the
 * dialog closes (window.print blocks for the dialog in every supported
 * browser, so cleanup can run right after the call returns). */
export function createBrowserPdfPrintPort(environment: BrowserPdfPrintEnvironment = {}): PdfPrintPort {
  return {
    printSurface(surface) {
      const win = browserWindow(environment);
      if (!win || typeof win.print !== "function") {
        throw new PdfPrintError("unavailable", "Browser print is unavailable");
      }
      const unmark = markPdfPrintSurface(surface);
      try {
        win.print();
      } catch (error) {
        throw new PdfPrintError("failed", error instanceof Error ? error.message : undefined);
      } finally {
        unmark();
      }
    },
  };
}
