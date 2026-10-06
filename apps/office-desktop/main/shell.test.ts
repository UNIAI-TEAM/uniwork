import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { APP_USER_MODEL_ID, BRAND_PRODUCT_NAME } from "./branding";
import { WINDOW_WEB_PREFERENCES } from "./index";
import { startDesktopShell } from "./shell";
import { DESKTOP_TITLE_BAR_TOKENS } from "./window";

function fakes(options: { languages?: string[]; dark?: boolean; platform?: NodeJS.Platform } = {}) {
  const calls: string[] = [];
  const app = {
    isPackaged: true,
    setName: (name: string) => calls.push(`name:${name}`),
    setAppUserModelId: (id: string) => calls.push(`aumid:${id}`),
    setAboutPanelOptions: () => calls.push("about"),
    getLocale: () => "en-US",
    getPreferredSystemLanguages: () => options.languages ?? ["vi-VN"],
  };
  let updated: (() => void) | undefined;
  const nativeTheme = { shouldUseDarkColors: options.dark ?? false, on: vi.fn((_event: "updated", listener: () => void) => { updated = listener; }), removeListener: vi.fn() };
  const windows: FakeWindow[] = [];
  class FakeWindow {
    readonly options: Electron.BrowserWindowConstructorOptions;
    readonly webContents = { send: vi.fn() };
    setMenuBarVisibility = vi.fn();
    setTitle = vi.fn();
    setTitleBarOverlay = vi.fn();
    isDestroyed = () => false;
    on = vi.fn();
    constructor(windowOptions: Electron.BrowserWindowConstructorOptions) { this.options = windowOptions; windows.push(this); }
  }
  const shell = startDesktopShell({ app, nativeTheme, BrowserWindow: FakeWindow as unknown as typeof Electron.BrowserWindow, platform: options.platform ?? "win32", iconPath: "/dist/icons/icon.ico" });
  return { calls, nativeTheme, windows, shell, flip: (dark: boolean) => { nativeTheme.shouldUseDarkColors = dark; updated?.(); } };
}

const hostOptions = {
  window: { webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() } as never, webPreferences: WINDOW_WEB_PREFERENCES, loadURL: vi.fn(), setUserDataDirectory: vi.fn() },
  sender: { senderId: 1, frameId: 0, origin: "app://uniwork", expectedSenderId: 1, expectedFrameId: 0, expectedOrigin: "app://uniwork", sessionGeneration: "session_1234" },
};

describe("desktop shell seam (the entry's appearance and branding wiring)", () => {
  it("brands the process as soon as it starts, before any window", () => {
    const { calls, windows } = fakes();
    expect(calls).toEqual([`name:${BRAND_PRODUCT_NAME}`, `aumid:${APP_USER_MODEL_ID}`, "about"]);
    expect(windows).toHaveLength(0);
  });

  it("opens the window in the OS theme and follows every later flip", () => {
    const { windows, nativeTheme, shell, flip } = fakes({ dark: true });
    const { window } = shell.openWindow({ show: false, preload: "/p/index.cjs", workAreaHeight: 900 });
    expect(windows).toHaveLength(1);
    expect(window).toBe(windows[0]);
    expect(windows[0]?.options).toMatchObject({ show: false, title: BRAND_PRODUCT_NAME, icon: "/dist/icons/icon.ico", titleBarOverlay: { ...DESKTOP_TITLE_BAR_TOKENS.dark, height: 40 } });
    expect(nativeTheme.on).toHaveBeenCalledWith("updated", expect.any(Function));
    flip(false);
    expect(windows[0]?.webContents.send).toHaveBeenLastCalledWith("desktop:theme-changed", { dark: false });
    expect(windows[0]?.setTitleBarOverlay).toHaveBeenLastCalledWith({ ...DESKTOP_TITLE_BAR_TOKENS.light, height: 40 });
  });

  it("builds a host that answers desktop:appearance with the live theme and OS languages", async () => {
    const { shell, nativeTheme } = fakes({ languages: ["fr-FR", "en-US"] });
    const opened = shell.openWindow({ show: false, preload: "/p/index.cjs" });
    const host = opened.createHost(hostOptions);
    await expect(host.dispatch("desktop:appearance", { sessionGeneration: "session_1234" })).resolves.toEqual({ dark: false, languages: ["fr-FR", "en-US"] });
    nativeTheme.shouldUseDarkColors = true;
    await expect(host.dispatch("desktop:appearance", { sessionGeneration: "session_1234" })).resolves.toEqual({ dark: true, languages: ["fr-FR", "en-US"] });
  });

  it("speaks the app language in the menu and dialogs", () => {
    const english = fakes({ languages: ["fr-FR", "en-US"] }).shell.openWindow({ show: false, preload: "/p" });
    expect(english.locale).toBe("en");
    expect(english.t("officeDesktop.native.update.close")).toBe("Close");
    expect(english.menuTemplate("stable", () => undefined).map((menu) => menu.label)).toEqual(["File", "Edit", "Help"]);
    const vietnamese = fakes({ languages: ["fr-FR"] }).shell.openWindow({ show: false, preload: "/p" });
    expect(vietnamese.locale).toBe("vi");
    expect(vietnamese.menuTemplate("stable", () => undefined).map((menu) => menu.label)).toEqual(["Tệp", "Sửa", "Trợ giúp"]);
    // macOS: the app menu first, one Quit.
    const mac = fakes({ languages: ["en-US"], platform: "darwin" }).shell.openWindow({ show: false, preload: "/p" });
    expect(mac.menuTemplate("stable", () => undefined)[0]?.label).toBe(BRAND_PRODUCT_NAME);
  });

  it("is the only way the Electron entry brands, builds the window, watches the theme or builds the host", () => {
    const entry = readFileSync(new URL("../electron-main.ts", import.meta.url), "utf8");
    expect(entry).toMatch(/startDesktopShell\(\{ app, nativeTheme, BrowserWindow, platform: process\.platform, iconPath: BRAND_ICON_PATH \}\)/);
    expect(entry).toMatch(/desktopShell\.openWindow\(/);
    expect(entry).toMatch(/const host = createHost\(\{/);
    for (const bypass of ["createDesktopHost", "createMainWindow", "watchNativeTheme", "applyAppBranding", "createNativeMenuTemplate", "systemLanguages"]) {
      expect(entry, bypass).not.toContain(bypass);
    }
  });
});
