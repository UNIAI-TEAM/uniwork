import { getI18n } from "react-i18next";

type PptxLocale = "en" | "vi";
type I18nInstance = NonNullable<ReturnType<typeof getI18n>>;

/**
 * Lazy registrar for a PPTX panel's own i18n keys.
 *
 * The panels' key bundles are merged into the shared i18next instance with
 * overwrite=false (the locale files win once the keys land there). That used to
 * run at module import, but the desktop renderer imports the panels before it
 * initializes i18n, so `getI18n()` was undefined and the whole renderer failed
 * to mount. The returned function is idempotent and safe at any time: it does
 * nothing until the shared instance exists and is initialized, wires the
 * `initialized` / `languageChanged` listeners once per instance, and registers
 * once per instance until a locale event asks again. State is keyed by the
 * instance, so a replaced singleton (setI18n, HMR) is wired and registered
 * afresh. Call it at the top of the panel render, before any `t()`.
 */
export function createPptxI18nRegistrar(resources: (locale: PptxLocale) => Record<string, unknown>): () => void {
  // Per instance: listeners are wired once; `registered` flips only when a
  // locale bundle was merged, never on an attempt that found no bundle.
  const states = new WeakMap<I18nInstance, { registered: boolean }>();

  const register = (i18n: I18nInstance, state: { registered: boolean }): void => {
    if (!i18n.isInitialized) return;
    for (const locale of ["en", "vi"] as const) {
      if (!i18n.hasResourceBundle(locale, "translation")) continue;
      i18n.addResourceBundle(locale, "translation", resources(locale), true, false);
      state.registered = true;
    }
  };

  return () => {
    const i18n = getI18n();
    if (!i18n) return;
    let state = states.get(i18n);
    if (!state) {
      const fresh = { registered: false };
      state = fresh;
      states.set(i18n, fresh);
      const onEvent = (): void => register(i18n, fresh);
      if (!i18n.isInitialized) i18n.on("initialized", onEvent);
      i18n.on("languageChanged", onEvent);
    }
    if (!state.registered) register(i18n, state);
  };
}
