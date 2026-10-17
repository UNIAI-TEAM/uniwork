// Parity of the generated locale bundles: they are exactly what
// scripts/sync-i18n.mjs produces from packages/core (so a core copy change
// shows up here as a stale file), and vi / en carry the same keys.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, i18n, matchSupportedLocale } from "./i18n/singleton";

const appRoot = path.resolve(__dirname, "..");

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
}

function readLocale(locale: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(appRoot, "locales", `${locale}.json`), "utf8"));
}

describe("locales", () => {
  it("are what sync-i18n.mjs generates from packages/core", () => {
    expect(() => execFileSync(process.execPath, [path.join(appRoot, "scripts/sync-i18n.mjs"), "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("carry the same keys in vi and en", () => {
    expect(flatten(readLocale("en")).sort()).toEqual(flatten(readLocale("vi")).sort());
  });
});

describe("i18n singleton", () => {
  it("starts in Vietnamese and switches to English", async () => {
    expect(DEFAULT_LOCALE).toBe("vi");
    expect(SUPPORTED_LOCALES).toEqual(["vi", "en"]);
    expect(i18n.t("auth.desktop.unichat_login_title")).toBe("Chào mừng đến với UniChat");
    expect(i18n.t("mobile.tab_calls")).toBe("Cuộc gọi");
    await i18n.changeLanguage("en");
    expect(i18n.t("nav.settings")).toBe("Settings");
    await i18n.changeLanguage("vi");
  });

  it("matches the device language only between vi and en", () => {
    expect(matchSupportedLocale(["fr-FR", "en-GB"])).toBe("en");
    expect(matchSupportedLocale(["vi_VN"])).toBe("vi");
    expect(matchSupportedLocale(["fr-FR", "de"])).toBe("vi");
    expect(matchSupportedLocale([])).toBe("vi");
  });
});
