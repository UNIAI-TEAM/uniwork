// The preload is an Electron-supplied bridge entry; it never imports the
// privileged main graph. Electron remains a devDependency supplied by the
// packaged runtime.
// eslint-disable-next-line import-x/no-extraneous-dependencies
import { contextBridge, ipcRenderer, webUtils } from "electron";
import { fileOpenRequestedSchema, leaveExpiredEventSchema, loginRequestedEventSchema, themeChangedEventSchema, type LeaveExpiredEvent, type ThemeChangedEvent } from "../shared/ipc";
import { DESKTOP_EVENTS, DESKTOP_IPC_CHANNELS, desktopSessionMetadataSchema, launchRequestedEventSchema, leaveRequestedEventSchema, officeSaveRequestedEventSchema, type DesktopIpcChannel, type DesktopIpcRequest, type DesktopSessionMetadata, type LaunchRequestedEvent, type LeaveRequestedEvent, type LoginRequestedEvent, type OfficeSaveRequestedEvent } from "../shared/ipc";

export type IpcRendererAdapter = {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  on?(channel: string, listener: (...args: unknown[]) => void): void;
  removeListener?(channel: string, listener: (...args: unknown[]) => void): void;
};
export type ContextBridgeAdapter = { exposeInMainWorld(name: string, value: unknown): void };

export type DesktopRendererBridge = {
  call<C extends DesktopIpcChannel>(channel: C, payload: DesktopIpcRequest<C>): Promise<unknown>;
  channels: readonly DesktopIpcChannel[];
  onLaunchRequested(listener: (event: LaunchRequestedEvent) => void): () => void;
  onOfficeSaveRequested(listener: (event: OfficeSaveRequestedEvent) => void): () => void;
  onSessionChanged(listener: (metadata: DesktopSessionMetadata) => void): () => void;
  onLeaveRequested(listener: (event: LeaveRequestedEvent) => void): () => void;
  onLeaveExpired(listener: (event: LeaveExpiredEvent) => void): () => void;
  openDroppedFile(file: File): Promise<unknown>;
  onFileOpenRequested(listener: (event: { handle: string }) => void): () => void;
  onLoginRequested(listener: (event: LoginRequestedEvent) => void): () => void;
  /** The OS switched between light and dark (main nativeTheme "updated"). */
  onThemeChanged(listener: (event: ThemeChangedEvent) => void): () => void;
};

