// The preload is an Electron-supplied bridge entry; it never imports the
// privileged main graph. Electron remains a devDependency supplied by the
// packaged runtime.
// eslint-disable-next-line import-x/no-extraneous-dependencies
import { contextBridge, ipcRenderer } from "electron";
import { DESKTOP_EVENTS, DESKTOP_IPC_CHANNELS, launchRequestedEventSchema, type DesktopIpcChannel, type DesktopIpcRequest, type LaunchRequestedEvent } from "../shared/ipc";

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
};

export function createPreloadBridge(ipcRenderer: IpcRendererAdapter): DesktopRendererBridge {
  return {
    channels: DESKTOP_IPC_CHANNELS,
    call(channel, payload) {
      if (!(DESKTOP_IPC_CHANNELS as readonly string[]).includes(channel)) return Promise.reject(new Error("IPC channel is not allowlisted"));
      return ipcRenderer.invoke(channel, payload);
    },
    onLaunchRequested(listener) {
      if (!ipcRenderer.on) return () => undefined;
      const handler = (...args: unknown[]) => {
        const payload = args.at(-1);
        const parsed = launchRequestedEventSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      };
      const eventChannel = "desktop:launch-requested";
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
