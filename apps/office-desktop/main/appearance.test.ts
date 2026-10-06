import { expect, it, vi } from "vitest";
import { createAppearanceIpcHandler, systemLanguages } from "./appearance";
import { createDesktopHost, WINDOW_WEB_PREFERENCES } from "./index";
import { DESKTOP_TITLE_BAR_TOKENS, watchNativeTheme } from "./window";

it("orders the OS languages, puts an explicit --lang first and drops junk", () => {
  expect(systemLanguages({ getLocale: () => "en-US", getPreferredSystemLanguages: () => ["vi-VN", "en-US", "fr"] })).toEqual(["vi-VN", "en-US", "fr"]);
  expect(systemLanguages({ getLocale: () => "vi", getPreferredSystemLanguages: () => ["en-US"], commandLine: { hasSwitch: (name) => name === "lang" } })).toEqual(["vi", "en-US"]);
  expect(systemLanguages({ getLocale: () => "en-US", getPreferredSystemLanguages: () => ["../etc", "", "EN-us"] })).toEqual(["EN-us"]);
  expect(systemLanguages({ getLocale: () => "vi" })).toEqual(["vi"]);
  const many = Array.from({ length: 40 }, (_, i) => `x${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`);
  expect(systemLanguages({ getLocale: () => "en", getPreferredSystemLanguages: () => many })).toEqual(many.slice(0, 16));
});

it("answers the appearance snapshot through the validated host dispatcher", async () => {
  const snapshot = vi.fn(() => ({ dark: true, languages: ["vi-VN"] }));
  const host = createDesktopHost({
    window: { webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() } as never, webPreferences: WINDOW_WEB_PREFERENCES, loadURL: vi.fn(), setUserDataDirectory: vi.fn() },
    sender: { senderId: 1, frameId: 0, origin: "app://uniwork", expectedSenderId: 1, expectedFrameId: 0, expectedOrigin: "app://uniwork", sessionGeneration: "session_1234" },
    appearance: { snapshot },
  });
  await expect(host.dispatch("desktop:appearance", { sessionGeneration: "session_1234" })).resolves.toEqual({ dark: true, languages: ["vi-VN"] });
  await expect(host.dispatch("desktop:appearance", { sessionGeneration: "session_1234", extra: 1 })).rejects.toThrow();
  snapshot.mockReturnValueOnce({ dark: true, languages: ["<script>"] });
  await expect(host.dispatch("desktop:appearance", { sessionGeneration: "session_1234" })).rejects.toThrow();
});

it("refuses a malformed snapshot in the handler itself", () => {
  const handler = createAppearanceIpcHandler({ snapshot: () => ({ dark: "yes" }) as never })["desktop:appearance"];
  expect(() => handler()).toThrow();
});

it("repaints the caption controls and tells the renderer on every OS theme change", () => {
  let updated: (() => void) | undefined;
  const nativeTheme = { shouldUseDarkColors: false, on: vi.fn((_event: "updated", listener: () => void) => { updated = listener; }), removeListener: vi.fn() };
  const window = { setTitleBarOverlay: vi.fn(), isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } };
  const stop = watchNativeTheme(nativeTheme, window, "win32");
  nativeTheme.shouldUseDarkColors = true;
  updated?.();
  expect(window.setTitleBarOverlay).toHaveBeenLastCalledWith({ ...DESKTOP_TITLE_BAR_TOKENS.dark, height: 40 });
  expect(window.webContents.send).toHaveBeenLastCalledWith("desktop:theme-changed", { dark: true });
  nativeTheme.shouldUseDarkColors = false;
  updated?.();
  expect(window.setTitleBarOverlay).toHaveBeenLastCalledWith({ ...DESKTOP_TITLE_BAR_TOKENS.light, height: 40 });
  expect(window.webContents.send).toHaveBeenLastCalledWith("desktop:theme-changed", { dark: false });
  window.isDestroyed.mockReturnValue(true);
  updated?.();
  expect(window.webContents.send).toHaveBeenCalledTimes(2);
  stop();
  expect(nativeTheme.removeListener).toHaveBeenCalledWith("updated", updated);
});

it("leaves the macOS traffic lights alone but still tells the renderer", () => {
  let updated: (() => void) | undefined;
  const nativeTheme = { shouldUseDarkColors: true, on: (_event: "updated", listener: () => void) => { updated = listener; }, removeListener: vi.fn() };
  const window = { setTitleBarOverlay: vi.fn(), isDestroyed: () => false, webContents: { send: vi.fn() } };
  watchNativeTheme(nativeTheme, window, "darwin");
  updated?.();
  expect(window.setTitleBarOverlay).not.toHaveBeenCalled();
  expect(window.webContents.send).toHaveBeenCalledWith("desktop:theme-changed", { dark: true });
});
