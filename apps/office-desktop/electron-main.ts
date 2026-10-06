// Electron is supplied by electron-builder at runtime and intentionally stays
// a devDependency; this is the only privileged entry module that imports it.
// eslint-disable-next-line import-x/no-extraneous-dependencies
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, safeStorage, session, shell } from "electron";
import { existsSync } from "node:fs";
import { release as osRelease } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DESKTOP_IDENTITY, DESKTOP_IDENTITY_MANIFEST, getChannelIdentity } from "./shared/identity";
import { DESKTOP_IPC_CHANNELS, desktopSessionMetadataSchema, desktopFileResponseSchema } from "./shared/ipc";
import { desktopDialogFilters, desktopDocumentFormatForName } from "./shared/document-formats";
import { handleDesktopEngineCall, type DesktopEngineCall } from "@uniwork/office-engine/desktop";
import { createDesktopHost, WINDOW_WEB_PREFERENCES } from "./main/index";
import { createLocalXlsxEngine, resolveLocalXlsxAssetsDir } from "./main/xlsx-engine";
import { createHttpExchangePort, createLaunchBridge, type DeepLinkSystem } from "./main/deep-links";
import { evaluatePlatformGate, forcedPlatformGate, readLinuxOsRelease } from "./main/platform-gate";
import { registerAppImageScheme } from "./main/linux-desktop-integration";
import { resolveDeploymentProfile, type DeploymentProfile } from "./shared/deployment";
import { createSecureCredentialStore } from "./main/credentials/secure-store";
import { createSystemBrowserLauncher } from "./main/auth/browser";
import { NativeLoginManager } from "./main/auth/manager";
import { createHttpAuthTransport } from "./main/transport/auth-transport";
import { createHttpOfficeTransport } from "./main/transport/office-transport";
import { createSafeStorageDraftKeyStore } from "./main/drafts/keystore";
import { createDesktopDraftStore } from "./main/drafts/store";
import { createLiveDraftAccess } from "./main/drafts/live-access";
import { FileHandleRegistry, type OpenFileMetadata } from "./main/files/registry";
import { createProtectedFileCheckpoints, discardProtectedCheckpoint, localDraftBase, localDraftIdentity, type ProtectedCheckpointRef } from "./main/files/protected-files";
import { createNativeInstaller, createNativeUpdateAction } from "./main/updates/native";
import { createOfficeSaveGuard } from "../../packages/core/office/save-guard";
import { createDesktopLeaveCoordinator } from "./main/leave";
import { leaveExpiredEventSchema, leaveRequestedEventSchema, loginRequestedEventSchema } from "./shared/ipc";
import { createOpenedDocuments, sameDocumentSession } from "./main/opened-documents";
import { createDocumentLeaveEvidence } from "./main/document-leave";
import { deviceScopeAccountId, resolveLocalDevice, LocalDeviceError } from "./main/local/device";
import { createLocalModeStore } from "./main/local/mode";
import { createRecentFilesStore } from "./main/local/recent-files";
import { createPrintHost } from "./main/print-host";
import type { DraftIdentity, DraftSession } from "../../packages/core/office/draft-recovery";

const DIST_MAIN_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIRECTORY = resolve(DIST_MAIN_DIRECTORY, "../renderer");
const PRELOAD_PATH = resolve(DIST_MAIN_DIRECTORY, "../preload/index.cjs");
const SESSION_GENERATION = "desktop-dev-session";
const SMOKE_MODE = process.argv.includes("--office-desktop-smoke");
const nativeFiles: string[] = [];
app.on("open-file", (event, path) => { event.preventDefault(); nativeFiles.push(path); });

// macOS delivers a cold-start deep link through open-url, which can fire before
// the app is ready and the host has attached its handler. Queue those URLs at
// module load; the deep-link system drains them once it is registered.
const pendingOpenUrls: string[] = [];
let captureOpenUrls = true;
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (captureOpenUrls) pendingOpenUrls.push(url);
});

// A second launch (deep link from a browser/launcher) can arrive while the
// primary is still booting, before the host attaches its listener. Queue the
// command line at module load; the deep-link system drains it once registered.
const pendingSecondInstance: string[][] = [];
let captureSecondInstance = true;
app.on("second-instance", (_event, argv) => {
  if (captureSecondInstance) pendingSecondInstance.push([...argv]);
});

