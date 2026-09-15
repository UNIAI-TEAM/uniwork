import { describe, expect, it, vi } from "vitest";
import { pickLocale, resolveLocale } from "./pick-locale";
import type { LocaleAdapter } from "./types";

// No beta locale ships yet — PRODUCT.md keeps Myanmar, Khmer and Lao
// roadmap-only — so this suite adds one. The rule has to hold the day one
// lands: a beta locale is something a person picks next to its Beta label,
// never something their browser's language selects for them.
vi.mock("./types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./types")>()),
  SUPPORTED_LOCALES: ["vi", "en", "km"],
  STABLE_LOCALES: ["vi", "en"],
}));

function adapter(choice: string | null, preferences: string[]): LocaleAdapter {
  return { getUserChoice: () => choice, getSystemPreferences: () => preferences, persist: () => {} };
}

describe("a beta locale", () => {
  it("is never chosen from the browser's languages", () => {
    // CLDR's language matching sends Khmer one-way to English, so a Khmer
    // browser reads English while km is beta.
    expect(resolveLocale(null, ["km-KH"])).toBe("en");
  });

  it("is skipped for the next browser language that is stable", () => {
    expect(resolveLocale(null, ["km-KH", "vi-VN"])).toBe("vi");
  });

  it("is honoured when the user picked it", () => {
    expect(resolveLocale("km", ["vi-VN"])).toBe("km");
  });

  it("follows the same rule through a platform adapter", () => {
    expect(pickLocale(adapter(null, ["km-KH", "vi-VN"]))).toBe("vi");
    expect(pickLocale(adapter("km", []))).toBe("km");
  });
});
