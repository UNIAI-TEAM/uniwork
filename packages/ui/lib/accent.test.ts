import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACCENTS,
  ACCENT_NAMES,
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  accentBootScript,
  accentSwatchVars,
  applyAccent,
  readStoredAccent,
} from "./accent";

describe("accent themes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-accent");
    document.documentElement.removeAttribute("style");
  });

  it("writes the four derivation properties tokens.css reads", () => {
    // A missing property makes oklch() invalid and the brand slot falls back to
    // the inherited violet — a silent no-op rather than an error.
    applyAccent("blue", document.documentElement);
    const root = document.documentElement;
    expect(root.getAttribute("data-accent")).toBe("blue");
    expect(root.style.getPropertyValue("--accent-h")).toBe(String(ACCENTS.blue.h));
    expect(root.style.getPropertyValue("--accent-c")).toBe(String(ACCENTS.blue.c));
    expect(root.style.getPropertyValue("--accent-l")).toBe(String(ACCENTS.blue.l));
    expect(root.style.getPropertyValue("--accent-l-dark")).toBe(String(ACCENTS.blue.lDark));
  });

  it("clears the attribute for the default accent", () => {
    // Violet IS the :root palette. Leaving data-accent on would re-derive it
    // through oklch() and drift off the measured baseline.
    applyAccent("blue", document.documentElement);
    applyAccent(DEFAULT_ACCENT, document.documentElement);
    expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--accent-h")).toBe("");
  });

  it("falls back to the default for an unknown stored value", () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "chartreuse");
    expect(readStoredAccent()).toBe(DEFAULT_ACCENT);
  });

  it("gives every accent a swatch and a translation key", () => {
    const en = JSON.parse(
      readFileSync(resolve(process.cwd(), "../core/i18n/locales/en.json"), "utf8"),
    ) as { settings: { preferences: { accents: Record<string, string> } } };
    const labels = en.settings.preferences.accents;
    for (const name of ACCENT_NAMES) {
      const vars = accentSwatchVars(name);
      expect(vars["--sw"]).toMatch(/^oklch\(/);
      expect(vars["--sw-dark"]).toMatch(/^oklch\(/);
      expect(labels[name], `no label for accent ${name}`).toBeTruthy();
    }
  });

  it("boots the stored accent before paint", () => {
    // The script ships as a string in the document, so a syntax error would
    // only surface as a blank theme in the browser. Run it here instead.
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "mint");
    new Function(accentBootScript())();
    expect(document.documentElement.getAttribute("data-accent")).toBe("mint");
    expect(document.documentElement.style.getPropertyValue("--accent-h")).toBe(String(ACCENTS.mint.h));
  });
});
