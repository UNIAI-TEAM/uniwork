import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  // Importing electron-main boots the host; whenReady never settles here, so the
  // mock only needs the calls reached before it (single-instance lock first).
  app: {
    on: vi.fn(), getPath: () => process.cwd(), setPath: vi.fn(), setAppUserModelId: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true), hasSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(), exit: vi.fn(), whenReady: () => new Promise(() => undefined),
  },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  BrowserWindow: vi.fn(), dialog: {}, ipcMain: {}, Menu: {}, nativeTheme: {}, net: {}, safeStorage: {}, shell: {},
}));
vi.mock("../shared/deployment", () => ({ resolveDeploymentProfile: () => ({ kind: "setup-required" }) }));

it("keeps the window wide enough that the tab strip and ribbon never overlap", async () => {
  const { DESKTOP_WINDOW_MIN_SIZE } = await import("../electron-main");
  expect(DESKTOP_WINDOW_MIN_SIZE).toEqual({ minWidth: 640, minHeight: 480 });
  // The BrowserWindow is built with it, not only exported.
  expect(readFileSync(new URL("../electron-main.ts", import.meta.url), "utf8")).toContain("...DESKTOP_WINDOW_MIN_SIZE,");
});

it("matches the 40px strip and semantic muted/foreground colors in both themes", async () => {
  const { nativeWindowOptions, DESKTOP_TITLE_BAR_TOKENS } = await import("../electron-main");
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
