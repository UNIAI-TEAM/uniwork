import { getI18n } from "react-i18next";

type PptxLocale = "en" | "vi";

/**
 * Lazy registrar for a PPTX panel's own i18n keys.
 *
 * The panels' key bundles are merged into the shared i18next instance with
 * overwrite=false (the locale files win once the keys land there). That used to
 * run at module import, but the desktop renderer imports the panels before it
 * initializes i18n, so `getI18n()` was undefined and the whole renderer failed
 * to mount. The returned function is idempotent and safe at any time: it does
 * nothing until the shared instance exists and is initialized, wires the
 * `initialized` / `languageChanged` listeners exactly once, and registers once
 * per call site until a locale event asks again. Call it at the top of the
 * panel render, before any `t()`.
 */
export function createPptxI18nRegistrar(resources: (locale: PptxLocale) => Record<string, unknown>): () => void {
  let listening = false;
  let registered = false;

  const register = (): void => {
    const i18n = getI18n();
    if (!i18n?.isInitialized) return;
    for (const locale of ["en", "vi"] as const) {
      if (!i18n.hasResourceBundle(locale, "translation")) continue;
      i18n.addResourceBundle(locale, "translation", resources(locale), true, false);
    }
    registered = true;
  };

  return () => {
    const i18n = getI18n();
    if (!i18n) return;
    if (!listening) {
      listening = true;
      i18n.on("initialized", register);
      i18n.on("languageChanged", register);
    }
    if (!registered) register();
  };
}
