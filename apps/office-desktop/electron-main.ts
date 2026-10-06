// Electron is supplied by electron-builder at runtime and intentionally stays
// a devDependency; this is the only privileged entry module that imports it.
// main/* modules receive the Electron objects they need as arguments.
// eslint-disable-next-line import-x/no-extraneous-dependencies
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, safeStorage, session, shell } from "electron";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DESKTOP_IDENTITY, DESKTOP_IDENTITY_MANIFEST, getChannelIdentity } from "./shared/identity";
import { desktopSessionMetadataSchema } from "./shared/ipc";
import { desktopDialogFilters } from "./shared/document-formats";
import { handleDesktopEngineCall, type DesktopEngineCall } from "@uniwork/office-engine/desktop";
import { createDesktopHost, WINDOW_WEB_PREFERENCES } from "./main/index";
import { createLocalXlsxEngine, resolveLocalXlsxAssetsDir } from "./main/xlsx-engine";
import { createHttpExchangePort, createLaunchBridge } from "./main/deep-links";
import { resolveDeploymentProfile } from "./shared/deployment";
import { createSecureCredentialStore } from "./main/credentials/secure-store";
import { createSystemBrowserLauncher } from "./main/auth/browser";
import { NativeLoginManager } from "./main/auth/manager";
import { createHttpAuthTransport } from "./main/transport/auth-transport";
import { createHttpOfficeTransport } from "./main/transport/office-transport";
import { createSafeStorageDraftKeyStore } from "./main/drafts/keystore";
import { createDesktopDraftStore } from "./main/drafts/store";
import { FileHandleRegistry } from "./main/files/registry";
import { createNativeInstaller, createNativeUpdateAction } from "./main/updates/native";
import { createOfficeSaveGuard } from "../../packages/core/office/save-guard";
import { createDesktopLeaveCoordinator } from "./main/leave";
import { leaveExpiredEventSchema, leaveRequestedEventSchema, loginRequestedEventSchema } from "./shared/ipc";
import { resolveLocalDevice } from "./main/local/device";
import { createLocalModeStore } from "./main/local/mode";
import { createRecentFilesStore } from "./main/local/recent-files";
import { clearPrintRoot, createPrintFileWriter, createPrintIpcHandler, installPrintSessionGuard, PRINT_PARTITION } from "./main/print";
import { createMainWindow, DESKTOP_TITLE_BAR_TOKENS, watchNativeTheme } from "./main/window";
import { systemLanguages } from "./main/appearance";
import { createNativeMenuTemplate } from "./main/native-menu";
import { installRendererProtocol, registerRendererScheme } from "./main/renderer-protocol";
import { captureEarlyLaunchEvents, createNoopLaunchBridge } from "./main/launch-events";
import { passPlatformGate, registerAppImageOnFirstRun, runSmokeDiagnostics } from "./main/startup";
import { createDocumentSession } from "./main/document-session";
import { registerWindowIpc } from "./main/window-ipc";

const DIST_MAIN_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIRECTORY = resolve(DIST_MAIN_DIRECTORY, "../renderer");
const PRELOAD_PATH = resolve(DIST_MAIN_DIRECTORY, "../preload/index.cjs");
const SESSION_GENERATION = "desktop-dev-session";
const SMOKE_MODE = process.argv.includes("--office-desktop-smoke");
const launchEvents = captureEarlyLaunchEvents(app);
registerRendererScheme(protocol);

