/**
 * The Office editors' copy (`office.*`, `officeDesktop.*`), kept out of the
 * dictionary every route loads.
 *
 * `locales/en.json` is the one dictionary in the shared client chunk
 * (scripts/bundle-budget.mjs), so the editors' ~18 KB gzip of strings would
 * be paid by login, tasks and chat for a screen they never open. This module
 * is imported by the code that renders an editor (the web editor hosts, the
 * desktop renderer, the views/desktop test setups), and registering both
 * locales at import time means the strings are in i18next before that code's
 * first render — a locale switch later only merges `vi.json` beside them.
 */
import i18next from "i18next";
import en from "./locales/office.en.json";
import vi from "./locales/office.vi.json";

const OFFICE_DICTIONARIES = { en, vi } as const;

function addOfficeStrings(): void {
  for (const [locale, dictionary] of Object.entries(OFFICE_DICTIONARIES)) {
    i18next.addResourceBundle(locale, "translation", dictionary, true, true);
  }
}

// `i18next` only, not `./index`: importing that would drag react-i18next into
// every caller. Before init there is no resource store, so the bundles wait
// for the "initialized" event (emitted synchronously, ahead of any render).
if (i18next.isInitialized) addOfficeStrings();
else i18next.on("initialized", addOfficeStrings);
