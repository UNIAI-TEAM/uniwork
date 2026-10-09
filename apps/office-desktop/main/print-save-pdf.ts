import type { DesktopIpcRequest, DesktopPrintSavePdfResponse } from "../shared/ipc";
import { printFileName } from "./print";
import { PRINT_PREVIEW_TIMEOUT_MS, renderCopyToPdf, type PrintPreviewOptions } from "./print-preview";

/**
 * The in-app print dialog's "Save as PDF" destination (UNI-961). The Windows
 * "Microsoft Print to PDF" queue prompts for a file name, which a silent print
 * cannot answer, so the PDF is made by the same `printToPDF` path as the preview
 * and written where the user picks in a save dialog MAIN opens: the renderer
 * never names a path.
 */

/** The suggested file name in the save dialog: the document's stem as a print job
 * names it (extension stripped, unsafe characters dropped) plus `.pdf`. */
export function printPdfFileName(title: string): string {
  return printFileName(title).replace(/\.html$/, ".pdf");
}

export interface PrintSavePdfOptions extends PrintPreviewOptions {
  /** The save dialog on the app window: the chosen path, or undefined when dismissed. */
  chooseSavePath(defaultName: string): Promise<string | undefined>;
  /** Writes the PDF bytes to the chosen path. */
  writeOutput(path: string, bytes: Uint8Array): Promise<void>;
}

/** The main-side handler for `desktop:print-save-pdf`. The path is asked FIRST: a
 * dismissed dialog costs nothing (no window, no layout). One save at a time -
 * the dialog counts - and never throws: every failure is a typed outcome. */
export function createPrintSavePdfIpcHandler(options: PrintSavePdfOptions) {
  let busy = false;
  const render = { createWindow: options.createWindow, writeFile: options.writeFile, timeoutMs: options.timeoutMs ?? PRINT_PREVIEW_TIMEOUT_MS };
  return {
    "desktop:print-save-pdf": async (request: DesktopIpcRequest<"desktop:print-save-pdf">): Promise<DesktopPrintSavePdfResponse> => {
      if (busy) return { outcome: "failed", reason: "print_busy" };
      busy = true;
      try {
        let path: string | undefined;
        try {
          path = await options.chooseSavePath(printPdfFileName(request.title));
        } catch {
          return { outcome: "failed", reason: "print_unavailable" };
        }
        if (path === undefined) return { outcome: "cancelled" };
        const rendered = await renderCopyToPdf(render, { title: request.title, html: request.html, ...request.options });
        if ("reason" in rendered) return { outcome: "failed", reason: rendered.reason };
        try {
          await options.writeOutput(path, rendered.pdf);
        } catch {
          return { outcome: "failed", reason: "print_save_failed" };
        }
        return { outcome: "saved" };
      } finally {
        busy = false;
      }
    },
  };
}
