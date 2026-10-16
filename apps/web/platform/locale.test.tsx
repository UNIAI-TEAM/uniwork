import { renderToString } from "react-dom/server";
import { useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";
import { createI18n } from "@uniwork/core/i18n/react";
import vi from "@uniwork/core/i18n/locales/vi.json";
import { WebLocaleProvider } from "./locale";

function LoginCopy() {
  const { t } = useTranslation();
  return <p>{t("auth.login")}</p>;
}

describe("application translations after a marketing request", () => {
  for (const locale of ["en", "vi"] as const) it(`renders ${locale} from the application instance`, () => {
    // An isolated marketing instance was initialized later than the app singleton.
    createI18n("en", { en: { translation: { auth: { login: "Unrelated public instance" } } } });
    const html = renderToString(<WebLocaleProvider initialLocale={locale} initialDictionary={locale === "vi" ? vi : undefined}><LoginCopy /></WebLocaleProvider>);
    expect(html).toContain(locale === "vi" ? "Đăng nhập" : "Log in");
    expect(html).not.toContain("Unrelated public instance");
  });
});
