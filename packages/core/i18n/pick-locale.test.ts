import { describe, expect, it } from "vitest";
import { matchLocale, pickLocale } from "./pick-locale";
import type { LocaleAdapter } from "./types";

function makeAdapter(
  overrides: Partial<LocaleAdapter> = {},
): LocaleAdapter {
  return {
    getUserChoice: () => null,
    getSystemPreferences: () => [],
    persist: () => {},
    ...overrides,
  };
}

describe("matchLocale", () => {
  it("returns DEFAULT_LOCALE when given an empty list", () => {
    expect(matchLocale([])).toBe("vi");
  });

  it("matches a clean supported tag", () => {
    expect(matchLocale(["en"])).toBe("en");
    expect(matchLocale(["vi"])).toBe("vi");
  });

  it("collapses region-tagged BCP-47 to the supported base", () => {
    expect(matchLocale(["en-US"])).toBe("en");
    expect(matchLocale(["vi-VN"])).toBe("vi");
  });

  it("falls back to DEFAULT_LOCALE when no candidate matches", () => {
    expect(matchLocale(["fr", "de"])).toBe("vi");
  });

  it("uses the first supported candidate when multiple appear", () => {
    expect(matchLocale(["fr", "en-US", "vi"])).toBe("en");
    expect(matchLocale(["fr", "vi-VN", "en"])).toBe("vi");
  });

  it("returns DEFAULT_LOCALE for malformed BCP-47 tags rather than throwing", () => {
    expect(matchLocale(["----"])).toBe("vi");
    expect(matchLocale(["x-private-only"])).toBe("vi");
  });
});

describe("pickLocale", () => {
  it("prefers explicit user choice over system signal", () => {
    const adapter = makeAdapter({
      getUserChoice: () => "en",
      getSystemPreferences: () => ["vi-VN"],
    });
    expect(pickLocale(adapter)).toBe("en");
  });

  it("falls back to system preferences when no user choice", () => {
    const adapter = makeAdapter({
      getSystemPreferences: () => ["en-US", "vi-VN"],
    });
    expect(pickLocale(adapter)).toBe("en");
  });

  it("returns DEFAULT_LOCALE when neither choice nor preference yields a match", () => {
    const adapter = makeAdapter({
      getUserChoice: () => null,
      getSystemPreferences: () => ["fr", "de"],
    });
    expect(pickLocale(adapter)).toBe("vi");
  });

  it("ignores empty-string user choice and falls through to system", () => {
    const adapter = makeAdapter({
      getUserChoice: () => "",
      getSystemPreferences: () => ["en"],
    });
    expect(pickLocale(adapter)).toBe("en");
  });
});