export const DESKTOP_TITLE_BAR_TOKENS = Object.freeze({
  // Electron requires literal colors. These mirror --muted and
  // --foreground in packages/ui/styles/tokens.css (:root and .dark).
  light: { color: "#f4f4f5", symbolColor: "#202020" },
  dark: { color: "#262626", symbolColor: "#f8f9fa" },
});

export function createNativeMenuTemplate(channel: "dev" | "beta" | "stable", onSave: () => void, isMac = process.platform === "darwin", onCheckUpdates?: () => void) {
  const fileLabel = isMac ? "Tệp" : "File";
  const editLabel = isMac ? "Sửa" : "Edit";
  const viewLabel = isMac ? "Xem" : "View";
  const helpLabel = isMac ? "Trợ giúp" : "Help";
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: fileLabel, submenu: [{ label: "Lưu", accelerator: "CmdOrCtrl+S", click: onSave }, { role: "quit", label: "Thoát" }] },
    { label: editLabel, submenu: [{ role: "undo", label: "Hoàn tác" }, { role: "redo", label: "Làm lại" }, { type: "separator" }, { role: "cut", label: "Cắt" }, { role: "copy", label: "Sao chép" }, { role: "paste", label: "Dán" }, { role: "selectAll", label: "Chọn tất cả" }] },
  ];
  if (channel === "dev") template.push({ label: viewLabel, submenu: [{ role: "reload", label: "Tải lại" }, { role: "toggleDevTools", label: "Công cụ phát triển" }] });
  if (onCheckUpdates) template.push({ label: helpLabel, submenu: [{ label: "Kiểm tra cập nhật…", click: onCheckUpdates }] });
  return template;
}

/** Smallest window the shell lays out without overlap: below it the tab strip
 * collides with its new-tab and overflow controls and the ribbon scrolls. */
export const DESKTOP_WINDOW_MIN_SIZE = { minWidth: 640, minHeight: 480 } as const;

export function nativeWindowOptions(platform: NodeJS.Platform, dark = false): Pick<Electron.BrowserWindowConstructorOptions, "titleBarStyle" | "titleBarOverlay"> {
  if (platform === "darwin") return {};
  const colors = dark ? DESKTOP_TITLE_BAR_TOKENS.dark : DESKTOP_TITLE_BAR_TOKENS.light;
  return { titleBarStyle: "hidden", titleBarOverlay: { color: colors.color, symbolColor: colors.symbolColor, height: 40 } };
}

// The renderer is loaded from the app's custom scheme. Mark it as a standard,
// secure, CORS-enabled scheme before Electron is ready so its module script
// can be fetched from the same origin in packaged builds.
protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_IDENTITY.appScheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

