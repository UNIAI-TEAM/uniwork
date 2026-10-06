import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { applyTitleBarTheme, createMainWindow, DESKTOP_TITLE_BAR_TOKENS, DESKTOP_WINDOW_MIN_SIZE, desktopWindowMinSize, nativeWindowOptions } from "./window";

it("keeps the window wide enough for the tab strip and tall enough that the page outweighs the chrome", () => {
  expect(DESKTOP_WINDOW_MIN_SIZE).toEqual({ minWidth: 640, minHeight: 600 });
  // About 247px of fixed chrome (tab strip, header, ribbon, status bar).
  expect(1 - 247 / DESKTOP_WINDOW_MIN_SIZE.minHeight).toBeGreaterThan(0.55);
});

it("never asks for more height than the work area, and never less than 480", () => {
  expect(desktopWindowMinSize()).toEqual({ minWidth: 640, minHeight: 600 });
  expect(desktopWindowMinSize(1040)).toEqual({ minWidth: 640, minHeight: 600 });
  expect(desktopWindowMinSize(574.4)).toEqual({ minWidth: 640, minHeight: 574 });
  expect(desktopWindowMinSize(400)).toEqual({ minWidth: 640, minHeight: 480 });
  expect(desktopWindowMinSize(Number.NaN)).toEqual({ minWidth: 640, minHeight: 600 });
});

it("builds the one window with the minimum size, the secure preferences and the native titlebar", () => {
  const built: Electron.BrowserWindowConstructorOptions[] = [];
  const setMenuBarVisibility = vi.fn();
  class FakeWindow { constructor(options: Electron.BrowserWindowConstructorOptions) { built.push(options); } setMenuBarVisibility = setMenuBarVisibility; }
  createMainWindow(FakeWindow as unknown as typeof Electron.BrowserWindow, { show: false, preload: "/p/index.cjs", platform: "win32", dark: true, workAreaHeight: 560 });
  expect(built[0]).toMatchObject({ show: false, minWidth: 640, minHeight: 560, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: "/p/index.cjs" }, titleBarOverlay: { ...DESKTOP_TITLE_BAR_TOKENS.dark, height: 40 } });
  expect(setMenuBarVisibility).toHaveBeenCalledWith(false);
  createMainWindow(FakeWindow as unknown as typeof Electron.BrowserWindow, { show: true, preload: "/p/index.cjs", platform: "darwin", dark: false });
  expect(built[1]).not.toHaveProperty("titleBarOverlay");
  expect(built[1]).toMatchObject(DESKTOP_WINDOW_MIN_SIZE);
  expect(setMenuBarVisibility).toHaveBeenCalledTimes(1);
  // The entry module builds its window through this helper, not by hand.
  expect(readFileSync(new URL("../electron-main.ts", import.meta.url), "utf8")).toContain("createMainWindow(BrowserWindow,");
});

it("matches the 40px strip and semantic muted/foreground colors in both themes", () => {
  const tokens = readFileSync(new URL("../../../packages/ui/styles/tokens.css", import.meta.url), "utf8");
  const light = tokens.slice(0, tokens.indexOf(".dark {"));
  const dark = tokens.slice(tokens.indexOf(".dark {"));
  for (const [mode, source] of [["light", light], ["dark", dark]] as const) {
    const expected = DESKTOP_TITLE_BAR_TOKENS[mode];
    expect(source).toContain(`--muted: ${expected.color};`);
    expect(source).toContain(`--foreground: ${expected.symbolColor};`);
    expect(nativeWindowOptions("win32", mode === "dark").titleBarOverlay).toEqual({ ...expected, height: 40 });
  }
  expect(nativeWindowOptions("darwin")).toEqual({});
});

it("repaints the caption controls on a theme change except on macOS", () => {
  const window = { setTitleBarOverlay: vi.fn() };
  applyTitleBarTheme(window, "linux", true);
  expect(window.setTitleBarOverlay).toHaveBeenLastCalledWith({ ...DESKTOP_TITLE_BAR_TOKENS.dark, height: 40 });
  applyTitleBarTheme(window, "win32", false);
  expect(window.setTitleBarOverlay).toHaveBeenLastCalledWith({ ...DESKTOP_TITLE_BAR_TOKENS.light, height: 40 });
  applyTitleBarTheme(window, "darwin", true);
  expect(window.setTitleBarOverlay).toHaveBeenCalledTimes(2);
});
