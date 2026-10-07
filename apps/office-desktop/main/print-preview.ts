import { PRINT_PREVIEW_MAX_BYTES, type DesktopPrinter, type DesktopPrintPreviewResponse, type DesktopPrintPrintersResponse } from "../shared/ipc-print";
import type { DesktopIpcRequest } from "../shared/ipc";
import { isPromptPort } from "./default-printer";
import { denyNavigation, PRINT_WINDOW_WEB_PREFERENCES, printFileName, printJobTitle, type PrintDocumentOptions, type PrintWindow, type PrintWindowOptions } from "./print";

/**
 * The in-app print dialog's two main-process halves (UNI-961): the preview PDF
 * and the printer list. The preview runs the SAME script-free copy through the
 * SAME hidden print window as `desktop:print-document` (same temp root, so the
 * print partition guard covers it; same web preferences; navigation denied) and
 * answers the laid-out PDF as bytes for the renderer's own PDF viewer. Nothing
 * here opens a dialog or touches the app window.
 */

/** The slice of the print window the preview and the PDF save add: `printToPDF` of the loaded copy. */
export type PreviewWindow = PrintWindow & {
  webContents: { printToPDF(options: ElectronPreviewOptions): Promise<Uint8Array> };
};

/** The slice of Electron's `PrintToPDFOptions` main ever passes. `pageSize` is in INCHES here
 * (unlike `webContents.print`, which takes microns). */
type ElectronPreviewOptions = { printBackground: true; landscape: boolean; preferCSSPageSize: true; pageSize: { width: number; height: number }; pageRanges?: string };

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

/** One copy to lay out: the sanitized HTML, the document's geometry (microns) and, for a
 * save, the 0-based inclusive page spans to keep. */
export interface PdfCopy {
  title: string;
  html: string;
  landscape: boolean;
  pageSize: { width: number; height: number };
  pageRanges?: ReadonlyArray<{ from: number; to: number }>;
}

/** Electron's `printToPDF` page filter: 1-based, "1-3, 5", built from 0-based inclusive spans. */
export function toElectronPageRanges(ranges: ReadonlyArray<{ from: number; to: number }>): string {
  return ranges.map(({ from, to }) => (from === to ? String(from + 1) : `${from + 1}-${to + 1}`)).join(", ");
}

export interface RenderCopyOptions {
  createWindow(options: PrintWindowOptions): PreviewWindow;
  writeFile: PrintDocumentOptions["writeFile"];
  timeoutMs: number;
}

/**
 * Lays one copy out as a PDF through the hidden print window (temp file under the print
 * root, script-free window, navigation denied) and answers its bytes or a typed reason:
 * `print_timeout` or `print_unavailable`. Never throws; the window is closed and the
 * temp file removed in every case. Shared by the preview and the PDF save.
 */
export async function renderCopyToPdf(options: RenderCopyOptions, copy: PdfCopy): Promise<{ pdf: Uint8Array } | { reason: "print_timeout" | "print_unavailable" }> {
  let file: Awaited<ReturnType<PrintDocumentOptions["writeFile"]>> | undefined;
  let window: PreviewWindow | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    file = await options.writeFile(copy.html, printFileName(copy.title));
    const created = options.createWindow({ show: false, skipTaskbar: true, title: printJobTitle(copy.title), webPreferences: PRINT_WINDOW_WEB_PREFERENCES });
    window = created;
    denyNavigation(created);
    await created.loadFile(file.path);
    const timedOut = new Promise<"timeout">((resolve) => { timer = setTimeout(() => { resolve("timeout"); }, options.timeoutMs); });
    // preferCSSPageSize: a section's own `@page` size in the copy (a Word section, a sheet,
    // a slide size) wins over the sheet below, which only fills in where the copy names none.
    const laidOut = created.webContents.printToPDF({
      printBackground: true,
      landscape: copy.landscape,
      preferCSSPageSize: true,
      pageSize: { width: copy.pageSize.width / MICRONS_PER_INCH, height: copy.pageSize.height / MICRONS_PER_INCH },
      ...(copy.pageRanges ? { pageRanges: toElectronPageRanges(copy.pageRanges) } : {}),
    });
    // A layout that loses the race is closed below; its late rejection must not go unhandled.
    laidOut.catch(() => undefined);
    const pdf = await Promise.race([laidOut, timedOut]);
    if (pdf === "timeout") return { reason: "print_timeout" };
    // An exact copy: Electron hands a pooled Buffer, whose view would carry unrelated pool memory.
    return { pdf: new Uint8Array(pdf) };
  } catch {
    return { reason: "print_unavailable" };
  } finally {
    clearTimeout(timer);
    try {
      if (window && !window.isDestroyed()) window.close();
    } catch {
      // A window that cannot close is already gone.
    }
    await file?.cleanup().catch(() => undefined);
  }
}

