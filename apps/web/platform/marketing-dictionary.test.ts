import { describe, expect, it } from "vitest";
import { loadDictionary } from "@uniwork/core/i18n/server";
import { loadMarketingDictionary } from "./marketing-dictionary";

describe("public dictionary boundary", () => {
  for (const locale of ["en", "vi"] as const) it(`keeps ${locale} product copy without application dictionaries`, async () => {
    const dictionary = await loadMarketingDictionary(locale);
    const full = await loadDictionary(locale);
    expect(dictionary.landing).toEqual(full.landing);
    expect(dictionary.changelog).toEqual(full.changelog);
    expect(dictionary).not.toHaveProperty("documents");
    expect(dictionary).not.toHaveProperty("auth");
    expect(JSON.stringify(dictionary).length).toBeLessThan(JSON.stringify(full).length);
  });
  it("keeps Office installer labels and omits unrelated landing sections on lean pages", async () => {
    const dictionary = await loadMarketingDictionary("vi", "/office");
    const full = await loadDictionary("vi");
    expect(dictionary).toHaveProperty("office.desktop.install.os.windows");
    expect(dictionary).toHaveProperty("landing.office.hero");
    expect(dictionary).not.toHaveProperty("landing.why");
    expect(JSON.stringify(dictionary).length).toBeLessThan(JSON.stringify(full.landing).length);
  });
});
