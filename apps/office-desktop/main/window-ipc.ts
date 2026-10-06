import { isAbsolute } from "node:path";
import type { DraftSession } from "../../../packages/core/office/draft-recovery";
import { desktopDocumentFormatForName } from "../shared/document-formats";
import { DESKTOP_IPC_CHANNELS, desktopFileResponseSchema, type DesktopIpcChannel } from "../shared/ipc";
import type { FileHandleRegistry, OpenFileMetadata } from "./files/registry";
import { sameDocumentSession } from "./opened-documents";

export type WindowIpcOptions = {
  ipcMain: Pick<Electron.IpcMain, "handle">;
  app: Pick<Electron.App, "on">;
  window: Electron.BrowserWindow;
  dispatch: (channel: DesktopIpcChannel, payload: unknown) => unknown;
  fileRegistry: FileHandleRegistry;
  deviceScope: () => DraftSession;
  localOpenContext: (metadata: OpenFileMetadata) => void;
  /** Files the OS handed over before the window existed. */
  nativeFiles: string[];
  argv: readonly string[];
};

/** Bind the allowlisted channels to the one window and route OS file opens
 * (drop, second launch, macOS open-file) through the handle registry. */
export function registerWindowIpc(options: WindowIpcOptions): void {
  const { ipcMain, app, window, fileRegistry, deviceScope, localOpenContext } = options;
  for (const channel of DESKTOP_IPC_CHANNELS) {
    ipcMain.handle(channel, (event, payload) => {
      if (event.sender !== window.webContents) throw new Error("IPC sender is not the desktop window");
      return options.dispatch(channel, payload);
    });
  }
  ipcMain.handle("desktop:native-drop-open", async (event, payload: unknown) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("invalid_sender");
    if (!payload || typeof payload !== "object" || !("path" in payload) || typeof payload.path !== "string" || !isAbsolute(payload.path)) throw new Error("invalid_file");
    // A dropped file outside the shared format table never reaches the handle
    // registry: the renderer receives the same typed unsupported answer as a pick.
    if (!desktopDocumentFormatForName(payload.path)) return desktopFileResponseSchema.parse({ opened: false, unsupported: true });
    const session = deviceScope();
    const metadata = await fileRegistry.openEvent(payload.path);
    const bytes = await fileRegistry.read(metadata.handle);
    if (!sameDocumentSession(session, deviceScope())) throw new Error("session_revoked");
    localOpenContext(metadata);
    return desktopFileResponseSchema.parse({ opened: true, metadata, dataBase64: Buffer.from(bytes).toString("base64") });
  });
  const announceFile = async (path: string) => {
    if (!isAbsolute(path) || !desktopDocumentFormatForName(path)) return;
    try {
      const metadata = await fileRegistry.openEvent(path);
      window.webContents.send("desktop:file-open-requested", { handle: metadata.handle });
    } catch { /* Refused local files never cross the preload seam. */ }
  };
  app.on("second-instance", (_event, argv) => { for (const path of argv.filter((arg) => desktopDocumentFormatForName(arg))) void announceFile(path); });
  app.on("open-file", (_event, path) => { if (!window.webContents.isLoading()) void announceFile(path); });
  window.webContents.once("did-finish-load", () => { for (const path of [...options.nativeFiles.splice(0), ...options.argv.filter((arg) => desktopDocumentFormatForName(arg))]) void announceFile(path); });
}
