import { DESKTOP_IDENTITY, DESKTOP_IDENTITY_MANIFEST } from "../shared/identity";
import { createAuthIpcHandlers, createDiagnosticsIpcHandler, createDraftIpcHandlers, createFileIpcHandlers, createLocalIpcHandlers, createOfficeIpcHandlers, createIpcDispatcher, type OfficeIpcOptions, type DraftIpcOptions, type FileIpcOptions, type LocalIpcOptions, type IpcHandler, type DesktopIpcChannel, type IpcSenderContext } from "./ipc";
import { installNavigationGuards, openApprovedExternal } from "./navigation";
import { createDesktopRuntimeAdapters } from "./adapters";
import type { HostIpcPort } from "@uniwork/office-contracts";
import type { NativeLoginManager } from "./auth/manager";
import { createNoProfileAuthIpcHandlers } from "./auth/no-profile";
import { desktopDeploymentImportResponseSchema, desktopDeploymentResetResponseSchema, type NoDeploymentProfileReason } from "../shared/ipc-auth";
import type { ProfileImportFlow } from "./deployment/import-profile";
import { launchRequestedEventSchema, desktopSessionMetadataSchema, officeSaveRequestedEventSchema, type DesktopIpcRequest } from "../shared/ipc";
import { registerDeepLinkSystem, type DeepLinkRegistration, type DeepLinkSystem, type LaunchBridge } from "./deep-links";
import type { DeploymentProfile } from "../shared/deployment";
import { createDesktopLifecycleCoordinator, type DesktopLifecycleOptions } from "./lifecycle";
import { createLeaveIpcHandler, type DesktopLeaveCoordinator } from "./leave";
import { DesktopUpdateClient, type DesktopUpdateClientOptions } from "./updates/client";
import type { DesktopDraftStore, DraftKeyStore } from "./drafts/store";
import { createAppearanceIpcHandler, type AppearanceOptions } from "./appearance";

export { assertRecoveryActionAllowed, recoverDraft } from "./lifecycle";

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
  /** Native application menu seam. The handler is injected by Electron's
   * main entry and emits the same renderer Save action as Ctrl+S. */
  onNativeSave?(listener: () => void): void;
};

export type DesktopHostOptions = {
  window: DesktopWindowAdapter;
  sender: IpcSenderContext;
  handlers?: Partial<{ [C in DesktopIpcChannel]: IpcHandler<C> }>;
  engineIpc?: HostIpcPort;
  allowedExternalHosts?: readonly string[];
  openSystemBrowser?: (url: string) => void;
  authManager?: NativeLoginManager;
  /** Set when no usable deployment profile is installed: the auth channels stay registered and answer a typed no_deployment_profile state. */
  noDeploymentProfile?: NoDeploymentProfileReason;
  /** Main-owned "choose configuration file" and "reset connection" flows. */
  deploymentImport?: ProfileImportFlow;
  localFiles?: FileIpcOptions;
  drafts?: DraftIpcOptions;
  /** Device-scoped local-mode state and the encrypted recent-file list. */
  local?: LocalIpcOptions;
  /** Main-owned cloud Documents/Office transport. Renderer receives only
   * validated metadata and bounded document bytes. */
  office?: OfficeIpcOptions;
  /** One durable store shared by document IPC and native restart checkpoint. */
  draftStore?: DesktopDraftStore;
  /** One non-queueing leave decision used by close, logout and update. */
  leave?: DesktopLeaveCoordinator;
  /** Electron app seams for the single-instance launch protocol. */
  deepLinks?: { system: DeepLinkSystem; bridge: LaunchBridge };
  deploymentProfile?: DeploymentProfile;
  /** Resolved by the Electron entry; never read from process.env here. */
  userDataDirectory?: string;
  /** Shared OS-backed draft key port. The document-specific store is attached
   * by the editor host after a live account/base is known. */
  draftKeyStore?: DraftKeyStore;
  activeDocumentId?: () => string | undefined;
  /** Main-only installed release policy. No renderer or feed can supply trust. */
  updates?: DesktopUpdateClientOptions;
  /** OS theme and language the renderer starts from. */
  appearance?: AppearanceOptions;
};

function createDeploymentIpcHandlers(flow: ProfileImportFlow) {
  return {
    "desktop:deployment-import": async (_request: DesktopIpcRequest<"desktop:deployment-import">) => desktopDeploymentImportResponseSchema.parse(await flow.importProfile()),
    "desktop:deployment-reset": async (_request: DesktopIpcRequest<"desktop:deployment-reset">) => desktopDeploymentResetResponseSchema.parse(await flow.resetConnection()),
  };
}

function authCallbackFromArgv(argv: readonly unknown[]): string | undefined {
  const callbacks = Object.values(DESKTOP_IDENTITY_MANIFEST.channelProfiles).map((profile) => profile.authCallback);
  return argv.find((value): value is string => typeof value === "string" && callbacks.some((callback) => value.startsWith(callback)));
}

/** Bootstrap shared engine/runtime/navigation/transport through host seams.
 * G4-03 (credentials), G4-04 (local I/O), and G4-05 (deep links) attach their
 * handlers here; no renderer authority is added by those modules. */
