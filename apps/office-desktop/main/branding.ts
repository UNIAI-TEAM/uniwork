import { join } from "node:path";
import { DESKTOP_IDENTITY_MANIFEST, getChannelIdentity } from "../shared/identity";

const channelIdentity = getChannelIdentity(DESKTOP_IDENTITY_MANIFEST.build.channel);

/** The one place the desktop host decides what it is called and what it looks
 * like to the OS. Every visible name is the channel product from
 * identity.json ("UniWork Office (test)" on dev builds), the same string the
 * installer writes on the Start menu shortcut, so a tester never sees two
 * names for one app. Electron's own defaults ("Electron", the package name,
 * the atom icon) must never reach a window, dialog, menu or taskbar. */
export const BRAND_PRODUCT_NAME: string = channelIdentity.product;

/** The Windows AppUserModelId. electron-builder stamps the NSIS shortcut with
 * the appId, and Windows only groups the taskbar button and attributes toasts
 * to the shortcut when the running process declares the same id. The
 * channel profile is what scripts/package.mjs hands electron-builder. */
export const APP_USER_MODEL_ID: string = channelIdentity.appId;

type BrandedWindowKind = "main" | "print" | "dialog";

/** Only an empty title means "no document": the renderer leaves
 * `document.title` empty on the home tab (renderer/window-title.ts) and in
 * renderer/index.html, so a document named like the product, or literally
 * "Electron", keeps its own name. The window is created with the product
 * title, so nothing shows empty or "Electron" while the page loads. */
function cleanTitle(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

/** The title for a window of `kind`.
 * - main: "<document> - <product>", or the product alone on the home tab.
 * - print: the document title alone (Chromium names the print job and the
 *   suggested PDF file after it), the product when the document has none.
 * - dialog: "<subject> - <product>", or the product alone. */
export function formatWindowTitle(kind: BrandedWindowKind, subject?: string, product: string = BRAND_PRODUCT_NAME): string {
  const title = cleanTitle(subject);
  if (kind === "print") return title || product;
  return title ? `${title} - ${product}` : product;
}

/** The print window title. L1's print host calls this so a hidden print
 * window never carries Electron's default name. */
export function printWindowTitle(documentTitle: string | undefined): string {
  return formatWindowTitle("print", documentTitle);
}

/** Where the window/dock icon lives in the built bundle. build.mjs copies
 * apps/office-desktop/build/icon.ico and icons/512x512.png into dist/icons.
 * Windows reads the .ico (several sizes for the title bar, Alt+Tab and the
 * taskbar), Linux and the macOS dev dock take the png; a packaged macOS app
 * uses the bundle's .icns and needs no runtime icon. */
export function brandIconPath(platform: NodeJS.Platform, distDirectory: string): string {
  return join(distDirectory, "icons", platform === "win32" ? "icon.ico" : "icon.png");
}

type AboutPanelOptions = {
  applicationName: string;
  applicationVersion: string;
  version: string;
  credits: string;
  copyright: string;
  website: string;
  iconPath?: string;
};

/** The native About panel: product, version, build channel and the engine
 * provenance the brand rules (BRAND-01 B-11) ask for. */
export function aboutPanelOptions(options: { iconPath?: string; website?: string } = {}): AboutPanelOptions {
  const manifest = DESKTOP_IDENTITY_MANIFEST;
  return {
    applicationName: BRAND_PRODUCT_NAME,
    applicationVersion: manifest.build.appVersion,
    version: `${manifest.build.channel} · ${manifest.build.buildId}`,
    credits: `Engine ${manifest.engine.version}`,
    copyright: `© ${manifest.update.owner}`,
    website: options.website ?? "https://uniwork.unicomhub.com",
    ...(options.iconPath ? { iconPath: options.iconPath } : {}),
  };
}

/** Electron's About panel reads `iconPath` as a JPEG or PNG, never an .ico: handed
 * the window's .ico on Windows it falls back to the system "i" icon. build.mjs
 * copies the brand png beside the .ico, so the About panel takes that sibling. */
export function aboutIconPath(platform: NodeJS.Platform, iconPath: string | undefined): string | undefined {
  if (platform === "darwin" || !iconPath) return undefined;
  return iconPath.replace(/\.ico$/i, ".png");
}

export type BrandableApp = {
  setName(name: string): void;
  setAppUserModelId(id: string): void;
  setAboutPanelOptions(options: AboutPanelOptions): void;
  isPackaged: boolean;
  dock?: { setIcon(image: string): void };
};

/** Name the process before any window, dialog or menu exists. Call it at
 * module start, before `app.whenReady()`.
 *
 * Linux keeps the packaged name: Electron derives the X11 WM_CLASS from
 * app.name, and the desktop entry's StartupWMClass was generated from the
 * packaged productName; renaming here would split the running window from
 * its launcher icon. Every Linux surface that shows a name sets it
 * explicitly (window title, dialogs, About, desktop entry Name). */
export function applyAppBranding(app: BrandableApp, platform: NodeJS.Platform, iconPath?: string): void {
  if (platform !== "linux") app.setName(BRAND_PRODUCT_NAME);
  if (platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);
  app.setAboutPanelOptions(aboutPanelOptions({ iconPath: aboutIconPath(platform, iconPath) }));
  if (platform === "darwin" && !app.isPackaged && iconPath) app.dock?.setIcon(iconPath);
}

type TitledWindow = {
  setTitle(title: string): void;
  on(event: "page-title-updated", listener: (event: { preventDefault(): void }, title: string) => void): unknown;
};

/** Keep the main window titled "<document> - <product>". The renderer sets
 * `document.title` to the active document's name; this formats it. */
export function brandWindowTitle(window: TitledWindow, kind: BrandedWindowKind = "main"): void {
  window.setTitle(formatWindowTitle(kind));
  window.on("page-title-updated", (event, title) => {
    event.preventDefault();
    window.setTitle(formatWindowTitle(kind, title));
  });
}
