/**
 * Find & replace panel (A6ui, UNI-927) - public surface.
 *
 * Self-contained: the UI-wire round imports from here and merges `./find-i18n`
 * into the shared locale files. Nothing in this folder imports a shared pptx
 * view file, so the panel cannot race the chrome owner.
 *
 *   <PptxFindReplacePanel
 *     texts={flattenDeckRuns(deck)}          // one entry per run
 *     initialQuery={findQuery}
 *     onFindReplace={(edit) => handle.edit([edit])}
 *   />
 */
export { PptxFindReplacePanel, type PptxFindReplacePanelProps } from "./pptx-find-replace";
export {
  PPTX_FIND_UNSET_HIT,
  activeHitTarget,
  clampHitIndex,
  planFind,
  replaceAllEdit,
  replaceOneEdit,
  stepHitIndex,
  type PptxFindReplaceEdit,
  type PptxFindTextTarget,
} from "./pptx-find-model";
export { PPTX_FIND_I18N, findI18nResources, type PptxFindI18nEntry } from "./find-i18n";