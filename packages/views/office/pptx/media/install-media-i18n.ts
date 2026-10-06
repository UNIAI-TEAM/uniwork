/**
 * Test-only helper: register the Media panel's own dictionary with the shared
 * i18next instance. The panel keeps its keys in `media-i18n.ts` (the shared
 * locale files are edited by the UI-wire round), so a component test must
 * install them before asserting on rendered copy.
 */
import { initI18n } from "@uniwork/core/i18n";
import { mediaPanelDictionary } from "./media-i18n";

/** Idempotent: adding the same bundle twice deep-merges to the same values. */
export function installMediaPanelI18n(): void {
  const instance = initI18n();
  instance.addResourceBundle("en", "translation", mediaPanelDictionary("en"), true, true);
  instance.addResourceBundle("vi", "translation", mediaPanelDictionary("vi"), true, true);
}