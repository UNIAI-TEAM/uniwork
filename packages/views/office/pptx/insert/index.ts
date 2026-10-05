/**
 * A3ui (UNI-927) - the Insert panel's public surface.
 *
 * Self-contained by design: the UI-wire round imports from here and merges
 * `./insert-i18n` into the shared locale files. Nothing in this folder imports a
 * shared pptx view file (toolbar, editor, command map, status bar, canvas), so
 * the panel cannot race the chrome owner.
 */
export { PptxInsertPanel, type PptxInsertPanelProps } from "./pptx-insert-panel";
