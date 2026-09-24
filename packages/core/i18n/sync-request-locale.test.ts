import { afterEach, describe, expect, it } from "vitest";
import i18next from "i18next";
import { initI18n } from "./index";
import en from "./locales/en.json";
import { syncRequestLocale } from "./sync-request-locale";

afterEach(async () => {
  await i18next.changeLanguage("vi");
});

describe("syncRequestLocale", () => {
  it("applies English synchronously for SSR and hydration", () => {
    initI18n();
    expect(i18next.language).toBe("vi");

    syncRequestLocale("en", en);

    expect(i18next.language).toBe("en");
    expect(i18next.t("auth.login")).toBe("Log in");
  });

  it("leaves Vietnamese when that is the request locale", () => {
    void i18next.changeLanguage("en");
    syncRequestLocale("vi");
    expect(i18next.language).toBe("vi");
    expect(i18next.t("auth.login")).toBe("Đăng nhập");
  });
});