function inside(directory: string, file: string): boolean {
  const root = resolve(directory);
  const candidate = resolve(file);
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function installRendererProtocol(): void {
  protocol.handle(DESKTOP_IDENTITY.appScheme, (request) => {
    const requestUrl = new URL(request.url);
    const requestPath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const file = resolve(RENDERER_DIRECTORY, `.${requestPath}`);
    if (!inside(RENDERER_DIRECTORY, file) || !existsSync(file)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createDeepLinkSystem(): DeepLinkSystem {
  return {
    // The host already took the lock at bootstrap; report the held state so a
    // repeated call cannot be mistaken for a secondary instance.
    requestSingleInstanceLock: () => (typeof app.hasSingleInstanceLock === "function" ? app.hasSingleInstanceLock() : app.requestSingleInstanceLock()),
    registerProtocolClient: (scheme) => {
      if (process.platform === "win32" && app.isPackaged) app.setAsDefaultProtocolClient(scheme);
      else if (process.platform === "linux") {
        // A .deb registers the scheme from its .desktop MimeType postinst; an
        // AppImage registers itself on first run (registerAppImageScheme).
        // Both paths call this Electron helper too, best effort only.
        app.setAsDefaultProtocolClient(scheme);
      } else if (process.argv[1]) app.setAsDefaultProtocolClient(scheme, process.execPath, [resolve(process.argv[1])]);
      else app.setAsDefaultProtocolClient(scheme);
    },
    onSecondInstance: (listener) => {
      app.on("second-instance", (event, argv) => listener(event, argv));
    },
    onOpenUrl: (listener) => {
      app.on("open-url", (event, url) => listener(event, url));
    },
    takePendingOpenUrls: () => {
      captureOpenUrls = false;
      return pendingOpenUrls.splice(0);
    },
    takePendingSecondInstance: () => {
      captureSecondInstance = false;
      return pendingSecondInstance.splice(0);
    },
    quit: () => app.quit(),
  };
}

function createNoopLaunchBridge(deploymentId: string) {
  return createLaunchBridge({
    trustedDeploymentId: deploymentId,
    getSession: () => undefined,
    exchange: { exchange: async () => ({ kind: "refused", reason: "not_found" as const }) },
  });
}

async function runSmokeDiagnostics(window: BrowserWindow, deploymentProfile?: DeploymentProfile): Promise<void> {
  const result = await window.webContents.executeJavaScript(
    `window.uniworkOffice.call("desktop:diagnostics", ${JSON.stringify({ sessionGeneration: SESSION_GENERATION })})`,
    true,
  );
  if (!result || result.appId !== DESKTOP_IDENTITY.appId || result.channel !== DESKTOP_IDENTITY_MANIFEST.build.channel || result.buildId !== DESKTOP_IDENTITY_MANIFEST.build.buildId || (deploymentProfile && (result.deploymentId !== deploymentProfile.deploymentId || result.originHost !== new URL(deploymentProfile.apiOrigin).host))) {
    throw new Error("desktop launch smoke diagnostics did not match the accepted identity manifest");
  }
  process.stdout.write(`${JSON.stringify({ event: "office-desktop-smoke", readyToShow: true, diagnostics: result })}\n`);
}

/** Node exposes the runtime glibc through the diagnostic report header; absent
 * on musl or when the report is unavailable, in which case the gate cannot
 * refuse on glibc alone. */
export function runtimeGlibcVersion(): string | undefined {
  try {
    const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: unknown } } | undefined;
    const value = report?.header?.glibcVersionRuntime;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

async function startElectronHost(): Promise<void> {
  // A launch that cannot take the single-instance lock is a deep-link hand-off
  // (the running primary receives 'second-instance'). Exit before any window
  // exists: a renderer-less secondary would otherwise be held open by the
  // unsaved-work close guard and leave a second app process behind.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  // Minimum OS/architecture check before anything else: a wrong-machine install
  // shows one native error box and exits before a user-data path is created or
  // any file is written. The forced flag is a dev/smoke-only test seam.
  const gate = evaluatePlatformGate({
    platform: process.platform,
    arch: process.arch,
    release: osRelease(),
    systemVersion: typeof process.getSystemVersion === "function" ? process.getSystemVersion() : undefined,
    osRelease: process.platform === "linux" ? readLinuxOsRelease() : undefined,
    glibcVersion: process.platform === "linux" ? runtimeGlibcVersion() : undefined,
    forcedFailure: forcedPlatformGate(process.argv, { packaged: app.isPackaged, smokeMode: SMOKE_MODE }),
  });
  if (!gate.ok) {
    const failure = gate.failure;
    // The native error box needs the ready state on Linux (before it Electron
    // only writes to stderr). Nothing is created or written here: the user-data
    // path is never set and no window is made.
    await app.whenReady();
    dialog.showErrorBox("UniWork Office", `${failure.messageVi}\n\n${failure.messageEn}`);
    app.exit(1);
    return;
  }
  // An AppImage has no install step, so register the scheme from the running
  // AppImage on first launch (the .deb does this in its postinst).
  if (process.platform === "linux" && process.env.APPIMAGE) {
    try {
      registerAppImageScheme({
        appImagePath: process.env.APPIMAGE,
        desktopFileName: `${DESKTOP_IDENTITY.executable}.desktop`,
        productName: DESKTOP_IDENTITY_MANIFEST.product,
        scheme: DESKTOP_IDENTITY.userScheme,
        dataHomeDirectory: process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.length > 0 ? process.env.XDG_DATA_HOME : join(app.getPath("home"), ".local", "share"),
      });
    } catch { /* desktop integration is best effort; the app still runs */ }
  }
  // A packaged app never accepts a runtime environment override for its data
  // location. The smoke flag is an explicit local test seam and is the only
  // packaged exception; production profile binding remains download-time.
  const configuredUserData = (!app.isPackaged || SMOKE_MODE) ? process.env.UNIWORK_OFFICE_USER_DATA : undefined;
  // On Linux appData is the XDG config directory (~/.config), so the user data
  // root is ~/.config/<userDataNamespace>.
  const defaultUserData = join(app.getPath("appData"), DESKTOP_IDENTITY.userDataNamespace);
  app.setPath("userData", configuredUserData ? resolve(configuredUserData) : defaultUserData);
  app.setAppUserModelId(DESKTOP_IDENTITY.appId);
  const deploymentResolution = resolveDeploymentProfile({
    installedProfilePath: app.isPackaged ? join(process.resourcesPath, "deployment-profile.json") : undefined,
    userDataDirectory: app.getPath("userData"),
    buildChannel: DESKTOP_IDENTITY_MANIFEST.build.channel,
    env: app.isPackaged && !SMOKE_MODE ? {} : process.env,
  });
  const deploymentProfile = "kind" in deploymentResolution ? undefined : deploymentResolution;
  await app.whenReady();
  const draftKeyStore = createSafeStorageDraftKeyStore({
    userDataDirectory: app.getPath("userData"),
    channel: DESKTOP_IDENTITY_MANIFEST.build.channel,
    keyNamespace: DESKTOP_IDENTITY.keyNamespace,
    safeStorage,
  });
  const draftStore = createDesktopDraftStore({
    rootDirectory: join(app.getPath("userData"), "drafts"),
    tempDirectory: join(app.getPath("userData"), "draft-temp"),
    keyStore: draftKeyStore,
  });
  const saveGuard = createOfficeSaveGuard();
  const fileRegistry = new FileHandleRegistry({ sessionId: SESSION_GENERATION });
  // A corrupt device record never kills the host: local mode degrades to a
  // typed unavailable state while the record and its keys stay untouched.
  const deviceResolution = await resolveLocalDevice({ userDataDirectory: app.getPath("userData") });
  const deviceId = deviceResolution.deviceId;
  if (!deviceId) process.stderr.write(`office-desktop: local mode unavailable (${deviceResolution.error?.code ?? "unavailable"})\n`);
  const localMode = await createLocalModeStore({ userDataDirectory: app.getPath("userData") });
  const recentFiles = deviceId ? createRecentFilesStore({ userDataDirectory: app.getPath("userData"), keyStore: draftKeyStore, deviceId }) : undefined;
  let publishSessionMetadata: (metadata: unknown) => void = () => undefined;
  // One profile-bound credential store is shared by login and launch exchange.
  // The exchange adapter reads it only in the privileged main process; the
  // renderer receives a receipt and descriptor, never the access token.
  const credentials = deploymentProfile ? createSecureCredentialStore({
    userDataDirectory: app.getPath("userData"),
    channel: DESKTOP_IDENTITY_MANIFEST.build.channel,
    deploymentId: deploymentProfile.deploymentId,
    safeStorage,
  }) : undefined;
  const authManager = deploymentProfile && credentials ? new NativeLoginManager({
    clientId: deploymentProfile.clientId,
    deploymentId: deploymentProfile.deploymentId,
    redirectUri: getChannelIdentity(DESKTOP_IDENTITY_MANIFEST.build.channel).authCallback,
    allowLoopbackBrowserUrl: deploymentProfile.channel === "dev",
    browser: createSystemBrowserLauncher((url) => shell.openExternal(url)),
    transport: createHttpAuthTransport(deploymentProfile),
    credentials,
    onMetadata: (metadata) => publishSessionMetadata(metadata),
  }) : undefined;
  await authManager?.restore();
  installRendererProtocol();

  const window = new BrowserWindow({
    show: !SMOKE_MODE,
    ...DESKTOP_WINDOW_MIN_SIZE,
    webPreferences: {
      ...WINDOW_WEB_PREFERENCES,
      preload: PRELOAD_PATH,
    },
    ...nativeWindowOptions(process.platform, nativeTheme.shouldUseDarkColors),
  });
  if (process.platform !== "darwin") window.setMenuBarVisibility(false);
  let nativeSaveListener: (() => void) | undefined;
  // Local files always live under the stable `local:<device>` scope so their
  // protected drafts stay device-owned across sign-in and sign-out. Cloud work
  // belongs to the live account scope and is dropped when that scope changes.
  const deviceScope = (): DraftSession => {
    if (!deviceId) throw new LocalDeviceError("unavailable", "local mode is unavailable");
    return { sessionId: SESSION_GENERATION, accountId: deviceScopeAccountId(deviceId), deploymentId: "local-device", generation: 1 };
  };
  const accountScope = (): DraftSession => {
    const metadata = authManager?.getMetadata();
    const deploymentId = deploymentProfile?.deploymentId ?? "local-device";
    const accountId = metadata?.status === "signed-in" && metadata.accountId ? metadata.accountId : "signed-out";
    return { sessionId: SESSION_GENERATION, accountId, deploymentId, generation: authManager?.getGeneration() ?? 1 };
  };
  const protectFile = createProtectedFileCheckpoints({ store: draftStore, scope: deviceScope, identityFor: (handle) => fileRegistry.identityFor(handle) });
  const pendingLocalCheckpoints = new Map<string, ProtectedCheckpointRef>();
  const documents = createOpenedDocuments({ sessionFor: (kind) => kind === "local" ? (deviceId ? deviceScope() : undefined) : accountScope(), onClosed: (id) => {
    fileRegistry.revoke(id);
    pendingLocalCheckpoints.delete(id);
  } });
  const setLocalDocument = (metadata: OpenFileMetadata) => {
    if (documents.open(metadata.handle, "local", localDraftIdentity(deviceScope(), fileRegistry.identityFor(metadata.handle), metadata))) return;
    // A refused open leaves no context behind: release the freshly registered
    // handle instead of leaking it until the window closes.
    fileRegistry.revoke(metadata.handle);
    throw new Error("document_context_refused");
  };
  /** A local open only records the draft context; the durable row is written
   * immediately before a write, so a plain open never offers a draft of the
   * file's own unchanged bytes. Opening also refreshes the encrypted recent list. */
  const localOpenContext = (metadata: OpenFileMetadata) => {
    // A local open outside the shared format table is refused before it can
    // register a context or enter the recent list.
    if (!desktopDocumentFormatForName(metadata.name)) { fileRegistry.revoke(metadata.handle); return; }
    setLocalDocument(metadata);
    const path = fileRegistry.pathOf(metadata.handle);
    if (path && recentFiles) void recentFiles.record({ path, name: metadata.name, modifiedAtMs: metadata.modifiedAtMs }).catch(() => undefined);
  };
  const localCheckpoint = async (metadata: OpenFileMetadata, bytes: Uint8Array) => {
    if (!documents.context(metadata.handle)) throw new Error("document_context_refused");
    pendingLocalCheckpoints.set(metadata.handle, await protectFile(metadata, bytes));
  };
  /** After a confirmed write the pre-write checkpoint is obsolete: consume it so
   * an identical-bytes draft never becomes a stale conflict on the next open. */
  const consumeLocalCheckpoint = (metadata: Pick<OpenFileMetadata, "handle">) => {
    const ref = pendingLocalCheckpoints.get(metadata.handle);
    if (!ref) return;
    pendingLocalCheckpoints.delete(metadata.handle);
    void discardProtectedCheckpoint(draftStore, deviceScope(), ref).catch(() => undefined);
  };
  window.on("closed", () => { documents.clear(); });
  let documentSession = accountScope();
  publishSessionMetadata = (metadata) => {
    const parsed = desktopSessionMetadataSchema.parse(metadata);
    // Cloud contexts and handles belong only to the current account and session
    // generation; local-device documents and their handles survive both
    // sign-in and sign-out, so only the cloud scope is pruned here.
    const nextSession = accountScope();
    if (!sameDocumentSession(documentSession, nextSession)) {
      documents.synchronize();
      draftStore.clearMemory();
      organizationByWorkspace.clear();
      documentSession = nextSession;
    }
    window.webContents.send?.("desktop:auth-session-changed", parsed);
  };
  // Electron's main-frame invoke events use frame id 0. Keep this explicit so
  // the dispatcher binds the handler to the top-level window only.
  const frameId = 0;
  const launchBridge = deploymentProfile && credentials ? createLaunchBridge({
    clientId: deploymentProfile.clientId,
    trustedDeploymentId: deploymentProfile.deploymentId,
    exchange: createHttpExchangePort({ profile: deploymentProfile, credentials }),
    getSession: () => {
      try {
        // The production secure store is synchronous. Keep the interface
        // defensive if a future store implementation is asynchronous: an
        // unresolved credential read must prompt login, never race a ticket.
        const current = credentials.get();
        if (!current || typeof current !== "object" || "then" in current) return undefined;
        return { accountId: current.accountId, deploymentId: deploymentProfile.deploymentId, deviceSessionId: current.deviceSessionId };
      } catch {
        return undefined;
      }
    },
    // A web→desktop launch while signed out cannot show document metadata:
    // main asks the renderer for a sign-in instead, and the local home stays.
    onLoginRequired: (reason) => { window.webContents.send?.("desktop:login-requested", loginRequestedEventSchema.parse({ reason })); },
  }) : createNoopLaunchBridge(deploymentProfile?.deploymentId ?? DESKTOP_IDENTITY.appId);
  const organizationByWorkspace = new Map<string, string>();
  const officeTransport = deploymentProfile && credentials ? createHttpOfficeTransport({ profile: deploymentProfile, credentials, refreshSession: async () => {
    const session = await authManager?.refreshSession();
    if (session?.status !== "signed-in") throw new Error("login_required");
  } }) : undefined;
  // Workspace organization ids come from the authenticated main transport.
  // Browsing the library leaves every open document context intact.
  const cachedOfficeTransport = officeTransport ? { ...officeTransport, context: async () => {
    const session = accountScope();
    const context = await officeTransport.context();
    if (!sameDocumentSession(session, accountScope())) throw new Error("login_required");
    for (const workspace of context.workspaces) if (workspace.organizationId) organizationByWorkspace.set(workspace.id, workspace.organizationId);
    return context;
  } } : undefined;
  const cloudDraftIdentity = (document: { id: string; workspaceId: string; version: number; revision: string }): DraftIdentity | undefined => {
    if (!deploymentProfile) return undefined;
    const metadata = authManager?.getMetadata();
    const organizationId = organizationByWorkspace.get(document.workspaceId);
    if (metadata?.status !== "signed-in" || !metadata.accountId || !organizationId) return undefined;
    return { deploymentId: deploymentProfile.deploymentId, accountId: metadata.accountId, organizationId, workspaceId: document.workspaceId, documentId: document.id, base: { version: String(document.version), revision: document.revision } };
  };
  const liveDraftContext = (documentId: string): { session: DraftSession; identity: DraftIdentity } | undefined => documents.context(documentId);
  /** Cloud draft recovery must use a fresh detail ACL, because list summaries
   * deliberately omit my_level. The helper also rejects a tab/session switch
   * while the authenticated detail request is in flight. */
  const liveDraftAccess = (documentId: string): Promise<"edit" | "none"> => createLiveDraftAccess({
    context: () => {
      const active = documents.context(documentId);
      return active ? { kind: active.kind, session: active.session, identity: active.identity } : undefined;
    },
    readAccess: officeTransport?.readDocumentAccess,
  })();
  const noteConfirmedLocalSave = (metadata: OpenFileMetadata) => {
    // The write moved the file: its new bytes are the base later draft rows are
    // recorded against. The protective pre-write row is consumed by its own ref,
    // so rebasing the context does not strand it.
    if (!documents.context(metadata.handle)) setLocalDocument(metadata);
    else documents.rebase(metadata.handle, localDraftBase(metadata));
    consumeLocalCheckpoint(metadata);
  };
  const noteConfirmedLocalRebind = (previousHandle: string, metadata: OpenFileMetadata) => {
    consumeLocalCheckpoint({ handle: previousHandle });
    let rebound = false;
    try { rebound = documents.rebindLocal(previousHandle, metadata.handle, localDraftIdentity(deviceScope(), fileRegistry.identityFor(metadata.handle), metadata)); }
    catch { rebound = false; }
    if (!rebound) {
      // Fail closed: the renderer keeps its old tab identity, so the new
      // handle must not stay reachable in main.
      fileRegistry.revoke(metadata.handle);
      throw new Error("document_context_refused");
    }
    documents.noteConfirmedSave(metadata.handle);
    // The Save As target is a file the user chose to keep: it belongs in the
    // recent list beside every other opened file.
    const path = fileRegistry.pathOf(metadata.handle);
    if (path && recentFiles) void recentFiles.record({ path, name: metadata.name, modifiedAtMs: metadata.modifiedAtMs }).catch(() => undefined);
  };
  const leaveEvidence = createDocumentLeaveEvidence({ documents, store: draftStore, saveBusy: () => saveGuard.busy });
  const leave = createDesktopLeaveCoordinator({
    send: (request) => { leaveEvidence.capture(request.reason); window.webContents.send("desktop:leave-requested", leaveRequestedEventSchema.parse(request)); },
    ...leaveEvidence,
    timeoutMs: 30_000,
    onTimeout: (requestId) => { window.webContents.send("desktop:leave-expired", leaveExpiredEventSchema.parse({ requestId })); },
  });
  let closeApproved = false;
  window.on("close", (event) => {
    if (closeApproved || SMOKE_MODE) return;
    event.preventDefault();
    void leave.request("close").then((outcome) => {
      if (!outcome.proceeded) return;
      closeApproved = true;
      window.close();
    });
  });
  const printHandlers = await createPrintHost({ tempDirectory: app.getPath("temp"), partitionSession: (partition) => session.fromPartition(partition), senderWindow: () => BrowserWindow.fromWebContents(window.webContents), createWindow: (options) => new BrowserWindow(options) });
  const host = createDesktopHost({
    handlers: { "desktop:engine-call": (request) => handleDesktopEngineCall({ operation: request.operation, handle: request.handle, args: { dataBase64: request.args.dataBase64, edits: request.args.edits, password: request.args.password, pageIndex: request.args.pageIndex, pageLimit: request.args.pageLimit, geometry: request.args.geometry, scale: request.args.scale } } satisfies DesktopEngineCall), "desktop:window-theme": (request) => {
      if (process.platform !== "darwin") window.setTitleBarOverlay({ ...DESKTOP_TITLE_BAR_TOKENS[request.dark ? "dark" : "light"], height: 40 });
      return { applied: true };
    }, "desktop:tabs-update": (request) => ({ updated: documents.update(request) }), ...printHandlers },
    window: {
      webContents: window.webContents,
      webPreferences: WINDOW_WEB_PREFERENCES,
      loadURL: (url) => window.loadURL(url),
      setUserDataDirectory: (value) => app.setPath("userData", resolve(value)),
      on: (event, listener) => window.on(event, listener),
      onNativeSave: (listener) => { nativeSaveListener = listener; },
    },
    sender: {
      senderId: window.webContents.id,
      frameId,
      origin: DESKTOP_IDENTITY.origin,
      expectedSenderId: window.webContents.id,
      expectedFrameId: frameId,
      expectedOrigin: DESKTOP_IDENTITY.origin,
      sessionGeneration: SESSION_GENERATION,
    },
    deepLinks: { system: createDeepLinkSystem(), bridge: launchBridge },
    authManager,
    local: { mode: localMode, ...(recentFiles ? { recents: recentFiles } : {}) },
    localFiles: { registry: fileRegistry, saveGuard, session: deviceScope, xlsx: createLocalXlsxEngine({ assetsDir: resolveLocalXlsxAssetsDir({ resourcesPath: app.isPackaged ? process.resourcesPath : undefined, distDirectory: app.isPackaged ? undefined : dirname(DIST_MAIN_DIRECTORY), envAssetsDir: process.env.UNIWORK_XLSX_ASSETS }) }), ...(recentFiles ? { recents: recentFiles } : {}), beginSave: documents.beginSave, isOpened: (handle) => documents.context(handle)?.kind === "local", onOpened: localOpenContext, checkpoint: localCheckpoint, onSaveConfirmed: noteConfirmedLocalSave, onSaveAsConfirmed: noteConfirmedLocalRebind,
      pickOpen: async () => {
        const result = await dialog.showOpenDialog(window, { properties: ["openFile"], filters: [...desktopDialogFilters(), { name: "Files", extensions: ["*"] }] });
        return result.canceled ? undefined : result.filePaths[0];
      },
      pickSaveAs: async () => {
        const result = await dialog.showSaveDialog(window, { filters: desktopDialogFilters() });
        return result.canceled ? undefined : result.filePath;
      },
    },
    deploymentProfile,
    userDataDirectory: app.getPath("userData"),
    draftKeyStore,
    drafts: {
      store: draftStore,
      context: liveDraftContext,
      // Before a document is open (app start / restart) only the live
      // account's own rows can be offered, filtered by the session in main;
      // signed out the same offer serves the local device scope.
      accountSession: () => (authManager?.getMetadata().status === "signed-in" ? accountScope() : undefined),
      localSession: () => deviceScope(),
      beginCheckpoint: documents.beginCheckpoint,
      liveAccess: liveDraftAccess,
      currentBase: (documentId) => documents.context(documentId)?.identity.base,
    },
    ...(cachedOfficeTransport && deploymentProfile && credentials ? { office: { transport: cachedOfficeTransport, session: accountScope, isOpened: (documentId: string, workspaceId: string) => {
      const document = documents.context(documentId);
      return document?.kind === "cloud" && document.identity.workspaceId === workspaceId;
    }, isSignedIn: () => authManager?.getMetadata().status === "signed-in", saveGuard, beginSave: documents.beginSave, onDocumentOpened: (document: { id: string; workspaceId: string; version: number; revision: string }) => {
      const identity = cloudDraftIdentity(document);
      if (!identity || !documents.open(document.id, "cloud", identity)) throw new Error("document_context_refused");
    } } } : {}),
    activeDocumentId: () => documents.activeDocumentId(),
    draftStore,
    leave,
    updates: {
      restart: {
        drafts: draftStore,
        // The update restart uses the ONE leave dialog: save/keep/discard/stay
        // decide first (so a keep can still write), then the durable flush runs.
        confirmDrafts: async () => (await leave.request("update")).proceeded,
        restart: async () => { closeApproved = true; app.quit(); },
      },
    },
  });
  const update = createNativeUpdateAction({
    client: host.updates,
    install: createNativeInstaller({ directory: join(app.getPath("userData"), "updates"), platform: process.platform, openPath: (path) => shell.openPath(path) }),
    report: async (code) => {
      await dialog.showMessageBox(window, {
        type: code === "auto_update_disabled" ? "info" : "error",
        title: "Cập nhật UniWork Office",
        message: code === "auto_update_disabled" ? "Bản dựng này chưa hỗ trợ cập nhật tự động." : "Không thể cập nhật. Ứng dụng vẫn đang mở.",
        detail: `Mã: ${code}`, buttons: ["Đóng"],
      });
    },
  });
  // Keep the platform editing roles available (especially Cmd/C/X/V on
  // macOS) while adding the desktop Save and update actions owned by the host.
  Menu.setApplicationMenu(Menu.buildFromTemplate(createNativeMenuTemplate(DESKTOP_IDENTITY_MANIFEST.build.channel, () => nativeSaveListener?.(), process.platform === "darwin", () => { void update(); })));

  for (const channel of DESKTOP_IPC_CHANNELS) {
    ipcMain.handle(channel, (event, payload) => {
      if (event.sender !== window.webContents) throw new Error("IPC sender is not the desktop window");
      return host.dispatch(channel, payload);
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
  window.webContents.once("did-finish-load", () => { for (const path of [...nativeFiles.splice(0), ...process.argv.filter((arg) => desktopDocumentFormatForName(arg))]) void announceFile(path); });

  window.once("ready-to-show", () => {
    if (!SMOKE_MODE) {
      window.show();
      return;
    }
    void runSmokeDiagnostics(window, deploymentProfile).then(() => app.quit()).catch((error) => {
      process.stderr.write(`office-desktop: launch smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
      app.exit(1);
    });
  });
  app.on("window-all-closed", () => app.quit());
  await host.start();
}

void startElectronHost().catch((error) => {
  process.stderr.write(`office-desktop: Electron bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`);
  app.exit(1);
});
