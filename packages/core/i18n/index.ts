import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import vi from "./locales/vi.json";

export function initI18n() {
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      lng: "vi",
      fallbackLng: "vi",
      resources: { vi: { translation: vi }, en: { translation: en } },
      interpolation: { escapeValue: false },
    });
  }
  return i18next;
}
