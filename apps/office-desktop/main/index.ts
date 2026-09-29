import { DESKTOP_IDENTITY } from "../shared/identity";
import { createIpcDispatcher, type IpcHandler, type DesktopIpcChannel, type IpcSenderContext } from "./ipc";
import { installNavigationGuards } from "./navigation";
import { createDesktopRuntimeAdapters } from "./adapters";
import type { HostIpcPort } from "@uniwork/office-contracts";

export const WINDOW_WEB_PREFERENCES = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  enableRemoteModule: false,
} as const);

export type DesktopWindowAdapter = {
  webContents: Parameters<typeof installNavigationGuards>[0];
  loadURL(url: string): Promise<void> | void;
  setUserDataDirectory(path: string): void;
};

export type DesktopHostOptions = {
  window: DesktopWindowAdapter;
  sender: IpcSenderContext;
  handlers?: Partial<{ [C in DesktopIpcChannel]: IpcHandler<C> }>;
  engineIpc?: HostIpcPort;
  allowedExternalHosts?: readonly string[];
  openSystemBrowser?: (url: string) => void;
};

/** Bootstrap shared engine/runtime/navigation/transport through host seams.
 * G4-03 (credentials), G4-04 (local I/O), and G4-05 (deep links) attach their
 * handlers here; no renderer authority is added by those modules. */
export function createDesktopHost(options: DesktopHostOptions) {
  const allowedExternalHosts = options.allowedExternalHosts ?? [];
  const openSystemBrowser = options.openSystemBrowser ?? (() => undefined);
  installNavigationGuards(options.window.webContents, allowedExternalHosts, openSystemBrowser);
  options.window.setUserDataDirectory(process.env.UNIWORK_OFFICE_USER_DATA ?? DESKTOP_IDENTITY.devNamespace);
  const dispatch = createIpcDispatcher(options.handlers ?? {}, options.sender);
  return {
    identity: DESKTOP_IDENTITY,
    webPreferences: WINDOW_WEB_PREFERENCES,
    dispatch,
    adapters: options.engineIpc ? createDesktopRuntimeAdapters(options.engineIpc) : undefined,
    async start(): Promise<void> {
      await options.window.loadURL(`${DESKTOP_IDENTITY.origin}/index.html`);
    },
  };
}

/** Native Electron is intentionally injected. This keeps policy testable and
 * lets the dev bundle report its boot contract even on CI without a display. */
export function bootDevHost(): void {
  console.log(JSON.stringify({ event: "office-desktop-ready", appId: DESKTOP_IDENTITY.appId, mode: "unsigned-dev", renderer: "sandboxed" }));
}

if (process.argv[1]?.endsWith("index.mjs")) bootDevHost();
