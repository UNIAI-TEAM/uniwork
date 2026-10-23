import { describe, expect, it } from "vitest";
import { createRendererWebPreferences } from "./renderer-web-preferences";

const PRELOAD = "/app/dist/preload/index.js";

describe("createRendererWebPreferences", () => {
  it("pins the three security flags", () => {
    const prefs = createRendererWebPreferences(PRELOAD);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
  });

  it("uses the injected preload path and nothing else", () => {
    const prefs = createRendererWebPreferences(PRELOAD);
    expect(prefs.preload).toBe(PRELOAD);
    // webSecurity and plugins stay at Electron's defaults: not even set.
    expect(Object.keys(prefs).sort()).toEqual(["contextIsolation", "nodeIntegration", "preload", "sandbox"]);
    expect("webSecurity" in prefs).toBe(false);
  });
});
