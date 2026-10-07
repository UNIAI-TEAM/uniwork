import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { brandIconPath, printWindowTitle } from "./branding";
import { clearPrintRoot, createPrintFileWriter, createPrintIpcHandler, installPrintSessionGuard, PRINT_PARTITION, type PrintOwner, type PrintWindowOptions } from "./print";
import { createPrintersIpcHandler, createPrintPreviewIpcHandler, type PreviewWindow, type PrintersOptions } from "./print-preview";
import { createPrintSavePdfIpcHandler, type PrintSavePdfOptions } from "./print-save-pdf";

/**
 * The Electron wiring of `desktop:print-document` (moved out of
 * electron-main.ts, which stays the only module that imports Electron and
 * injects the pieces below).
 *
 * The window that SENT the request is resolved per request from the sender's
 * webContents - the dispatcher admits only that one sender - and never
 * captured at startup. On Windows it only feeds the busy guard's focus signal:
 * the print window is never parented to it there (a parented one is cancelled
 * by the driver, visual-r1 M4, proven on Windows only). On macOS and Linux the
 * print window keeps its parent as before this lane touched it: nothing there
 * showed the parent to be wrong and nothing could be probed, so the sheet /
 * modal dialog on the app window stays. The hidden window is a window of its
 * own, so the host also destroys any live one when the app window closes or
 * the app quits (see `registerShutdown`).
 */

/** The slice of Electron's BrowserWindow the host needs from the sender. */
export type PrintHostOwner = PrintOwner & { isDestroyed(): boolean };

type RequestFilter = Parameters<Parameters<typeof installPrintSessionGuard>[0]["webRequest"]["onBeforeRequest"]>[0];

export interface PrintHostOptions<Owner extends PrintHostOwner> {
  /** `app.getPath("temp")`; jobs live under `<temp>/uniwork-print`. */
  tempDirectory: string;
  /** `session.fromPartition`, for the in-memory print partition. */
  partitionSession(partition: string): { webRequest: { onBeforeRequest(filter: RequestFilter): void } };
  /** The window whose webContents sent the request
   * (`BrowserWindow.fromWebContents`), or undefined when it is gone. */
  senderWindow(): Owner | null | undefined;
  /** `new BrowserWindow(options)`: options are applied verbatim. `parent` is set
   * only off Windows, and only when the sender window is still alive. */
  createWindow(options: PrintWindowOptions & { icon?: string; parent?: Owner }): PreviewWindow & { destroy(): void; once(event: "closed", listener: () => void): unknown };
  /** Registers the callback that runs when the app window closed or the app is
   * about to quit (electron-main: `window.once("closed")`, `app.once("before-quit")`).
   * It may run more than once. */
  registerShutdown(closeWindows: () => void): void;
  /** `webContents.getPrintersAsync()` of the app window, for the in-app print dialog. */
  listPrinters: PrintersOptions["listPrinters"];
  /** See {@link PrintersOptions.defaultPrinter}. */
  defaultPrinter?: PrintersOptions["defaultPrinter"];
  /** See {@link PrintersOptions.printerPorts}. */
  printerPorts?: PrintersOptions["printerPorts"];
  /** The save dialog of the in-app "Save as PDF" destination (electron-main: `dialog.showSaveDialog` on the app window). */
  chooseSavePath: PrintSavePdfOptions["chooseSavePath"];
  /** Writes the saved PDF to the path the user chose (electron-main: `fs.writeFile`). */
  writeOutput: PrintSavePdfOptions["writeOutput"];
  /** The built bundle directory (`dist`) the product icon is read from. */
  distDirectory: string;
  /** Overrides `process.platform` (tests). */
  platform?: NodeJS.Platform;
}

/** Guard the print partition, sweep jobs a previous process left behind, and
 * return the `desktop:print-document`, `desktop:print-preview`,
 * `desktop:print-printers` and `desktop:print-save-pdf` handlers for the host dispatcher. */
export async function createPrintHost<Owner extends PrintHostOwner>(options: PrintHostOptions<Owner>) {
  const printRoot = join(options.tempDirectory, "uniwork-print");
  installPrintSessionGuard(options.partitionSession(PRINT_PARTITION), pathToFileURL(printRoot).href);
  // A process that quit with a print dialog open never ran its cleanup.
  await clearPrintRoot(printRoot);
  const platform = options.platform ?? process.platform;
  // The unparented window outlives the app window it came from; without this the
  // process lingers (window-all-closed never fires) until the dialog is dismissed.
  // Only at close/quit: an open dialog is never touched while the app lives.
  const live = new Set<{ isDestroyed(): boolean; destroy(): void }>();
  options.registerShutdown(() => {
    for (const window of live) if (!window.isDestroyed()) window.destroy();
    live.clear();
  });
  const writeFile = createPrintFileWriter(printRoot);
  // The hidden window is branded the same for a print and a preview: Chromium names the job and the
  // suggested PDF after its title (the document, else the product, never "Electron"), and it is tracked
  // so quit and app-window close destroy it. `parent` is only ever passed for a print, never a preview.
  const brandedWindow = (windowOptions: PrintWindowOptions, owner?: Owner) => {
    const branded = { ...windowOptions, title: printWindowTitle(windowOptions.title), icon: brandIconPath(platform, options.distDirectory) };
    const created = options.createWindow(owner && platform !== "win32" ? { ...branded, parent: owner } : branded);
    live.add(created);
    // A window leaves the set the moment it closes, not at the next print.
    created.once("closed", () => { live.delete(created); });
    return created;
  };
  const print = createPrintIpcHandler<Owner>({
    // Windows: the dialog is not modal to the app window, so a click on it does not mean the dialog closed.
    ownerFocusEndsJob: platform === "win32" ? "after-callback-timeout" : "always",
    owner: () => {
      const sender = options.senderWindow();
      return sender && !sender.isDestroyed() ? sender : undefined;
    },
    createWindow: (windowOptions, owner) => brandedWindow(windowOptions, owner),
    writeFile,
  });
  return {
    ...print,
    ...createPrintPreviewIpcHandler({ createWindow: (windowOptions) => brandedWindow(windowOptions), writeFile }),
    ...createPrintersIpcHandler({ listPrinters: options.listPrinters, ...(options.defaultPrinter ? { defaultPrinter: options.defaultPrinter } : {}), ...(options.printerPorts ? { printerPorts: options.printerPorts } : {}) }),
    ...createPrintSavePdfIpcHandler({ createWindow: (windowOptions) => brandedWindow(windowOptions), writeFile, chooseSavePath: options.chooseSavePath, writeOutput: options.writeOutput }),
  };
}
