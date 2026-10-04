/**
 * A2 UI half (UNI-927) - the slide sorter's public surface.
 *
 * The UI-wire round imports `PptxSorterPanel` from `@uniwork/views/office/pptx`
 * (the lane barrel re-exports this folder) and mounts it behind a View-tab command,
 * passing `editorHandle.edit` as `onEdit` and the deck's slides/sections.
 */
export { PptxSorterPanel, type PptxSorterPanelProps } from "./sorter-panel";
export { PptxSorterSections, type PptxSorterSectionsProps } from "./sorter-sections";
export { PptxSortableSlideTile, type PptxSortableSlideTileProps } from "./sortable-slide-tile";
export {
  addSectionEdit,
  addSlideEdit,
  compactEdits,
  deleteSlideEdit,
  duplicateSlideEdit,
  moveSectionEdit,
  moveSlideEdit,
  removeSectionEdit,
  renameSectionEdit,
  setSlideHiddenEdit,
} from "./sorter-edits";
export {
  canMoveSection,
  clampSlideIndex,
  groupRangeLabel,
  keyboardReorderTarget,
  layoutPickerValue,
  nextSectionNumber,
  normalizeSectionName,
  reorderSlideTargets,
  sectionIdAtSlide,
  sorterSectionGroups,
  type PptxSlideMove,
  type PptxSorterLayout,
  type PptxSorterSlide,
} from "./sorter-helpers";
export { PPTX_SORTER_MESSAGES, pptxSorterI18nResources, type PptxSorterMessage } from "./sorter-i18n";