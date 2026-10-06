import { SUPPORTED_LOCALES } from "@uniwork/core/i18n";
import { describe, expect, it, vi } from "vitest";
import { pickDesktopLocale } from "../renderer/appearance";
import { systemLanguages } from "./appearance";
import { DESKTOP_MAIN_LOCALES, mainStrings, resolveDesktopLocale } from "./strings";

const CASES: [readonly string[], "vi" | "en"][] = [
  [["vi-VN", "en-US"], "vi"],
  [["en-US", "vi-VN"], "en"],
  // The first SUPPORTED language in the OS list wins...
  [["fr-FR", "en-US"], "en"],
  [["fr-FR", "vi"], "vi"],
  [["EN_gb"], "en"],
  // ...and a list with none ends at Vietnamese.
  [["fr"], "vi"],
  [["de-DE", "ja-JP"], "vi"],
  [[], "vi"],
];

describe("desktop app language", () => {
  it("takes the first supported OS language, else Vietnamese", () => {
    for (const [languages, expected] of CASES) expect(resolveDesktopLocale(languages), languages.join(",")).toBe(expected);
  });

  it("resolves exactly like the renderer, over the same locales", () => {
    expect([...DESKTOP_MAIN_LOCALES].sort()).toEqual([...SUPPORTED_LOCALES].sort());
    for (const [languages] of CASES) expect(resolveDesktopLocale(languages), languages.join(",")).toBe(pickDesktopLocale(languages));
  });

  it("follows --lang alone and ignores Chromium's en-US fallback", () => {
    const lang = { hasSwitch: (name: string) => name === "lang" };
    expect(resolveDesktopLocale(systemLanguages({ getLocale: () => "fr", getPreferredSystemLanguages: () => ["en-US"], commandLine: lang }))).toBe("vi");
    expect(resolveDesktopLocale(systemLanguages({ getLocale: () => "en-US", getPreferredSystemLanguages: () => ["vi-VN"], commandLine: lang }))).toBe("en");
    expect(resolveDesktopLocale(systemLanguages({ getLocale: () => "en-US", getPreferredSystemLanguages: () => ["fr-FR"] }))).toBe("vi");
  });
});

describe("main string table", () => {
  it("speaks each locale and fills placeholders", () => {
    expect(mainStrings("vi")("officeDesktop.native.menu.quitApp", { product: "UniWork Office" })).toBe("Thoát UniWork Office");
    expect(mainStrings("en")("officeDesktop.native.menu.quitApp", { product: "UniWork Office" })).toBe("Quit UniWork Office");
    expect(mainStrings("en")("officeDesktop.native.update.code", { code: "update_failed" })).toBe("Code: update_failed");
    expect(mainStrings("vi")("officeDesktop.native.update.code")).toBe("Mã: {{code}}");
  });
});

describe("platform-gate box", () => {
  it("shows the refusal in the app language only", async () => {
    const { passPlatformGate } = await import("./startup");
    const { PLATFORM_GATE_FLAG } = await import("./platform-gate");
    const flag = `${PLATFORM_GATE_FLAG}linux_too_old`;
    process.argv.push(flag);
    try {
      for (const [languages, expected, other] of [[["en-US"], "requires Ubuntu", "cần Ubuntu"], [["fr-FR"], "cần Ubuntu", "requires Ubuntu"]] as const) {
        const showErrorBox = vi.fn();
        const app = { isPackaged: false, whenReady: async () => undefined, exit: vi.fn(), getLocale: () => "en-US", getPreferredSystemLanguages: () => [...languages] };
        await expect(passPlatformGate(app as never, { showErrorBox }, false)).resolves.toBe(false);
        const message = String(showErrorBox.mock.calls[0]?.[1]);
        expect(message).toContain(expected);
        expect(message).not.toContain(other);
        expect(app.exit).toHaveBeenCalledWith(1);
      }
    } finally { process.argv.splice(process.argv.indexOf(flag), 1); }
  });
});
