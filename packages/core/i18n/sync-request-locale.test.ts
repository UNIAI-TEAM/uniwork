import { afterEach, describe, expect, it } from "vitest";
import i18next from "i18next";
import { initI18n } from "./index";
import en from "./locales/en.json";
import vi from "./locales/vi.json";
import { syncRequestLocale } from "./sync-request-locale";

afterEach(async () => {
  i18next.removeResourceBundle("en", "translation");
  i18next.addResourceBundle("en", "translation", en);
  i18next.removeResourceBundle("vi", "translation");
  i18next.addResourceBundle("vi", "translation", vi);
  await i18next.changeLanguage("en");
});

describe("syncRequestLocale", () => {
  it("starts in English, the product default", () => {
    initI18n();
    expect(i18next.language).toBe("en");
    expect(i18next.t("auth.login")).toBe("Log in");
  });

  it("applies Vietnamese synchronously for SSR and hydration", () => {
    initI18n();
    syncRequestLocale("vi", vi);

    expect(i18next.language).toBe("vi");
    expect(i18next.t("auth.login")).toBe("Đăng nhập");
  });

  it("leaves English when that is the request locale", () => {
    void i18next.changeLanguage("vi");
    syncRequestLocale("en");
    expect(i18next.language).toBe("en");
    expect(i18next.t("auth.login")).toBe("Log in");
  });

  it("refreshes an initialized English bundle before SSR renders", () => {
    initI18n();
    i18next.removeResourceBundle("en", "translation");
    i18next.addResourceBundle("en", "translation", {
      landing: { studio: { heroDescription: "Tasks, meetings, conversations and AI, connected." } },
    });

    syncRequestLocale("en");

    expect(i18next.t("landing.studio.heroDescription")).toBe(en.landing.studio.heroDescription);
  });

  it("refreshes an already loaded Vietnamese request bundle synchronously", () => {
    syncRequestLocale("vi", vi);
    i18next.removeResourceBundle("vi", "translation");
    i18next.addResourceBundle("vi", "translation", {
      landing: { studio: { heroDescription: "Công việc, họp, trao đổi và AI, kết nối với nhau." } },
    });

    syncRequestLocale("vi", vi);

    expect(i18next.t("landing.studio.heroDescription")).toBe(vi.landing.studio.heroDescription);
  });
});
