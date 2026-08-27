import { describe, expect, it } from "vitest";
import { matchLocale, parseAcceptLanguage, pickLocale } from "./pick-locale";
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

describe("parseAcceptLanguage", () => {
  it("orders tags by q-value and strips weights", () => {
    expect(parseAcceptLanguage("en-US,en;q=0.9,vi;q=0.8")).toEqual(["en-US", "en", "vi"]);
    expect(parseAcceptLanguage("vi;q=0.5, en-GB;q=0.9")).toEqual(["en-GB", "vi"]);
  });
  it("tolerates a missing or malformed header", () => {
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage("")).toEqual([]);
    expect(parseAcceptLanguage(";q=,,")).toEqual([]);
  });
  it("feeds matchLocale the same way navigator.languages does", () => {
    expect(matchLocale(parseAcceptLanguage("en-US,en;q=0.9,vi;q=0.8"))).toBe("en");
    expect(matchLocale(parseAcceptLanguage("vi-VN,vi;q=0.9,en;q=0.8"))).toBe("vi");
    expect(matchLocale(parseAcceptLanguage("fr-FR"))).toBe("vi");
  });
});
