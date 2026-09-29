import { DESKTOP_IDENTITY } from "../shared/identity";
import { createAuthIpcHandlers, createIpcDispatcher, type IpcHandler, type DesktopIpcChannel, type IpcSenderContext } from "./ipc";
import { installNavigationGuards, openApprovedExternal } from "./navigation";
import { createDesktopRuntimeAdapters } from "./adapters";
import type { HostIpcPort } from "@uniwork/office-contracts";
import type { NativeLoginManager } from "./auth/manager";

export const WINDOW_WEB_PREFERENCES = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
} as const);

export type DesktopWindowAdapter = {
  webContents: Parameters<typeof installNavigationGuards>[0];
  /** Native BrowserWindow construction must apply this exact policy. */
  webPreferences: typeof WINDOW_WEB_PREFERENCES;
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
  authManager?: NativeLoginManager;
};

/** Bootstrap shared engine/runtime/navigation/transport through host seams.
 * G4-03 (credentials), G4-04 (local I/O), and G4-05 (deep links) attach their
 * handlers here; no renderer authority is added by those modules. */
export function createDesktopHost(options: DesktopHostOptions) {
  for (const key of ["sandbox", "contextIsolation", "nodeIntegration"] as const) {
    if (options.window.webPreferences[key] !== WINDOW_WEB_PREFERENCES[key]) {
      throw new Error(`Desktop window preference ${key} does not match the secure host policy`);
    }
  }
  const allowedExternalHosts = options.allowedExternalHosts ?? [];
  const openSystemBrowser = options.openSystemBrowser ?? (() => undefined);
  installNavigationGuards(options.window.webContents, allowedExternalHosts, openSystemBrowser);
  options.window.setUserDataDirectory(process.env.UNIWORK_OFFICE_USER_DATA ?? DESKTOP_IDENTITY.devNamespace);
  const handlers = { ...options.handlers, ...(options.authManager ? createAuthIpcHandlers(options.authManager) : {}) };
  handlers["desktop:open-external"] ??= (request) => {
    openApprovedExternal(request.url, allowedExternalHosts, openSystemBrowser);
    return { opened: true };
  };
  const dispatch = createIpcDispatcher(handlers, { ...options.sender, allowedExternalHosts });
  return {
    identity: DESKTOP_IDENTITY,
    webPreferences: WINDOW_WEB_PREFERENCES,
    openApprovedExternal: (url: string) => openApprovedExternal(url, allowedExternalHosts, openSystemBrowser),
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
