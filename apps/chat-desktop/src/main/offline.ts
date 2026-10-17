/**
 * The shell has no local renderer: when the web app cannot be reached the
 * window shows resources/offline.html and retries the app URL on a timer.
 * The offline page also retries itself on the browser `online` event.
 */

export const OFFLINE_RETRY_MS = 5000;

/** The slice of BrowserWindow this module touches — keeps it unit-testable. */
export interface OfflineWindow {
  webContents: {
    on(
      event: "did-fail-load",
      listener: (event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => void,
    ): unknown;
  };
  isDestroyed(): boolean;
  loadFile(path: string, options?: { query?: Record<string, string> }): Promise<void>;
  loadURL(url: string): Promise<void>;
}

const swallow = (): void => undefined;

export function installOfflineFallback(
  win: OfflineWindow,
  opts: { appUrl: string; offlinePath: string; retryMs?: number },
): void {
  const retryMs = opts.retryMs ?? OFFLINE_RETRY_MS;
  let retry: ReturnType<typeof setTimeout> | null = null;
  win.webContents.on("did-fail-load", (_event, errorCode, _description, validatedURL, isMainFrame) => {
    // -3 is ERR_ABORTED (a load superseded by another); a failing offline page must not loop.
    if (!isMainFrame || errorCode === -3 || validatedURL.startsWith("file:")) return;
    // The failure already arrived through this event; the load promises reject with the same thing.
    win.loadFile(opts.offlinePath, { query: { app: opts.appUrl } }).catch(swallow);
    if (retry) clearTimeout(retry);
    retry = setTimeout(() => {
      retry = null;
      if (!win.isDestroyed()) win.loadURL(opts.appUrl).catch(swallow);
    }, retryMs);
  });
}
