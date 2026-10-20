import type { WebPreferences } from "electron";

// Pinned by renderer-web-preferences.test.ts: webSecurity and plugins stay at
// Electron's defaults, so they are deliberately not keys here.
export function createRendererWebPreferences(preloadPath: string): WebPreferences {
  return { preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false };
}
