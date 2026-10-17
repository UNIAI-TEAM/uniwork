/**
 * App-lifecycle wiring (smoke-tested by hand, excluded from coverage): the
 * window, its guards, the PKCE session and the closed IPC surface. Everything
 * with logic lives in the modules this file calls.
 */
import { app, BrowserWindow, safeStorage, screen, session as electronSession } from "electron";
import { join } from "node:path";
import { createAuthCallbackRouter } from "./auth/callback";
import { createCredentialStore } from "./auth/credentials";
import { ShellSession } from "./auth/session";
import { createTransport } from "./auth/transport";
import { extractDeepLinkFromArgv, MainRendererQueue, parseDeepLink } from "./deep-link";
import { openExternalSafely } from "./external-url";
import { registerIpc, sendDeepLink } from "./ipc/handlers";
import { sendToApp } from "./ipc/schema";
import { installNavigationGuard } from "./navigation-guard";
import { installOfflineFallback } from "./offline";
import { decidePermission } from "./permissions";
import { createRendererWebPreferences } from "./renderer-web-preferences";
import { resolveShellConfig } from "./runtime-config";
import { installScreenShare } from "./screen-share";
import {
  loadWindowState,
  MIN_WINDOW_WIDTH,
  resolveWindowOptions,
  saveWindowStateToFile,
  snapshotWindowState,
  windowStateFilePath,
} from "./window-state";

// Literal member expressions: electron.vite.config.ts inlines these at build time.
const config = resolveShellConfig({
  UNICHAT_ENV: process.env.UNICHAT_ENV,
  UNICHAT_APP_URL: process.env.UNICHAT_APP_URL,
  UNICHAT_API_URL: process.env.UNICHAT_API_URL,
  UNICHAT_DEPLOYMENT_ID: process.env.UNICHAT_DEPLOYMENT_ID,
});
const external = { allowHttpLoopback: config.env === "dev" };
// Built by `pnpm brand:build`. A packaged macOS app takes its icon from the
// bundle; Windows and Linux windows, and an unpackaged run's dock, need it set.
const ICON = join(__dirname, "../../resources/icon.png");

// Dev gets its own name and userData (hence its own single-instance lock and
// session store), so it never mixes with an installed build. Must precede the lock.
if (config.env === "dev") {
  app.setName("UniChat Dev");
  app.setPath("userData", join(app.getPath("appData"), "UniChat Dev"));
}
if (process.defaultApp) app.setAsDefaultProtocolClient(config.scheme, process.execPath, [app.getAppPath()]);
else app.setAsDefaultProtocolClient(config.scheme);

const router = createAuthCallbackRouter(process.argv, config.scheme);
const queue = new MainRendererQueue();
let win: BrowserWindow | null = null;
const getWindow = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null);
const deepLinkDeps = { config, queue, getWindow };

function focusWindow(): void {
  const current = getWindow();
  if (!current) return;
  if (current.isMinimized()) current.restore();
  current.show();
  current.focus();
}

// macOS keeps the app alive with no window: a link or sign-in needs one to land in.
function ensureWindow(): void {
  if (app.isReady() && !getWindow()) createWindow();
}

function openDeepLink(path: string | null): void {
  if (!path) return;
  ensureWindow();
  sendDeepLink(deepLinkDeps, path);
  focusWindow();
}

function createWindow(): void {
  queue.resetReady();
  const stateFile = windowStateFilePath(app.getPath("userData"));
  const opts = resolveWindowOptions(
    loadWindowState(stateFile),
    screen.getAllDisplays().map((d) => d.workArea),
    screen.getPrimaryDisplay().workArea,
  );
  const window = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    ...(opts.x != null && opts.y != null ? { x: opts.x, y: opts.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "darwin" ? {} : { icon: ICON }),
    webPreferences: createRendererWebPreferences(join(__dirname, "../preload/index.js")),
  });
  win = window;

  window.on("ready-to-show", () => {
    if (opts.isFullScreen) window.setFullScreen(true);
    else if (opts.isMaximized) window.maximize();
    window.show();
  });
  window.on("close", () => {
    const snapshot = snapshotWindowState(window);
    if (snapshot) saveWindowStateToFile(stateFile, snapshot);
  });
  window.on("closed", () => {
    if (win !== window) return;
    win = null;
    queue.resetReady();
  });
  window.on("focus", () => sendToApp(window, config.appUrl, "app:focus-changed", true));
  window.on("blur", () => sendToApp(window, config.appUrl, "app:focus-changed", false));
  // A reload replaces the document: its listeners must re-report link:ready.
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) queue.resetReady();
  });

  installNavigationGuard(window, [config.appUrl, config.apiUrl]);
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url, external);
    return { action: "deny" };
  });
  // The web app's shell start page (paths.unichatStart): the site root is the marketing landing.
  const startUrl = `${config.appUrl}/auth/unichat`;
  installOfflineFallback(window, { appUrl: startUrl, offlinePath: join(__dirname, "../../resources/offline.html") });
  // did-fail-load handles the failure; the promise rejects with the same thing.
  window.loadURL(startUrl).catch(() => undefined);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Registered before `ready`: macOS can deliver a cold-start URL early; both the
  // router and the queue hold what arrives until their consumers start.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (!router.openUrl(url)) openDeepLink(parseDeepLink(url, config.scheme));
  });
  app.on("second-instance", (_event, argv) => {
    focusWindow();
    if (!router.secondInstance(argv)) openDeepLink(extractDeepLinkFromArgv(argv, config.scheme));
  });
  openDeepLink(extractDeepLinkFromArgv(process.argv, config.scheme));

  void app.whenReady().then(() => {
    app.setAppUserModelId("com.uniworkos.chat");
    if (!app.isPackaged) app.dock?.setIcon(ICON);

    const session = new ShellSession({
      config,
      transport: createTransport(config),
      credentials: createCredentialStore({ userDataDir: app.getPath("userData"), safeStorage }),
      openBrowser: (url) => openExternalSafely(url, external),
    });
    session.onChange((token) => sendToApp(getWindow(), config.appUrl, "session:changed", token));
    registerIpc({ config, session, queue, getWindow });
    router.start((url) => {
      ensureWindow();
      session.completeCallback(url).catch((error: unknown) => console.warn("[auth] callback failed", error));
    });
    void session.restore();

    const defaultSession = electronSession.defaultSession;
    defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) =>
      callback(decidePermission(permission, details.requestingUrl, details.isMainFrame, config.appUrl)),
    );
    installScreenShare(defaultSession, config.appUrl);

    createWindow();
    app.on("activate", () => {
      if (!getWindow()) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
