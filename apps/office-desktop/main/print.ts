import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesktopIpcRequest, DesktopPrintOptions, DesktopPrintResponse } from "../shared/ipc";

/**
 * Desktop print for every Office format (UNI-928, UNI-952). A print started from a sandboxed
 * iframe inside the app window never reaches Chromium's print surface under
 * Electron, so the renderer hands the SHARED sanitizer's copy to main over the
 * one typed `desktop:print-document` channel and main prints it from its own
 * hidden window. That window is never the app window: JavaScript off, sandbox
 * on, no preload, no Node, an in-memory partition whose requests are limited
 * to the print file itself and inline data, and no navigation or new window.
 * The copy keeps its own CSP meta, so the content policy also still applies.
 */

/** Same stem as {@link printFileName} gives a document with no usable title. */
const PRINT_FALLBACK_TITLE = "document";

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

export type PrintWindowOptions = Readonly<{ show: false; skipTaskbar: true; title: string; webPreferences: typeof PRINT_WINDOW_WEB_PREFERENCES }>;

type PreventableEvent = { preventDefault(): void };

/** The slice of Electron's BrowserWindow the print path uses. */
export type PrintWindow = {
  webContents: {
    setWindowOpenHandler(handler: () => { action: "deny" }): void;
    on(event: "will-navigate" | "will-redirect" | "will-frame-navigate" | "will-attach-webview", listener: (event: PreventableEvent) => void): void;
    print(options: ElectronPrintOptions, callback: (success: boolean, failureReason: string) => void): void;
  };
  loadFile(path: string): Promise<void>;
  isDestroyed(): boolean;
  close(): void;
};

/** The slice of Electron's `WebContentsPrintOptions` main ever passes. */
type ElectronPrintOptions =
  | { silent: false; printBackground: true; landscape?: boolean; pageSize?: { width: number; height: number } }
  | {
    silent: true;
    printBackground: true;
    deviceName: string;
    landscape: boolean;
    pageSize: { width: number; height: number };
    copies?: number;
    pageRanges?: Array<{ from: number; to: number }>;
    color?: boolean;
    duplexMode?: "simplex" | "shortEdge" | "longEdge";
  };

/**
 * Map the validated request options onto `webContents.print`. Without `silent`
 * the system dialog always opens and opens in the document's orientation and
 * paper. With `silent` (the in-app print dialog, UNI-961) the job goes to the
 * named printer with the chosen job settings and no OS dialog; a setting the
 * user left alone is left out so Chromium keeps its own default. Each key is
 * copied by name, never a spread of the payload. No options (an older
 * renderer) keeps Chromium's plain dialog.
 */
export function electronPrintOptions(options: DesktopPrintOptions | undefined): ElectronPrintOptions {
  if (!options) return { silent: false, printBackground: true };
  const pageSize = { width: options.pageSize.width, height: options.pageSize.height };
  if (!options.silent || options.deviceName === undefined) return { silent: false, printBackground: true, landscape: options.landscape, pageSize };
  const job: Extract<ElectronPrintOptions, { silent: true }> = { silent: true, printBackground: true, deviceName: options.deviceName, landscape: options.landscape, pageSize };
  if (options.copies !== undefined) job.copies = options.copies;
  if (options.pageRanges !== undefined) job.pageRanges = options.pageRanges.map((range) => ({ from: range.from, to: range.to }));
  if (options.color !== undefined) job.color = options.color;
  if (options.duplexMode !== undefined) job.duplexMode = options.duplexMode;
  return job;
}

export type PrintFile = Readonly<{ path: string; cleanup(): Promise<void> }>;

/** The app window that asked for the print (not the dialog owner, see
 * {@link PrintDocumentOptions.createWindow}). A `blur` followed by a `focus`
 * is the only signal that the user left for the dialog and is back in the app
 * while Electron has not (yet) called back: a dialog Electron never reports as
 * closed would otherwise leave the busy flag set until restart. A focus with no
 * blur before it (the app window re-activating as the dialog appears) proves
 * nothing. Closing on a timeout would be wrong - the OS dialog may stay open
 * for as long as the user likes - so the guard never closes anything; see
 * {@link PRINT_CALLBACK_TIMEOUT_MS} for the bounded answer the renderer gets. */
export type PrintOwner = {
  on(event: "focus" | "blur", listener: () => void): unknown;
  removeListener(event: "focus" | "blur", listener: () => void): unknown;
};

/** How long the renderer waits for Electron's print callback. Past it the
 * request answers `print_timeout`, but the job is NOT released: its window,
 * file and busy flag stay until the callback finally arrives or the owner
 * regains focus (blur then focus), so an OS dialog that is still open is never
 * closed and a second dialog never opens over it. */
