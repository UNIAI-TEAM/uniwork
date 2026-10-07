import { PRINT_PREVIEW_MAX_BYTES, type DesktopPrinter, type DesktopPrintPreviewResponse, type DesktopPrintPrintersResponse } from "../shared/ipc-print";
import type { DesktopIpcRequest } from "../shared/ipc";
import { denyNavigation, PRINT_WINDOW_WEB_PREFERENCES, printFileName, printJobTitle, type PrintDocumentOptions, type PrintWindow, type PrintWindowOptions } from "./print";

/**
 * The in-app print dialog's two main-process halves (UNI-961): the preview PDF
 * and the printer list. The preview runs the SAME script-free copy through the
 * SAME hidden print window as `desktop:print-document` (same temp root, so the
 * print partition guard covers it; same web preferences; navigation denied) and
 * answers the laid-out PDF as bytes for the renderer's own PDF viewer. Nothing
 * here opens a dialog or touches the app window.
 */

/** The slice of the print window the preview adds: `printToPDF` of the loaded copy. */
export type PreviewWindow = PrintWindow & {
  webContents: { printToPDF(options: ElectronPreviewOptions): Promise<Uint8Array> };
};

/** The slice of Electron's `PrintToPDFOptions` main ever passes. `pageSize` is in INCHES here
 * (unlike `webContents.print`, which takes microns). */
type ElectronPreviewOptions = { printBackground: true; landscape: boolean; preferCSSPageSize: true; pageSize: { width: number; height: number } };

/** How long a preview may lay out before it answers `print_timeout`. A preview
 * has no dialog to wait for, so unlike a print its window is closed on the spot. */
export const PRINT_PREVIEW_TIMEOUT_MS = 60_000;

const MICRONS_PER_INCH = 25_400;

export interface PrintPreviewOptions {
  /** Builds the hidden print window; same contract as {@link PrintDocumentOptions.createWindow}
   * (never parented here, never a preload). */
  createWindow(options: PrintWindowOptions): PreviewWindow;
  /** Writes the copy under the same print root `desktop:print-document` uses. */
  writeFile: PrintDocumentOptions["writeFile"];
  /** Overrides {@link PRINT_PREVIEW_TIMEOUT_MS} (tests). */
  timeoutMs?: number;
}

const unavailable = { outcome: "failed", reason: "print_unavailable" } as const satisfies DesktopPrintPreviewResponse;

/** The main-side handler for `desktop:print-preview`. The dispatcher has already
 * checked sender, frame, origin, session and payload. One preview at a time;
 * never throws - every failure is a typed outcome. */
export function createPrintPreviewIpcHandler(options: PrintPreviewOptions) {
  let busy = false;
  const timeoutMs = options.timeoutMs ?? PRINT_PREVIEW_TIMEOUT_MS;
  return {
    "desktop:print-preview": async (request: DesktopIpcRequest<"desktop:print-preview">): Promise<DesktopPrintPreviewResponse> => {
      if (busy) return { outcome: "failed", reason: "print_busy" };
      busy = true;
      let file: Awaited<ReturnType<PrintDocumentOptions["writeFile"]>> | undefined;
      let window: PreviewWindow | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        file = await options.writeFile(request.html, printFileName(request.title));
        const created = options.createWindow({ show: false, skipTaskbar: true, title: printJobTitle(request.title), webPreferences: PRINT_WINDOW_WEB_PREFERENCES });
        window = created;
        denyNavigation(created);
        await created.loadFile(file.path);
        const timedOut = new Promise<"timeout">((resolve) => { timer = setTimeout(() => { resolve("timeout"); }, timeoutMs); });
        // preferCSSPageSize: a section's own `@page` size in the copy (a Word section, a sheet,
        // a slide size) wins over the sheet below, which only fills in where the copy names none.
        const laidOut = created.webContents.printToPDF({
          printBackground: true,
          landscape: request.options.landscape,
          preferCSSPageSize: true,
          pageSize: { width: request.options.pageSize.width / MICRONS_PER_INCH, height: request.options.pageSize.height / MICRONS_PER_INCH },
        });
        // A layout that loses the race is closed below; its late rejection must not go unhandled.
        laidOut.catch(() => undefined);
        const pdf = await Promise.race([laidOut, timedOut]);
        if (pdf === "timeout") return { outcome: "failed", reason: "print_timeout" };
        if (pdf.byteLength > PRINT_PREVIEW_MAX_BYTES) return { outcome: "failed", reason: "print_preview_too_large" };
        // An exact copy: Electron hands a pooled Buffer, whose view would carry unrelated pool memory.
        return { outcome: "ready", pdf: new Uint8Array(pdf) };
      } catch {
        return unavailable;
      } finally {
        clearTimeout(timer);
        try {
          if (window && !window.isDestroyed()) window.close();
        } catch {
          // A window that cannot close is already gone.
        }
        await file?.cleanup().catch(() => undefined);
        busy = false;
      }
    },
  };
}

/** Longest printer name or display name the wire carries (see `desktopPrinterSchema`). */
const PRINTER_TEXT_MAX = 256;
const PRINTERS_MAX = 128;

export interface PrintersOptions {
  /** `webContents.getPrintersAsync()`; only the three fields below are ever read. */
  listPrinters(): Promise<Array<{ name: string; displayName?: string; isDefault?: boolean }>>;
}

/** The main-side handler for `desktop:print-printers`: names only - never driver
 * options, descriptions or locations - at most 128 of them. A printer service
 * that fails answers an empty list, the same as a machine with no printer. */
export function createPrintersIpcHandler(options: PrintersOptions) {
  return {
    "desktop:print-printers": async (_request: DesktopIpcRequest<"desktop:print-printers">): Promise<DesktopPrintPrintersResponse> => {
      try {
        const printers: DesktopPrinter[] = [];
        for (const printer of await options.listPrinters()) {
          if (printers.length >= PRINTERS_MAX) break;
          if (typeof printer.name !== "string" || printer.name.length === 0 || printer.name.length > PRINTER_TEXT_MAX) continue;
          const displayName = typeof printer.displayName === "string" && printer.displayName.length > 0 ? printer.displayName.slice(0, PRINTER_TEXT_MAX) : printer.name;
          printers.push({ name: printer.name, displayName, isDefault: printer.isDefault === true });
        }
        return { printers };
      } catch {
        return { printers: [] };
      }
    },
  };
}
