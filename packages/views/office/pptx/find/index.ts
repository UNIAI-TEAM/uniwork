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