export const PRINT_CALLBACK_TIMEOUT_MS = 120_000;

export interface PrintDocumentOptions<Owner extends PrintOwner = PrintOwner> {
  /** The window that sent the request, resolved per request (never a window
   * captured at startup); see {@link PrintOwner}. Undefined when it is gone. */
  owner?(): Owner | undefined;
  /** Builds the hidden print window. It must apply the options verbatim and
   * never attach a preload. `owner` is the job's resolved sender window (or
   * undefined), handed over so the host can decide parenting; this module never
   * parents anything itself. The host does not parent on Windows: a print window
   * owned by the app window gets "Print job canceled" back from the dialog's
   * Print button, before the driver ever starts the job (no "Save Print Output
   * As" for Microsoft Print to PDF). */
  createWindow(options: PrintWindowOptions, owner: Owner | undefined): PrintWindow;
  /** What the owner's refocus proves. `always` (default): the dialog is modal to
   * the owner, so the user is back in the app only after it closed. `after-callback-timeout`:
   * the dialog is NOT modal to the owner (an unparented print window, Windows),
   * so clicking the app window while it is open proves nothing; only a refocus
   * seen once the renderer was already answered print_timeout frees a job whose
   * callback never came, and until then a second Print stays print_busy. */
  ownerFocusEndsJob?: "always" | "after-callback-timeout";
  /** Writes the copy to a private temporary file named after `fileName`.
   * Chromium names the print job after it when the copy carries no title. */
  writeFile(html: string, fileName: string): Promise<PrintFile>;
  /** Overrides {@link PRINT_CALLBACK_TIMEOUT_MS} (tests). */
  callbackTimeoutMs?: number;
}

/** Map Electron's print callback onto the shared port outcomes. Electron
 * reports a dismissed dialog as `cancelled` (macOS: "Print job canceled").
 * Windows answers "No preview available" when Chromium cannot build a preview
 * (no printer, or a copy it cannot lay out); that is a real failure the user
 * can act on (install a printer), so it stays `failed` with the code
 * `print_no_preview_available` and the renderer shows the generic action error -
 * there is no safe automatic retry, and the case needs a Windows print
 * environment to reproduce. */
export function printOutcome(success: boolean, failureReason: string | undefined): DesktopPrintResponse {
  if (success) return { outcome: "printed" };
  if (/cancel/i.test(failureReason ?? "")) return { outcome: "cancelled" };
  const reason = (failureReason ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
  return { outcome: "failed", reason: reason ? `print_${reason}`.slice(0, 64) : "print_failed" };
}

/** The title the print window and the copy carry: the document title, or the
 * file-name fallback when it is blank. An empty title would make Chromium name
 * the job (and the suggested PDF file) after the app, i.e. "Electron". */
export function printJobTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim() || PRINT_FALLBACK_TITLE;
}

/** A file-system-safe job name derived from the document title. */
export function printFileName(title: string): string {
  const stem = title.replace(/\.(md|markdown|html?|docx|xlsx|pptx|pdf)$/i, "").replace(/[^\p{L}\p{N} ._-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80).replace(/^[ .]+|[ .]+$/g, "");
  return `${stem || PRINT_FALLBACK_TITLE}.html`;
}

/** Shared with the print preview, which loads the same copy in the same kind of window. */
export function denyNavigation(window: PrintWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const event of ["will-navigate", "will-redirect", "will-frame-navigate", "will-attach-webview"] as const) {
    window.webContents.on(event, (navigation) => navigation.preventDefault());
  }
}

/** The print in flight. A job whose owner regained focus is superseded, not
 * cancelled: the next request may start while its callback is still pending,
 * and the old job then only cleans up after itself. */
type PrintJob = { sawBlur: boolean; ownerRefocused: boolean; timedOut: boolean; refocusHeld: boolean };

/** The main-side handler for `desktop:print-document`. The dispatcher has
 * already checked sender, frame, origin, session, payload type and size. One
 * print at a time; never throws - every failure is a typed outcome. */
