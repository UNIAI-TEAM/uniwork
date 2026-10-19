import { describe, expect, it } from "vitest";
import { loadDictionary } from "@uniwork/core/i18n/server";
import { loadMarketingDictionary } from "./marketing-dictionary";

describe("public dictionary boundary", () => {
  for (const locale of ["en", "vi"] as const) it(`keeps ${locale} product copy without unrelated application dictionaries`, async () => {
    const dictionary = await loadMarketingDictionary(locale);
    const full = await loadDictionary(locale);
    expect(dictionary.landing).toEqual(full.landing);
    expect(dictionary.changelog).toEqual(full.changelog);
    expect(dictionary).toHaveProperty("documents.home.create");
    expect(dictionary).not.toHaveProperty("auth");
    expect(dictionary).toHaveProperty("home.start", (full.home as Record<string, unknown>).start);
    expect(dictionary).not.toHaveProperty("home.mywork");
    expect(dictionary).toHaveProperty("tasks.card.updated_ago");
    expect(dictionary).toHaveProperty("tasks.surface.empty_column");
    expect(dictionary).toHaveProperty("meetings.captions");
    expect(dictionary).toHaveProperty("meetings.governance.motionsTab");
    expect(dictionary).not.toHaveProperty("meetings.joinFailed");
    expect(dictionary).toHaveProperty("email_hub.folders.inbox");
    expect(dictionary).toHaveProperty("email_hub.compose.send");
    expect(dictionary).not.toHaveProperty("email_hub.connect");
    expect(JSON.stringify(dictionary).length).toBeLessThan(JSON.stringify(full).length);
  });
  it("keeps Office installer labels and omits unrelated landing sections on lean pages", async () => {
    const dictionary = await loadMarketingDictionary("vi", "/office");
    const full = await loadDictionary("vi");
    expect(dictionary).toHaveProperty("office.desktop.install.os.windows");
    expect(dictionary).toHaveProperty("landing.office.hero");
    expect(dictionary).not.toHaveProperty("landing.why");
    expect(dictionary).not.toHaveProperty("email_hub");
    expect(JSON.stringify(dictionary).length).toBeLessThan(JSON.stringify(full.landing).length);
  });
  it("serves the UniChat page its own copy and the installer labels, and only there", async () => {
    const dictionary = await loadMarketingDictionary("vi", "/unichat");
    const full = await loadDictionary("vi");
    expect(dictionary).toHaveProperty("landing.unichat.hero.title");
    expect(dictionary).toHaveProperty("office.desktop.install.fmt.mac_arm");
    expect(dictionary).not.toHaveProperty("landing.office.hero");
    expect(dictionary).not.toHaveProperty("chat");
    expect(JSON.stringify(dictionary).length).toBeLessThan(JSON.stringify(full.landing).length);
    expect(await loadMarketingDictionary("vi", "/office")).not.toHaveProperty("landing.unichat");
  });
  it("also supplies the standalone email preview without the account connection wizard", async () => {
    const dictionary = await loadMarketingDictionary("vi", "/features/email");
    expect(dictionary).toHaveProperty("email_hub.folder_menu");
    expect(dictionary).toHaveProperty("email_hub.shortcuts");
    expect(dictionary).not.toHaveProperty("email_hub.connect");
  });
});
