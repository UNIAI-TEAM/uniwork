// Electron is supplied by electron-builder at runtime and intentionally stays
// a devDependency; this is the only privileged entry module that imports it.
// eslint-disable-next-line import-x/no-extraneous-dependencies
import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from "electron";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DESKTOP_IDENTITY, DESKTOP_IDENTITY_MANIFEST, getChannelIdentity } from "./shared/identity";
import { DESKTOP_IPC_CHANNELS, desktopSessionMetadataSchema } from "./shared/ipc";
import { createDesktopHost, WINDOW_WEB_PREFERENCES } from "./main/index";
import { createLaunchBridge, type DeepLinkSystem } from "./main/deep-links/bridge";
import { resolveDeploymentProfile, type DeploymentProfile } from "./shared/deployment";
import { createSecureCredentialStore } from "./main/credentials/secure-store";
import { createSystemBrowserLauncher } from "./main/auth/browser";
import { NativeLoginManager } from "./main/auth/manager";
import { createHttpAuthTransport } from "./main/transport/auth-transport";
import { createSafeStorageDraftKeyStore } from "./main/drafts/keystore";
import { createDesktopDraftStore } from "./main/drafts/store";
import { FileHandleRegistry } from "./main/files/registry";
import { createOfficeSaveGuard } from "../../packages/core/office/save-guard";

const DIST_MAIN_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIRECTORY = resolve(DIST_MAIN_DIRECTORY, "../renderer");
const PRELOAD_PATH = resolve(DIST_MAIN_DIRECTORY, "../preload/index.cjs");
const SESSION_GENERATION = "desktop-dev-session";
const SMOKE_MODE = process.argv.includes("--office-desktop-smoke");

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
  const draftKeyStore = createSafeStorageDraftKeyStore({
    userDataDirectory: app.getPath("userData"),
    channel: DESKTOP_IDENTITY_MANIFEST.build.channel,
    keyNamespace: DESKTOP_IDENTITY.keyNamespace,
    safeStorage,
  });
  const draftStore = createDesktopDraftStore({ rootDirectory: join(app.getPath("userData"), "drafts"), keyStore: draftKeyStore });
  const saveGuard = createOfficeSaveGuard();
  const fileRegistry = new FileHandleRegistry({ sessionId: SESSION_GENERATION });
  let publishSessionMetadata: (metadata: unknown) => void = () => undefined;
  const authManager = deploymentProfile ? new NativeLoginManager({
    clientId: deploymentProfile.clientId,
    deploymentId: deploymentProfile.deploymentId,
    redirectUri: getChannelIdentity(DESKTOP_IDENTITY_MANIFEST.build.channel).authCallback,
    allowLoopbackBrowserUrl: deploymentProfile.channel === "dev",
    browser: createSystemBrowserLauncher((url) => shell.openExternal(url)),
    transport: createHttpAuthTransport(deploymentProfile),
    credentials: createSecureCredentialStore({ userDataDirectory: app.getPath("userData"), channel: DESKTOP_IDENTITY_MANIFEST.build.channel, deploymentId: deploymentProfile.deploymentId, safeStorage }),
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
  });
  publishSessionMetadata = (metadata) => {
    const parsed = desktopSessionMetadataSchema.parse(metadata);
    window.webContents.send?.("desktop:auth-session-changed", parsed);
  };
  // Electron's main-frame invoke events use frame id 0. Keep this explicit so
  // the dispatcher binds the handler to the top-level window only.
  const frameId = 0;
  const launchBridge = createNoopLaunchBridge(deploymentProfile?.deploymentId ?? DESKTOP_IDENTITY.appId);
  const host = createDesktopHost({
    window: {
      webContents: window.webContents,
      webPreferences: WINDOW_WEB_PREFERENCES,
      loadURL: (url) => window.loadURL(url),
      setUserDataDirectory: (value) => app.setPath("userData", resolve(value)),
      on: (event, listener) => window.on(event, listener),
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
    draftKeyStore,
    drafts: { store: draftStore, context: () => undefined },
    localFiles: {
      registry: fileRegistry,
      saveGuard,
      pickOpen: async () => {
        const result = await dialog.showOpenDialog(window, { properties: ["openFile"] });
        return result.canceled ? undefined : result.filePaths[0];
      },
      pickSaveAs: async () => {
        const result = await dialog.showSaveDialog(window);
        return result.canceled ? undefined : result.filePath;
      },
    },
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
