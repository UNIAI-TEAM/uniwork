// Electron is supplied by electron-builder at runtime and intentionally stays
// a devDependency; this is the only privileged entry module that imports it.
// eslint-disable-next-line import-x/no-extraneous-dependencies
import { app, BrowserWindow, ipcMain, Menu, net, protocol, safeStorage, shell } from "electron";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DESKTOP_IDENTITY, DESKTOP_IDENTITY_MANIFEST, getChannelIdentity } from "./shared/identity";
import { DESKTOP_IPC_CHANNELS, desktopSessionMetadataSchema } from "./shared/ipc";
import { createDesktopHost, WINDOW_WEB_PREFERENCES } from "./main/index";
import { createHttpExchangePort, createLaunchBridge, type DeepLinkSystem } from "./main/deep-links";
import { resolveDeploymentProfile, type DeploymentProfile } from "./shared/deployment";
import { createSecureCredentialStore } from "./main/credentials/secure-store";
import { createSystemBrowserLauncher } from "./main/auth/browser";
import { NativeLoginManager } from "./main/auth/manager";
import { createHttpAuthTransport } from "./main/transport/auth-transport";
import { createHttpOfficeTransport } from "./main/transport/office-transport";

const DIST_MAIN_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIRECTORY = resolve(DIST_MAIN_DIRECTORY, "../renderer");
const PRELOAD_PATH = resolve(DIST_MAIN_DIRECTORY, "../preload/index.cjs");
const SESSION_GENERATION = "desktop-dev-session";
const SMOKE_MODE = process.argv.includes("--office-desktop-smoke");

export const DESKTOP_TITLE_BAR_TOKENS = Object.freeze({
  light: { color: "#FFFFFF", symbolColor: "#182230" },
  dark: { color: "#172033", symbolColor: "#F4F7FB" },
});

export function createNativeMenuTemplate(channel: "dev" | "beta" | "stable", onSave: () => void, isMac = process.platform === "darwin") {
  const fileLabel = isMac ? "Tệp" : "File";
  const editLabel = isMac ? "Sửa" : "Edit";
  const viewLabel = isMac ? "Xem" : "View";
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: fileLabel, submenu: [{ label: "Lưu", accelerator: "CmdOrCtrl+S", click: onSave }, { role: "quit", label: "Thoát" }] },
    { label: editLabel, submenu: [{ role: "undo", label: "Hoàn tác" }, { role: "redo", label: "Làm lại" }, { type: "separator" }, { role: "cut", label: "Cắt" }, { role: "copy", label: "Sao chép" }, { role: "paste", label: "Dán" }, { role: "selectAll", label: "Chọn tất cả" }] },
  ];
  if (channel === "dev") template.push({ label: viewLabel, submenu: [{ role: "reload", label: "Tải lại" }, { role: "toggleDevTools", label: "Công cụ phát triển" }] });
  return template;
}

export function nativeWindowOptions(platform: NodeJS.Platform, dark = false): Pick<Electron.BrowserWindowConstructorOptions, "titleBarStyle" | "titleBarOverlay"> {
  if (platform === "darwin") return {};
  const colors = dark ? DESKTOP_TITLE_BAR_TOKENS.dark : DESKTOP_TITLE_BAR_TOKENS.light;
  return { titleBarStyle: "hidden", titleBarOverlay: { color: colors.color, symbolColor: colors.symbolColor, height: 32 } };
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
    requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
    registerProtocolClient: (scheme) => {
      if (process.platform === "win32" && app.isPackaged) app.setAsDefaultProtocolClient(scheme);
      else if (process.argv[1]) app.setAsDefaultProtocolClient(scheme, process.execPath, [resolve(process.argv[1])]);
      else app.setAsDefaultProtocolClient(scheme);
    },
    onSecondInstance: (listener) => {
      app.on("second-instance", (event, argv) => listener(event, argv));
    },
    onOpenUrl: (listener) => {
      app.on("open-url", (event, url) => listener(event, url));
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

async function startElectronHost(): Promise<void> {
  // A packaged app never accepts a runtime environment override for its data
  // location. The smoke flag is an explicit local test seam and is the only
  // packaged exception; production profile binding remains download-time.
  const configuredUserData = (!app.isPackaged || SMOKE_MODE) ? process.env.UNIWORK_OFFICE_USER_DATA : undefined;
  const defaultUserData = join(app.getPath("appData"), DESKTOP_IDENTITY.userDataNamespace);
  app.setPath("userData", configuredUserData ? resolve(configuredUserData) : defaultUserData);
  app.setAppUserModelId(DESKTOP_IDENTITY.appId);
  const deploymentResolution = resolveDeploymentProfile({
    userDataDirectory: app.getPath("userData"),
    buildChannel: DESKTOP_IDENTITY_MANIFEST.build.channel,
    env: app.isPackaged && !SMOKE_MODE ? {} : process.env,
  });
  const deploymentProfile = "kind" in deploymentResolution ? undefined : deploymentResolution;
  await app.whenReady();
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
    webPreferences: {
      ...WINDOW_WEB_PREFERENCES,
      preload: PRELOAD_PATH,
    },
    ...nativeWindowOptions(process.platform),
  });
  if (process.platform !== "darwin") window.setMenuBarVisibility(false);
  let nativeSaveListener: (() => void) | undefined;
  let activeDocumentId: string | undefined;
  window.on("closed", () => { activeDocumentId = undefined; });
  // Keep the platform editing roles available (especially Cmd/C/X/V on
  // macOS) while adding the one desktop Save action owned by the host.
  Menu.setApplicationMenu(Menu.buildFromTemplate(createNativeMenuTemplate(DESKTOP_IDENTITY_MANIFEST.build.channel, () => nativeSaveListener?.())));
  publishSessionMetadata = (metadata) => {
    const parsed = desktopSessionMetadataSchema.parse(metadata);
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
  }) : createNoopLaunchBridge(deploymentProfile?.deploymentId ?? DESKTOP_IDENTITY.appId);
  const host = createDesktopHost({
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
    deploymentProfile,
    userDataDirectory: app.getPath("userData"),
    ...(deploymentProfile && credentials ? { office: { transport: createHttpOfficeTransport({ profile: deploymentProfile, credentials, refreshSession: async () => {
      const session = await authManager?.refreshSession();
      if (session?.status !== "signed-in") throw new Error("login_required");
    } }), isSignedIn: () => authManager?.getMetadata().status === "signed-in", onDocumentOpened: (documentId: string) => { activeDocumentId = documentId; } } } : {}),
    activeDocumentId: () => activeDocumentId,
  });

  for (const channel of DESKTOP_IPC_CHANNELS) {
    ipcMain.handle(channel, (event, payload) => {
      if (event.sender !== window.webContents) throw new Error("IPC sender is not the desktop window");
      return host.dispatch(channel, payload);
    });
  }

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
