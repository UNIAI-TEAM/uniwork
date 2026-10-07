import { systemLanguages, type AppearanceOptions, type LanguageSource } from "./appearance";
import { applyAppBranding, type BrandableApp } from "./branding";
import { createDesktopHost, type DesktopHostOptions } from "./index";
import { createNativeMenuTemplate } from "./native-menu";
import { mainStrings, resolveDesktopLocale, type DesktopLocale, type MainStrings } from "./strings";
import { createMainWindow, watchNativeTheme, type BrowserWindowConstructor, type ThemeSource } from "./window";

type DesktopShellDependencies = {
  app: BrandableApp & LanguageSource;
  nativeTheme: ThemeSource;
  BrowserWindow: BrowserWindowConstructor;
  platform: NodeJS.Platform;
  iconPath?: string;
};

type DesktopShellWindow = {
  window: Electron.BrowserWindow;
  locale: DesktopLocale;
  /** Main copy (menu, update dialog) in the app language. */
  t: MainStrings;
  /** The OS theme and language snapshot `desktop:appearance` answers. */
  appearance: AppearanceOptions;
  /** The host, with the appearance channel always attached: the entry cannot
   * build one without it, so the renderer never silently falls back to
   * matchMedia/navigator.languages. */
  createHost(options: Omit<DesktopHostOptions, "appearance">): ReturnType<typeof createDesktopHost>;
  menuTemplate(channel: "dev" | "beta" | "stable", onSave: () => void, onCheckUpdates?: () => void, onPrint?: () => void): Electron.MenuItemConstructorOptions[];
};

/** How the desktop looks and speaks: branding, the one window, the OS theme
 * and the app language. Electron is injected, so this seam is what the
 * entry's wiring is tested through (main/shell.test.ts).
 *
 * Call it where the entry brands the process (before `app.whenReady()`), then
 * `openWindow` once the app is ready. */
export function startDesktopShell(deps: DesktopShellDependencies): { openWindow(options: { show: boolean; preload: string; workAreaHeight?: number }): DesktopShellWindow } {
  applyAppBranding(deps.app, deps.platform, deps.iconPath);
  return {
    openWindow(options) {
      const window = createMainWindow(deps.BrowserWindow, { ...options, platform: deps.platform, dark: deps.nativeTheme.shouldUseDarkColors, icon: deps.iconPath });
      watchNativeTheme(deps.nativeTheme, window, deps.platform);
      // The renderer resolves its own language from the same snapshot with the
      // same rule, so main's menu and dialogs and the page agree.
      const locale = resolveDesktopLocale(systemLanguages(deps.app));
      const t = mainStrings(locale);
      const appearance: AppearanceOptions = { snapshot: () => ({ dark: deps.nativeTheme.shouldUseDarkColors, languages: systemLanguages(deps.app) }) };
      return {
        window,
        locale,
        t,
        appearance,
        createHost: (hostOptions) => createDesktopHost({ ...hostOptions, appearance }),
        menuTemplate: (channel, onSave, onCheckUpdates, onPrint) => createNativeMenuTemplate(channel, onSave, deps.platform === "darwin", onCheckUpdates, t, onPrint),
      };
    },
  };
}
