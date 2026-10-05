/**
 * Find & replace panel (A6ui, UNI-927) - public surface.
 *
 * Self-contained: the editor imports from here; the strings live in the shared
 * locale files under `office.pptx.find`. Nothing in this folder imports a shared
 * pptx view file, so the panel cannot race the chrome owner.
 *
 *   <PptxFindReplacePanel
 *     texts={flattenDeckRuns(deck)}          // one entry per run
 *     initialQuery={findQuery}
 *     onFindReplace={(edit) => handle.edit([edit])}
 *   />
 */
export { PptxFindReplacePanel, type PptxFindReplacePanelProps } from "./pptx-find-replace";
export { flattenDeckRuns, type PptxFindReplaceEdit } from "./pptx-find-model";
export { usePptxFindSelect } from "./use-pptx-find-select";
