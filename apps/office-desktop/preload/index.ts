import { DESKTOP_IPC_CHANNELS, type DesktopIpcChannel, type DesktopIpcRequest } from "../shared/ipc";

export type IpcRendererAdapter = { invoke(channel: string, payload: unknown): Promise<unknown> };
export type ContextBridgeAdapter = { exposeInMainWorld(name: string, value: unknown): void };

export type DesktopRendererBridge = {
  call<C extends DesktopIpcChannel>(channel: C, payload: DesktopIpcRequest<C>): Promise<unknown>;
  channels: readonly DesktopIpcChannel[];
};

export function createPreloadBridge(ipcRenderer: IpcRendererAdapter): DesktopRendererBridge {
  return {
    channels: DESKTOP_IPC_CHANNELS,
    call(channel, payload) {
      if (!(DESKTOP_IPC_CHANNELS as readonly string[]).includes(channel)) return Promise.reject(new Error("IPC channel is not allowlisted"));
      return ipcRenderer.invoke(channel, payload);
    },
  };
}

export function exposePreloadBridge(contextBridge: ContextBridgeAdapter, ipcRenderer: IpcRendererAdapter): void {
  contextBridge.exposeInMainWorld("uniworkOffice", createPreloadBridge(ipcRenderer));
}
