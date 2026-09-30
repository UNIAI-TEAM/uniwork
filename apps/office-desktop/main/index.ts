import { DESKTOP_IDENTITY } from "../shared/identity";
import { createAuthIpcHandlers, createDiagnosticsIpcHandler, createDraftIpcHandlers, createFileIpcHandlers, createIpcDispatcher, type DraftIpcOptions, type FileIpcOptions, type IpcHandler, type DesktopIpcChannel, type IpcSenderContext } from "./ipc";
import { installNavigationGuards, openApprovedExternal } from "./navigation";
import { createDesktopRuntimeAdapters } from "./adapters";
import type { HostIpcPort } from "@uniwork/office-contracts";
import type { NativeLoginManager } from "./auth/manager";
import { launchRequestedEventSchema } from "../shared/ipc";
import { registerDeepLinkSystem, type DeepLinkRegistration, type DeepLinkSystem, type LaunchBridge } from "./deep-links";

export const WINDOW_WEB_PREFERENCES = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
} as const);

export type DesktopWindowAdapter = {
  webContents: Parameters<typeof installNavigationGuards>[0] & { send?(channel: string, payload: unknown): void };
  /** Native BrowserWindow construction must apply this exact policy. */
  webPreferences: typeof WINDOW_WEB_PREFERENCES;
  loadURL(url: string): Promise<void> | void;
  setUserDataDirectory(path: string): void;
  on?(event: "closed", listener: () => void): void;
};

export type DesktopHostOptions = {
  window: DesktopWindowAdapter;
  sender: IpcSenderContext;
  handlers?: Partial<{ [C in DesktopIpcChannel]: IpcHandler<C> }>;
  engineIpc?: HostIpcPort;
  allowedExternalHosts?: readonly string[];
  openSystemBrowser?: (url: string) => void;
  authManager?: NativeLoginManager;
  localFiles?: FileIpcOptions;
  drafts?: DraftIpcOptions;
  /** Electron app seams for the single-instance launch protocol. */
  deepLinks?: { system: DeepLinkSystem; bridge: LaunchBridge };
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
  options.window.on?.("closed", () => options.localFiles?.registry.revokeSession());
  options.window.setUserDataDirectory(process.env.UNIWORK_OFFICE_USER_DATA ?? DESKTOP_IDENTITY.devNamespace);
  const handlers = {
    ...options.handlers,
    "desktop:diagnostics": createDiagnosticsIpcHandler(),
    ...(options.authManager ? createAuthIpcHandlers(options.authManager) : {}),
    ...(options.localFiles ? createFileIpcHandlers(options.localFiles) : {}),
    ...(options.drafts ? createDraftIpcHandlers(options.drafts) : {}),
  };
  handlers["desktop:open-external"] ??= (request) => {
    openApprovedExternal(request.url, allowedExternalHosts, openSystemBrowser);
    return { opened: true };
  };
  const dispatch = createIpcDispatcher(handlers, { ...options.sender, allowedExternalHosts });
  let deepLinkRegistration: DeepLinkRegistration | undefined;
  if (options.deepLinks) {
    deepLinkRegistration = registerDeepLinkSystem(options.deepLinks.system, options.deepLinks.bridge);
    options.deepLinks.bridge.subscribe((event) => {
      // Validate in the main process immediately before crossing IPC. The
      // event intentionally contains no ticket, account, title or descriptor.
      const payload = launchRequestedEventSchema.parse(event);
      options.window.webContents.send?.("desktop:launch-requested", payload);
    });
  }
  return {
    identity: DESKTOP_IDENTITY,
    webPreferences: WINDOW_WEB_PREFERENCES,
    openApprovedExternal: (url: string) => openApprovedExternal(url, allowedExternalHosts, openSystemBrowser),
    dispatch,
    adapters: options.engineIpc ? createDesktopRuntimeAdapters(options.engineIpc) : undefined,
    deepLinkRegistration,
    async start(): Promise<void> {
      if (deepLinkRegistration && !deepLinkRegistration.primary) return;
      await options.window.loadURL(`${DESKTOP_IDENTITY.origin}/index.html`);
      if (deepLinkRegistration?.primary && options.deepLinks) await options.deepLinks.bridge.handleColdStart(process.argv);
    },
  };
}

/** Native Electron is intentionally injected. This keeps policy testable and
 * lets the dev bundle report its boot contract even on CI without a display. */
export function bootDevHost(): void {
  console.log(JSON.stringify({ event: "office-desktop-ready", appId: DESKTOP_IDENTITY.appId, mode: "unsigned-dev", renderer: "sandboxed" }));
}

if (process.argv[1]?.endsWith("index.mjs")) bootDevHost();
