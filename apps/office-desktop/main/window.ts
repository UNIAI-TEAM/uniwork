import { WINDOW_WEB_PREFERENCES } from "./index";

export const DESKTOP_TITLE_BAR_TOKENS = Object.freeze({
  // Electron requires literal colors. These mirror --muted and
  // --foreground in packages/ui/styles/tokens.css (:root and .dark).
  light: { color: "#f4f4f5", symbolColor: "#202020" },
  dark: { color: "#262626", symbolColor: "#f8f9fa" },
});

/** Smallest window the shell lays out without overlap: below it the tab strip
 * collides with its new-tab and overflow controls and the ribbon scrolls. */
export const DESKTOP_WINDOW_MIN_SIZE = { minWidth: 640, minHeight: 480 } as const;

export function nativeWindowOptions(platform: NodeJS.Platform, dark = false): Pick<Electron.BrowserWindowConstructorOptions, "titleBarStyle" | "titleBarOverlay"> {
  if (platform === "darwin") return {};
  const colors = dark ? DESKTOP_TITLE_BAR_TOKENS.dark : DESKTOP_TITLE_BAR_TOKENS.light;
  return { titleBarStyle: "hidden", titleBarOverlay: { color: colors.color, symbolColor: colors.symbolColor, height: 40 } };
}

/** Repaint the native caption controls; macOS draws its own traffic lights. */
export function applyTitleBarTheme(window: Pick<Electron.BrowserWindow, "setTitleBarOverlay">, platform: NodeJS.Platform, dark: boolean): void {
  if (platform !== "darwin") window.setTitleBarOverlay({ ...DESKTOP_TITLE_BAR_TOKENS[dark ? "dark" : "light"], height: 40 });
}

type BrowserWindowConstructor = new (options: Electron.BrowserWindowConstructorOptions) => Electron.BrowserWindow;

/** The one document window. Electron is injected so the entry module stays
 * the only file that imports it. */
export function createMainWindow(BrowserWindow: BrowserWindowConstructor, options: { show: boolean; preload: string; platform: NodeJS.Platform; dark: boolean }): Electron.BrowserWindow {
  const window = new BrowserWindow({
    show: options.show,
    ...DESKTOP_WINDOW_MIN_SIZE,
    webPreferences: {
      ...WINDOW_WEB_PREFERENCES,
      preload: options.preload,
    },
    ...nativeWindowOptions(options.platform, options.dark),
  });
  if (options.platform !== "darwin") window.setMenuBarVisibility(false);
  return window;
}
