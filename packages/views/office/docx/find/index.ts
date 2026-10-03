export { DocxFindPanel } from "./find-panel";
export type { DocxFindPanelProps } from "./find-panel";
export {
  applyDocxFindHighlight,
  buildFindDecorations,
  clearDocxFindHighlight,
  createDocxFindPlugin,
  docxFindPluginKey,
  mountDocxFindHighlight,
} from "./find-decoration";
export type { FindHighlight } from "./find-decoration";
export {
  clampMatchIndex,
  DEFAULT_FIND_OPTIONS,
  findMatches,
  findTextRanges,
  foldCase,
  isFindWordChar,
  matchElement,
  replaceMatches,
  revealMatch,
  stepMatchIndex,
} from "./find-state";
export type { FindMatch, FindOptions, TextRange } from "./find-state";