export function createPreloadBridge(ipcRenderer: IpcRendererAdapter): DesktopRendererBridge {
  const pendingFiles: { handle: string }[] = [];
  let fileListener: ((event: { handle: string }) => void) | undefined;
  const pendingLaunches: LaunchRequestedEvent[] = [];
  let launchListener: ((event: LaunchRequestedEvent) => void) | undefined;
  let pendingLeave: LeaveRequestedEvent | undefined;
  let leaveListener: ((event: LeaveRequestedEvent) => void) | undefined;
  let leaveExpiredListener: ((event: LeaveExpiredEvent) => void) | undefined;
  let pendingLogin: LoginRequestedEvent | undefined;
  let loginListener: ((event: LoginRequestedEvent) => void) | undefined;
  ipcRenderer.on?.("desktop:login-requested", (...args: unknown[]) => {
    const parsed = loginRequestedEventSchema.safeParse(args.at(-1));
    if (!parsed.success) return;
    if (loginListener) loginListener(parsed.data);
    else pendingLogin = parsed.data;
  });
  ipcRenderer.on?.("desktop:leave-requested", (...args: unknown[]) => {
    const parsed = leaveRequestedEventSchema.safeParse(args.at(-1));
    if (!parsed.success) return;
    if (leaveListener) leaveListener(parsed.data);
    else pendingLeave = parsed.data;
  });
  ipcRenderer.on?.("desktop:leave-expired", (...args: unknown[]) => {
    const parsed = leaveExpiredEventSchema.safeParse(args.at(-1));
    if (!parsed.success) return;
    if (pendingLeave?.requestId === parsed.data.requestId) pendingLeave = undefined;
    leaveExpiredListener?.(parsed.data);
  });
  ipcRenderer.on?.("desktop:file-open-requested", (...args: unknown[]) => {
    const parsed = fileOpenRequestedSchema.safeParse(args.at(-1));
    if (!parsed.success) return;
    if (fileListener) fileListener(parsed.data); else pendingFiles.push(parsed.data);
  });
  ipcRenderer.on?.("desktop:launch-requested", (...args: unknown[]) => {
    const parsed = launchRequestedEventSchema.safeParse(args.at(-1));
    if (!parsed.success) return;
    if (launchListener) launchListener(parsed.data); else pendingLaunches.push(parsed.data);
  });
  return {
    openDroppedFile(file) {
      // This private invoke is intentionally absent from the renderer call
      // allowlist. Only Electron can extract the native path from a real File.
      const path = webUtils.getPathForFile(file);
      if (!path) return Promise.reject(new Error("invalid_file"));
      return ipcRenderer.invoke("desktop:native-drop-open", { path });
    },
    onFileOpenRequested(listener) {
      fileListener = listener;
      for (const event of pendingFiles.splice(0)) listener(event);
      return () => { if (fileListener === listener) fileListener = undefined; };
    },
    channels: DESKTOP_IPC_CHANNELS,
    call(channel, payload) {
      if (!(DESKTOP_IPC_CHANNELS as readonly string[]).includes(channel)) return Promise.reject(new Error("IPC channel is not allowlisted"));
      return ipcRenderer.invoke(channel, payload);
    },
    onLaunchRequested(listener) {
      launchListener = listener;
      for (const event of pendingLaunches.splice(0)) listener(event);
      return () => { if (launchListener === listener) launchListener = undefined; };
    },
    onSessionChanged(listener) {
      if (!ipcRenderer.on) return () => undefined;
      const handler = (...args: unknown[]) => {
        const parsed = desktopSessionMetadataSchema.safeParse(args.at(-1));
        if (parsed.success) listener(parsed.data);
      };
      const eventChannel = "desktop:auth-session-changed";
      if (!(DESKTOP_EVENTS as readonly string[]).includes(eventChannel)) return () => undefined;
      ipcRenderer.on(eventChannel, handler);
      return () => ipcRenderer.removeListener?.(eventChannel, handler);
    },
    onLeaveRequested(listener) {
      leaveListener = listener;
      if (pendingLeave) { const event = pendingLeave; pendingLeave = undefined; listener(event); }
      return () => { if (leaveListener === listener) leaveListener = undefined; };
    },
    onLeaveExpired(listener) {
      leaveExpiredListener = listener;
      return () => { if (leaveExpiredListener === listener) leaveExpiredListener = undefined; };
    },
    onLoginRequested(listener) {
      loginListener = listener;
      if (pendingLogin) { const event = pendingLogin; pendingLogin = undefined; listener(event); }
      return () => { if (loginListener === listener) loginListener = undefined; };
    },
    onThemeChanged(listener) {
      if (!ipcRenderer.on) return () => undefined;
      const handler = (...args: unknown[]) => {
        const parsed = themeChangedEventSchema.safeParse(args.at(-1));
        if (parsed.success) listener(parsed.data);
      };
      const eventChannel = "desktop:theme-changed";
      if (!(DESKTOP_EVENTS as readonly string[]).includes(eventChannel)) return () => undefined;
      ipcRenderer.on(eventChannel, handler);
      return () => ipcRenderer.removeListener?.(eventChannel, handler);
    },
    onOfficeSaveRequested(listener) {
      if (!ipcRenderer.on) return () => undefined;
      const handler = (...args: unknown[]) => {
        const parsed = officeSaveRequestedEventSchema.safeParse(args.at(-1));
        if (parsed.success) listener(parsed.data);
      };
      const eventChannel = "desktop:office-save-requested";
      if (!(DESKTOP_EVENTS as readonly string[]).includes(eventChannel)) return () => undefined;
      ipcRenderer.on(eventChannel, handler);
      return () => ipcRenderer.removeListener?.(eventChannel, handler);
    },
  };
}

export function exposePreloadBridge(contextBridge: ContextBridgeAdapter, ipcRenderer: IpcRendererAdapter): void {
  contextBridge.exposeInMainWorld("uniworkOffice", createPreloadBridge(ipcRenderer));
}

if (typeof process !== "undefined" && process.contextIsolated) exposePreloadBridge(contextBridge, ipcRenderer);
