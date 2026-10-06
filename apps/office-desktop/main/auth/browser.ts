export type SystemBrowserLauncher = Readonly<{ open(url: string): Promise<void> | void }>;

/** Adapter around Electron's shell.openExternal; the main process supplies the
 * implementation and the renderer never receives a browser handle. */
export function createSystemBrowserLauncher(openExternal: (url: string) => Promise<void> | void): SystemBrowserLauncher {
  return Object.freeze({ open: openExternal });
}

