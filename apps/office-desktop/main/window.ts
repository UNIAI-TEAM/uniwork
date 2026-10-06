import { themeChangedEventSchema } from "../shared/ipc";
import { WINDOW_WEB_PREFERENCES } from "./index";

export const DESKTOP_TITLE_BAR_TOKENS = Object.freeze({
  // Electron requires literal colors. These mirror --muted and
  // --foreground in packages/ui/styles/tokens.css (:root and .dark).
  light: { color: "#f4f4f5", symbolColor: "#202020" },
  dark: { color: "#262626", symbolColor: "#f8f9fa" },
});

/** Smallest window the shell lays out without overlap: below 640 wide the tab
 * strip collides with its new-tab and overflow controls and the ribbon scrolls.
 * The height keeps the document the larger part of the window: the fixed chrome
 * (tab strip 40, document header 48, ribbon 132, status bar 27, about 247px)
 * took half of a 480px window, and leaves about 59% of 600 to the page. */
export const DESKTOP_WINDOW_MIN_SIZE = { minWidth: 640, minHeight: 600 } as const;
/** The floor a short screen may push the minimum down to. */
const SHORT_SCREEN_MIN_HEIGHT = 480;

/** Never demand more height than the screen offers (a 1366x768 panel at 125%
 * leaves about 574px of work area): there the minimum is the work area, down
 * to the old 480 floor, so the window still fits and maximizes cleanly. */
export function desktopWindowMinSize(workAreaHeight?: number): { minWidth: number; minHeight: number } {
  if (workAreaHeight === undefined || !Number.isFinite(workAreaHeight)) return { ...DESKTOP_WINDOW_MIN_SIZE };
  return { minWidth: DESKTOP_WINDOW_MIN_SIZE.minWidth, minHeight: Math.max(SHORT_SCREEN_MIN_HEIGHT, Math.min(DESKTOP_WINDOW_MIN_SIZE.minHeight, Math.floor(workAreaHeight))) };
}

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
export function createMainWindow(BrowserWindow: BrowserWindowConstructor, options: { show: boolean; preload: string; platform: NodeJS.Platform; dark: boolean; workAreaHeight?: number }): Electron.BrowserWindow {
  const window = new BrowserWindow({
    show: options.show,
    ...desktopWindowMinSize(options.workAreaHeight),
    webPreferences: {
      ...WINDOW_WEB_PREFERENCES,
      preload: options.preload,
    },
    ...nativeWindowOptions(options.platform, options.dark),
  });
  if (options.platform !== "darwin") window.setMenuBarVisibility(false);
  return window;
}

type ThemeSource = Pick<Electron.NativeTheme, "shouldUseDarkColors"> & {
  on(event: "updated", listener: () => void): unknown;
  removeListener(event: "updated", listener: () => void): unknown;
};
type ThemedWindow = Pick<Electron.BrowserWindow, "setTitleBarOverlay" | "isDestroyed"> & { webContents: { send(channel: string, payload: unknown): void } };

/** Follow the OS light/dark switch: repaint the native caption controls and
 * tell the renderer, which toggles the `.dark` token class. */
export function watchNativeTheme(nativeTheme: ThemeSource, window: ThemedWindow, platform: NodeJS.Platform): () => void {
  const onUpdated = () => {
    if (window.isDestroyed()) return;
    const dark = nativeTheme.shouldUseDarkColors;
    applyTitleBarTheme(window, platform, dark);
    window.webContents.send("desktop:theme-changed", themeChangedEventSchema.parse({ dark }));
  };
  nativeTheme.on("updated", onUpdated);
  return () => { nativeTheme.removeListener("updated", onUpdated); };
}