export function createPrintIpcHandler<Owner extends PrintOwner>(options: PrintDocumentOptions<Owner>) {
  let active: PrintJob | undefined;
  // Closing a print window hands focus back to the owner; that focus belongs to
  // no job and must not mark the one whose dialog is open.
  let closing = 0;
  const closeWindow = (window: PrintWindow) => {
    closing += 1;
    try { window.close(); } finally { closing -= 1; }
    // A focus delivered after close() returns still follows no real blur.
    if (active) active.sawBlur = false;
  };
  const timeoutMs = options.callbackTimeoutMs ?? PRINT_CALLBACK_TIMEOUT_MS;
  const focusEndsJob = options.ownerFocusEndsJob ?? "always";
  return {
    "desktop:print-document": async (request: DesktopIpcRequest<"desktop:print-document">): Promise<DesktopPrintResponse> => {
      if (active && !active.ownerRefocused) return { outcome: "failed", reason: "print_busy" };
      const job: PrintJob = { sawBlur: false, ownerRefocused: false, timedOut: false, refocusHeld: false };
      active = job;
      // Resolved under its own guard below: the sender can be destroyed between
      // the dispatcher admitting it and this line, and resolving it may throw.
      let owner: Owner | undefined;
      const onBlur = () => { if (!closing) { job.sawBlur = true; job.refocusHeld = false; } };
      const supersede = () => { job.ownerRefocused = true; detach(); };
      // Once superseded the job needs no listener: detach at once, not at settle.
      const detach = () => {
        owner?.removeListener("focus", onFocus);
        owner?.removeListener("blur", onBlur);
      };
      function onFocus() {
        if (closing || !job.sawBlur) return;
        // An unparented dialog stays open beside a focused app window: hold the refocus until the timeout.
        if (focusEndsJob === "after-callback-timeout" && !job.timedOut) { job.refocusHeld = true; return; }
        supersede();
      }
      let file: PrintFile | undefined;
      let window: PrintWindow | undefined;
      // Runs once, when Electron answers (or the job never reached the dialog):
      // never on the timeout, which leaves an open dialog alone.
      const release = async () => {
        detach();
        if (window && !window.isDestroyed()) closeWindow(window);
        await file?.cleanup().catch(() => undefined);
        if (active === job) active = undefined;
      };
      // Fail closed: a sender that cannot be resolved prints nothing (a merely
      // missing or destroyed one answers undefined and prints with no focus guard).
      try {
        owner = options.owner?.();
      } catch {
        await release();
        return { outcome: "failed", reason: "print_owner_unavailable" };
      }
      let printing: Promise<DesktopPrintResponse>;
      try {
        file = await options.writeFile(request.html, printFileName(request.title));
        const created = options.createWindow({ show: false, skipTaskbar: true, title: printJobTitle(request.title), webPreferences: PRINT_WINDOW_WEB_PREFERENCES }, owner);
        window = created;
        denyNavigation(created);
        await created.loadFile(file.path);
        printing = new Promise<DesktopPrintResponse>((resolve) => {
          // Listen only once the dialog is about to open, so the focus that
          // returns to the app as the dialog appears does not count.
          owner?.on("blur", onBlur);
          owner?.on("focus", onFocus);
          created.webContents.print(electronPrintOptions(request.options), (success, failureReason) => resolve(printOutcome(success, failureReason)));
        });
      } catch {
        await release();
        return { outcome: "failed", reason: "print_unavailable" };
      }
      // A print() that throws never opened a dialog: release and answer typed.
      const settled = printing.catch((): DesktopPrintResponse => ({ outcome: "failed", reason: "print_unavailable" })).then(async (outcome) => { await release(); return outcome; });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<DesktopPrintResponse>((resolve) => {
        timer = setTimeout(() => {
          job.timedOut = true;
          // The user already came back to the app window while we waited: that refocus counts now.
          if (job.refocusHeld) supersede();
          resolve({ outcome: "failed", reason: "print_timeout" });
        }, timeoutMs);
      });
      try {
        return await Promise.race([settled, timedOut]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Each print gets its own private directory under `root`; the hidden window
 * loads only that file. A failed write removes the directory it made. */
export function createPrintFileWriter(root: string): PrintDocumentOptions["writeFile"] {
  return async (html, fileName) => {
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, "job-"));
    const path = join(directory, fileName);
    const cleanup = () => rm(directory, { recursive: true, force: true });
    try {
      await writeFile(path, html, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      await cleanup().catch(() => undefined);
      throw error;
    }
    return { path, cleanup };
  };
}

/** Remove jobs a previous process left behind (it quit with a dialog open).
 * The single-instance lock means no other process is printing from `root`. */
export async function clearPrintRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

type RequestFilter =(details: { url: string }, callback: (response: { cancel: boolean }) => void) => void;

/** Limit the print partition to the print files and inline data. Anything
 * else (remote, app protocol, other local files) is cancelled even if a later
 * sanitizer regression let a reference through. */
export function installPrintSessionGuard(session: { webRequest: { onBeforeRequest(filter: RequestFilter): void } }, printRootUrl: string): void {
  const root = printRootUrl.endsWith("/") ? printRootUrl : `${printRootUrl}/`;
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !(details.url.startsWith(root) || details.url.startsWith("data:")) });
  });
}