async function startElectronHost(): Promise<void> {
  // A launch that cannot take the single-instance lock is a deep-link hand-off
  // (the running primary receives 'second-instance'). Exit before any window
  // exists: a renderer-less secondary would otherwise be held open by the
  // unsaved-work close guard and leave a second app process behind.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  if (!(await passPlatformGate(app, dialog, SMOKE_MODE))) return;
  registerAppImageOnFirstRun(app);
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
  installRendererProtocol(protocol, net, RENDERER_DIRECTORY);

  const window = createMainWindow(BrowserWindow, { show: !SMOKE_MODE, preload: PRELOAD_PATH, platform: process.platform, dark: nativeTheme.shouldUseDarkColors });
  watchNativeTheme(nativeTheme, window, process.platform);
  let nativeSaveListener: (() => void) | undefined;
  const officeTransport = deploymentProfile && credentials ? createHttpOfficeTransport({ profile: deploymentProfile, credentials, refreshSession: async () => {
    const session = await authManager?.refreshSession();
    if (session?.status !== "signed-in") throw new Error("login_required");
  } }) : undefined;
  const documentSession = createDocumentSession({ sessionGeneration: SESSION_GENERATION, deviceId, authManager, deploymentProfile, fileRegistry, draftStore, recentFiles, saveGuard, officeTransport });
  const { deviceScope, accountScope, documents, cachedOfficeTransport } = documentSession;
  window.on("closed", () => { documents.clear(); });
  publishSessionMetadata = (metadata) => {
    const parsed = desktopSessionMetadataSchema.parse(metadata);
    documentSession.synchronizeAccount();
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
  const { leaveEvidence } = documentSession;
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
  const printRoot = join(app.getPath("temp"), "uniwork-print");
  installPrintSessionGuard(session.fromPartition(PRINT_PARTITION), pathToFileURL(printRoot).href);
  // A process that quit with a print dialog open never ran its cleanup.
  await clearPrintRoot(printRoot);
  const printHandlers = createPrintIpcHandler({ owner: window, createWindow: (options) => new BrowserWindow({ ...options, parent: window }), writeFile: createPrintFileWriter(printRoot) });
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
    deepLinks: { system: launchEvents.createDeepLinkSystem(), bridge: launchBridge },
    authManager,
    local: { mode: localMode, ...(recentFiles ? { recents: recentFiles } : {}) },
    localFiles: { registry: fileRegistry, saveGuard, session: deviceScope, xlsx: createLocalXlsxEngine({ assetsDir: resolveLocalXlsxAssetsDir({ resourcesPath: app.isPackaged ? process.resourcesPath : undefined, distDirectory: app.isPackaged ? undefined : dirname(DIST_MAIN_DIRECTORY), envAssetsDir: process.env.UNIWORK_XLSX_ASSETS }) }), ...(recentFiles ? { recents: recentFiles } : {}), beginSave: documents.beginSave, isOpened: (handle) => documents.context(handle)?.kind === "local", onOpened: documentSession.localOpenContext, checkpoint: documentSession.localCheckpoint, onSaveConfirmed: documentSession.noteConfirmedLocalSave, onSaveAsConfirmed: documentSession.noteConfirmedLocalRebind,
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
    appearance: { snapshot: () => ({ dark: nativeTheme.shouldUseDarkColors, languages: systemLanguages(app) }) },
    userDataDirectory: app.getPath("userData"),
    draftKeyStore,
    drafts: {
      store: draftStore,
      context: documentSession.liveDraftContext,
      // Before a document is open (app start / restart) only the live
      // account's own rows can be offered, filtered by the session in main;
      // signed out the same offer serves the local device scope.
      accountSession: () => (authManager?.getMetadata().status === "signed-in" ? accountScope() : undefined),
      localSession: () => deviceScope(),
      beginCheckpoint: documents.beginCheckpoint,
      liveAccess: documentSession.liveDraftAccess,
      currentBase: (documentId) => documents.context(documentId)?.identity.base,
    },
    ...(cachedOfficeTransport && deploymentProfile && credentials ? { office: { transport: cachedOfficeTransport, session: accountScope, isOpened: (documentId: string, workspaceId: string) => {
      const document = documents.context(documentId);
      return document?.kind === "cloud" && document.identity.workspaceId === workspaceId;
    }, isSignedIn: () => authManager?.getMetadata().status === "signed-in", saveGuard, beginSave: documents.beginSave, onDocumentOpened: documentSession.onCloudDocumentOpened } } : {}),
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
  registerWindowIpc({ ipcMain, app, window, dispatch: host.dispatch, fileRegistry, deviceScope, localOpenContext: documentSession.localOpenContext, nativeFiles: launchEvents.nativeFiles, argv: process.argv });

  window.once("ready-to-show", () => {
    if (!SMOKE_MODE) {
      window.show();
      return;
    }
    void runSmokeDiagnostics(window, SESSION_GENERATION, deploymentProfile).then(() => app.quit()).catch((error) => {
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