/** The main-side handler for `desktop:print-preview`. The dispatcher has already
 * checked sender, frame, origin, session and payload. One preview at a time;
 * never throws - every failure is a typed outcome. */
export function createPrintPreviewIpcHandler(options: PrintPreviewOptions) {
  let busy = false;
  const render = { createWindow: options.createWindow, writeFile: options.writeFile, timeoutMs: options.timeoutMs ?? PRINT_PREVIEW_TIMEOUT_MS };
  return {
    "desktop:print-preview": async (request: DesktopIpcRequest<"desktop:print-preview">): Promise<DesktopPrintPreviewResponse> => {
      if (busy) return { outcome: "failed", reason: "print_busy" };
      busy = true;
      try {
        const rendered = await renderCopyToPdf(render, { title: request.title, html: request.html, ...request.options });
        if ("reason" in rendered) return { outcome: "failed", reason: rendered.reason };
        if (rendered.pdf.byteLength > PRINT_PREVIEW_MAX_BYTES) return { outcome: "failed", reason: "print_preview_too_large" };
        return { outcome: "ready", pdf: rendered.pdf };
      } finally {
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
  /** The OS default printer's name when the list does not mark it: Electron 44
   * on Windows answers no `isDefault` and empty options (live probe, UNI-961). */
  defaultPrinter?(): Promise<string | undefined>;
  /** Printer name to queue port (Windows: `readWindowsPrinterPorts`). A printer on a
   * prompting port is flagged `needsSystemDialog`; no reader or no entry means false. */
  printerPorts?(): Promise<Map<string, string>>;
}

/** The main-side handler for `desktop:print-printers`: names only - never driver
 * options, descriptions or locations - at most 128 of them, each flagged when its
 * port would prompt a silent job. A failing port reader flags nothing. A printer service
 * that fails answers an empty list, the same as a machine with no printer. */
export function createPrintersIpcHandler(options: PrintersOptions) {
  return {
    "desktop:print-printers": async (_request: DesktopIpcRequest<"desktop:print-printers">): Promise<DesktopPrintPrintersResponse> => {
      try {
        const printers: DesktopPrinter[] = [];
        const fallbackDefault = await Promise.resolve().then(() => options.defaultPrinter?.()).catch(() => undefined);
        const ports = await Promise.resolve().then(() => options.printerPorts?.()).catch(() => undefined);
        for (const printer of await options.listPrinters()) {
          if (printers.length >= PRINTERS_MAX) break;
          if (typeof printer.name !== "string" || printer.name.length === 0 || printer.name.length > PRINTER_TEXT_MAX) continue;
          const displayName = typeof printer.displayName === "string" && printer.displayName.length > 0 ? printer.displayName.slice(0, PRINTER_TEXT_MAX) : printer.name;
          printers.push({ name: printer.name, displayName, isDefault: printer.isDefault === true || (fallbackDefault !== undefined && printer.name === fallbackDefault), needsSystemDialog: ports instanceof Map && isPromptPort(String(ports.get(printer.name) ?? "")) });
        }
        return { printers };
      } catch {
        return { printers: [] };
      }
    },
  };
}
