// The language the person chose in Settings, read from the device once per launch and held in one store, as the
// theme is (data/theme-preference.ts). Two rules beyond the theme's (audit "locale-formatting-consistency"):
//
// - The choice is saved with the system language of that moment ("en|vi"). The system's per-app language (iOS
//   Settings › UniChat › Language, Android 13+ app languages) can change after it; when the system language
//   differs from the one recorded, the person changed it last, in the system, and the system wins — the saved
//   choice is replaced by the system's, so it cannot come back if the system is switched again. A value saved
//   before this rule ("en") has no system recorded and stands.
// - `ready` turns true once the read has answered (or failed): the splash waits for it, so the first frame is
//   already in the right language (app/_layout.tsx › useSplashUntilReady).
//
// Storage and i18next come in as dependencies so this stays a node test; components/app/i18n-provider.tsx wires them.
import { createStore } from "zustand/vanilla";
import type { SupportedLocale } from "@/lib/i18n/singleton";
import { bestEffort } from "./report";

const isLocale = (value: unknown): value is SupportedLocale => value === "vi" || value === "en";

/** What is saved for a choice made while the system spoke `system`. */
export function encodeLocaleChoice(choice: SupportedLocale, system: SupportedLocale): string {
  return `${choice}|${system}`;
}

/** The language to use from what was saved, and whether the saved value must be replaced (the system moved on). */
export function resolveLocaleChoice(saved: string | null, system: SupportedLocale): { locale: SupportedLocale; replace: boolean } {
  const [choice, recorded] = (saved ?? "").split("|");
  if (!isLocale(choice)) return { locale: system, replace: false };
  if (isLocale(recorded) && recorded !== system) return { locale: system, replace: true };
  return { locale: choice, replace: false };
}

interface LocaleDeps {
  /** The phone's language among those the app speaks (lib/i18n/singleton.ts › matchSupportedLocale). */
  system: SupportedLocale;
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  /** Hands the language to i18next. */
  apply: (locale: SupportedLocale) => void;
}

export function createLocalePreference(deps: LocaleDeps) {
  const store = createStore<{ locale: SupportedLocale; ready: boolean }>(() => ({ locale: deps.system, ready: false }));
  let loading: Promise<void> | null = null;
  // A choice made while the saved one was still being read wins over it.
  let chosen = false;
  const save = (value: string, what: string) => void deps.write(value).catch(bestEffort("i18n", what, "breadcrumb"));
  return {
    store,
    /** Reads the saved choice and applies it; once per launch, however often it is called. */
    load(): Promise<void> {
      loading ??= deps
        .read()
        .then((saved) => {
          if (chosen) return;
          const { locale, replace } = resolveLocaleChoice(saved, deps.system);
          if (replace) save(encodeLocaleChoice(locale, deps.system), "system language not saved");
          if (locale === store.getState().locale) return;
          store.setState({ locale });
          deps.apply(locale);
        })
        // An unreadable preference leaves the phone's language in place.
        .catch(bestEffort("i18n", "saved language not read", "breadcrumb"))
        .finally(() => store.setState({ ready: true }));
      return loading;
    },
    set(locale: SupportedLocale): void {
      chosen = true;
      store.setState({ locale, ready: true });
      deps.apply(locale);
      // The choice holds for this launch even when it cannot be saved.
      save(encodeLocaleChoice(locale, deps.system), "language not saved");
    },
  };
}
