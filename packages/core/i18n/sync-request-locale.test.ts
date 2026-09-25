import { afterEach, describe, expect, it } from "vitest";
import i18next from "i18next";
import { initI18n } from "./index";
import vi from "./locales/vi.json";
import { syncRequestLocale } from "./sync-request-locale";

afterEach(async () => {
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
});
