import type { DesktopIpcRequest, DesktopPrintResponse } from "../shared/ipc";

/**
 * Desktop Markdown/HTML print (UNI-928). A print started from a sandboxed
 * iframe inside the app window never reaches Chromium's print surface under
 * Electron, so the renderer hands the SHARED sanitizer's copy to main over the
 * one typed `desktop:print-document` channel and main prints it from its own
 * hidden window. That window is never the app window: JavaScript off, sandbox
 * on, no preload, no Node, an in-memory partition whose requests are limited
 * to the print file itself and inline data, and no navigation or new window.
 * The copy keeps its own CSP meta, so the content policy also still applies.
 */

/** In-memory (no `persist:` prefix) session: no cookies, cache or app protocol. */
export const PRINT_PARTITION = "uniwork-print";

export const PRINT_WINDOW_WEB_PREFERENCES = Object.freeze({
  javascript: false,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false,
  webSecurity: true,
  webviewTag: false,
  spellcheck: false,
  partition: PRINT_PARTITION,
} as const);

export type PrintWindowOptions = Readonly<{ show: false; title: string; webPreferences: typeof PRINT_WINDOW_WEB_PREFERENCES }>;

type PreventableEvent = { preventDefault(): void };

/** The slice of Electron's BrowserWindow the print path uses. */
export type PrintWindow = {
  webContents: {
    setWindowOpenHandler(handler: () => { action: "deny" }): void;
    on(event: "will-navigate" | "will-redirect" | "will-frame-navigate" | "will-attach-webview", listener: (event: PreventableEvent) => void): void;
    print(options: { silent: boolean; printBackground: boolean }, callback: (success: boolean, failureReason: string) => void): void;
  };
  loadFile(path: string): Promise<void>;
  isDestroyed(): boolean;
  close(): void;
};

export type PrintFile = Readonly<{ path: string; cleanup(): Promise<void> }>;

export interface PrintDocumentOptions {
  /** Builds the hidden print window. It must apply the options verbatim and
   * never attach a preload; the Electron entry passes them to BrowserWindow. */
  createWindow(options: PrintWindowOptions): PrintWindow;
  /** Writes the copy to a private temporary file named after `fileName`.
   * Chromium names the print job after it when the copy carries no title. */
  writeFile(html: string, fileName: string): Promise<PrintFile>;
}

/** Map Electron's print callback onto the shared port outcomes. Electron
 * reports a dismissed dialog as `cancelled` (macOS: "Print job canceled"). */
export function printOutcome(success: boolean, failureReason: string | undefined): DesktopPrintResponse {
  if (success) return { outcome: "printed" };
  if (/cancel/i.test(failureReason ?? "")) return { outcome: "cancelled" };
  const reason = (failureReason ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
  return { outcome: "failed", reason: reason ? `print_${reason}`.slice(0, 64) : "print_failed" };
}

/** A file-system-safe job name derived from the document title. */
export function printFileName(title: string): string {
  const stem = title.replace(/\.(md|markdown|html?)$/i, "").replace(/[^\p{L}\p{N} ._-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80).replace(/^[ .]+|[ .]+$/g, "");
  return `${stem || "document"}.html`;
}

function denyNavigation(window: PrintWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const event of ["will-navigate", "will-redirect", "will-frame-navigate", "will-attach-webview"] as const) {
    window.webContents.on(event, (navigation) => navigation.preventDefault());
  }
}

/** The main-side handler for `desktop:print-document`. The dispatcher has
 * already checked sender, frame, origin, session, payload type and size. One
 * print at a time; never throws - every failure is a typed outcome. */
export function createPrintIpcHandler(options: PrintDocumentOptions) {
  let busy = false;
  return {
    "desktop:print-document": async (request: DesktopIpcRequest<"desktop:print-document">): Promise<DesktopPrintResponse> => {
      if (busy) return { outcome: "failed", reason: "print_busy" };
      busy = true;
      let file: PrintFile | undefined;
      let window: PrintWindow | undefined;
      try {
        file = await options.writeFile(request.html, printFileName(request.title));
        const created = options.createWindow({ show: false, title: request.title, webPreferences: PRINT_WINDOW_WEB_PREFERENCES });
        window = created;
        denyNavigation(created);
        await created.loadFile(file.path);
        return await new Promise<DesktopPrintResponse>((resolve) => {
          created.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => resolve(printOutcome(success, failureReason)));
        });
      } catch {
        return { outcome: "failed", reason: "print_unavailable" };
      } finally {
        if (window && !window.isDestroyed()) window.close();
        await file?.cleanup().catch(() => undefined);
        busy = false;
      }
    },
  };
}

type RequestFilter = (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void;

/** Limit the print partition to the print files and inline data. Anything
 * else (remote, app protocol, other local files) is cancelled even if a later
 * sanitizer regression let a reference through. */
export function installPrintSessionGuard(session: { webRequest: { onBeforeRequest(filter: RequestFilter): void } }, printRootUrl: string): void {
  const root = printRootUrl.endsWith("/") ? printRootUrl : `${printRootUrl}/`;
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !(details.url.startsWith(root) || details.url.startsWith("data:")) });
  });
}
