import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { brandIconPath, printWindowTitle } from "./branding";
import { clearPrintRoot, createPrintFileWriter, createPrintIpcHandler, installPrintSessionGuard, PRINT_PARTITION, type PrintOwner, type PrintWindow, type PrintWindowOptions } from "./print";

/**
 * The Electron wiring of `desktop:print-document` (moved out of
 * electron-main.ts, which stays the only module that imports Electron and
 * injects the pieces below).
 *
 * The print window is parented to the window that SENT the request, resolved
 * per request from the sender's webContents - the dispatcher admits only that
 * one sender - and never to a window captured at startup: a re-created or
 * destroyed app window then prints unparented instead of throwing.
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
  /** `new BrowserWindow(options)`: options are applied verbatim. */
  createWindow(options: PrintWindowOptions & { parent?: Owner; icon?: string }): PrintWindow;
  /** The built bundle directory (`dist`) the product icon is read from. */
  distDirectory: string;
  /** Overrides `process.platform` (tests). */
  platform?: NodeJS.Platform;
}

/** Guard the print partition, sweep jobs a previous process left behind, and
 * return the `desktop:print-document` handler for the host dispatcher. */
export async function createPrintHost<Owner extends PrintHostOwner>(options: PrintHostOptions<Owner>) {
  const printRoot = join(options.tempDirectory, "uniwork-print");
  installPrintSessionGuard(options.partitionSession(PRINT_PARTITION), pathToFileURL(printRoot).href);
  // A process that quit with a print dialog open never ran its cleanup.
  await clearPrintRoot(printRoot);
  return createPrintIpcHandler<Owner>({
    owner: () => {
      const sender = options.senderWindow();
      return sender && !sender.isDestroyed() ? sender : undefined;
    },
    // The print window is hidden, but Chromium still names the job and the
    // suggested PDF after its title: the document, else the product, never "Electron".
    createWindow: (windowOptions, owner) => {
      const branded = { ...windowOptions, title: printWindowTitle(windowOptions.title), icon: brandIconPath(options.platform ?? process.platform, options.distDirectory) };
      return options.createWindow(owner ? { ...branded, parent: owner } : branded);
    },
    writeFile: createPrintFileWriter(printRoot),
  });
}
