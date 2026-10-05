/**
 * Test-only helper: register the Header/Footer panel's own dictionary with the
 * shared i18next instance.
 *
 * The panel keeps its keys in `headerfooter-i18n.ts` (the shared locale files
 * belong to the UI-wire round), so a component test must install them before
 * asserting on rendered copy. `initI18n()` returns the shared instance, which is
 * the same seam every other pptx test uses. The serialized UI-wire round deletes
 * this step by merging the same entries into
 * `packages/core/i18n/locales/{en,vi}.json`.
 */
import { initI18n } from "@uniwork/core/i18n";
import { headerFooterPanelDictionary } from "./headerfooter-i18n";

/** Idempotent: adding the same bundle twice deep-merges to the same values. */
export function installHeaderFooterPanelI18n(): void {
  const instance = initI18n();
  instance.addResourceBundle("en", "translation", headerFooterPanelDictionary("en"), true, true);
  instance.addResourceBundle("vi", "translation", headerFooterPanelDictionary("vi"), true, true);
}