export function createDesktopHost(options: DesktopHostOptions) {
  const draftStore = options.draftStore ?? options.drafts?.store;
  if (options.drafts && draftStore !== options.drafts.store) throw new Error("desktop draft services must share one store");
  if (options.updates?.restart && options.updates.restart.drafts !== draftStore) throw new Error("update checkpoint must use the desktop draft store");
  for (const key of ["sandbox", "contextIsolation", "nodeIntegration"] as const) {
    if (options.window.webPreferences[key] !== WINDOW_WEB_PREFERENCES[key]) {
      throw new Error(`Desktop window preference ${key} does not match the secure host policy`);
    }
  }
  const allowedExternalHosts = options.allowedExternalHosts ?? [];
  const openSystemBrowser = options.openSystemBrowser ?? (() => undefined);
  installNavigationGuards(options.window.webContents, allowedExternalHosts, openSystemBrowser);
  options.window.on?.("closed", () => {
    options.localFiles?.registry.revokeSession();
    options.drafts?.store.clearMemory();
  });
  options.window.setUserDataDirectory(options.userDataDirectory ?? DESKTOP_IDENTITY.userDataNamespace);
  const authHandlers = options.authManager ? createAuthIpcHandlers(options.authManager) : undefined;
  const noProfileHandlers = !authHandlers && options.noDeploymentProfile ? createNoProfileAuthIpcHandlers(options.noDeploymentProfile) : undefined;
  const handlers = {
    ...options.handlers,
    "desktop:diagnostics": createDiagnosticsIpcHandler(options.deploymentProfile),
    ...(authHandlers ?? noProfileHandlers ?? {}),
    ...(options.deploymentImport ? createDeploymentIpcHandlers(options.deploymentImport) : {}),
    ...(options.localFiles ? createFileIpcHandlers(options.localFiles) : {}),
    ...(options.drafts ? createDraftIpcHandlers(options.drafts) : {}),
    ...(options.local ? createLocalIpcHandlers(options.local) : {}),
    ...(options.office ? createOfficeIpcHandlers(options.office) : {}),
    ...(options.leave ? createLeaveIpcHandler(options.leave) : {}),
    ...(options.appearance ? createAppearanceIpcHandler(options.appearance) : {}),
  };
  if (authHandlers && options.deploymentImport) {
    const flow = options.deploymentImport;
    handlers["desktop:auth-config"] = (request: DesktopIpcRequest<"desktop:auth-config">) => ({ ...authHandlers["desktop:auth-config"](request), resettable: flow.isImported() });
  }
  if (noProfileHandlers && options.deploymentImport) {
    const flow = options.deploymentImport;
    handlers["desktop:auth-config"] = (request: DesktopIpcRequest<"desktop:auth-config">) => ({ ...noProfileHandlers["desktop:auth-config"](request), importable: flow.canImport() });
  }
  if (options.leave && options.authManager && authHandlers) {
    // Logout is a leave action like close and update: the ONE dialog decides
    // first, and only a proceeded answer drops the session. A refused or
    // unanswered dialog keeps the current metadata.
    handlers["desktop:auth-logout"] = async (request) => {
      const outcome = await options.leave!.request("logout");
      if (!outcome.proceeded) return desktopSessionMetadataSchema.parse(options.authManager!.getMetadata());
      return authHandlers["desktop:auth-logout"](request);
    };
  }
  options.window.onNativeSave?.(() => {
    const documentId = options.activeDocumentId?.();
    if (documentId) options.window.webContents.send?.("desktop:office-save-requested", officeSaveRequestedEventSchema.parse({ documentId }));
  });
  handlers["desktop:open-external"] ??= (request) => {
    openApprovedExternal(request.url, allowedExternalHosts, openSystemBrowser);
    return { opened: true };
  };
  const dispatch = createIpcDispatcher(handlers, { ...options.sender, allowedExternalHosts });
  let deepLinkRegistration: DeepLinkRegistration | undefined;
  if (options.deepLinks) {
    deepLinkRegistration = registerDeepLinkSystem(options.deepLinks.system, options.deepLinks.bridge, options.authManager ? (url) => options.authManager!.handleCallback(url) : undefined);
    options.deepLinks.bridge.subscribe((event) => {
      // Validate in the main process immediately before crossing IPC. The
      // event intentionally contains no ticket, account, title or descriptor.
      const payload = launchRequestedEventSchema.parse(event);
      options.window.webContents.send?.("desktop:launch-requested", payload);
    });
  }
  return {
    updates: new DesktopUpdateClient(options.updates),
    identity: DESKTOP_IDENTITY,
    webPreferences: WINDOW_WEB_PREFERENCES,
    openApprovedExternal: (url: string) => openApprovedExternal(url, allowedExternalHosts, openSystemBrowser),
    dispatch,
    adapters: options.engineIpc ? createDesktopRuntimeAdapters(options.engineIpc) : undefined,
    deepLinkRegistration,
    draftKeyStore: options.draftKeyStore,
    createLifecycleCoordinator: (lifecycle: DesktopLifecycleOptions) => createDesktopLifecycleCoordinator(lifecycle),
    async start(): Promise<void> {
      if (deepLinkRegistration && !deepLinkRegistration.primary) return;
      await options.window.loadURL(`${DESKTOP_IDENTITY.origin}/index.html`);
      if (deepLinkRegistration?.primary && options.deepLinks) {
        // A callback can be the first argv in a freshly launched process. It
        // belongs to the login manager, while document tickets belong to the
        // launch bridge; routing it here avoids treating auth state as a
        // document ticket.
        const authUrl = authCallbackFromArgv(process.argv);
        if (authUrl && options.authManager) await options.authManager.handleCallback(authUrl);
        else await options.deepLinks.bridge.handleColdStart(process.argv);
      }
    },
  };
}

/** Native Electron is intentionally injected. This keeps policy testable and
 * lets the dev bundle report its boot contract even on CI without a display. */
export function bootDevHost(): void {
  console.log(JSON.stringify({ event: "office-desktop-ready", appId: DESKTOP_IDENTITY.appId, mode: "unsigned-dev", renderer: "sandboxed" }));
}

if (process.argv[1]?.endsWith("index.mjs")) bootDevHost();
