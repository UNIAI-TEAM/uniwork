/**
 * Test-only helper: register the Tables panel's own dictionary with the shared
 * i18next instance. The panel keeps its keys in `tables-i18n.ts` (the shared
 * locale files belong to the UI-wire round), so a component test must install
 * them before asserting on rendered copy.
 */
import { initI18n } from "@uniwork/core/i18n";
import { tablesPanelDictionary } from "./tables-i18n";

/** Idempotent: adding the same bundle twice deep-merges to the same values. */
export function installTablesPanelI18n(): void {
  const instance = initI18n();
  instance.addResourceBundle("en", "translation", tablesPanelDictionary("en"), true, true);
  instance.addResourceBundle("vi", "translation", tablesPanelDictionary("vi"), true, true);
}