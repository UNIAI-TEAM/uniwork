export { createPptxCommandMap, findPptxCommand, type PptxCommand, type PptxCommandCapability, type PptxCommandId } from "./command-map";
export { PptxSlideRail, type PptxSlideRailProps, type PptxSlideView } from "./slide-rail";
export { PptxPresenter, type PptxPresenterProps } from "./presenter";
export { PptxStatusBar, pptxLanguageLabel, type PptxStatusBarProps, type PptxStatusCounts } from "./status-bar";
export { PptxToolbar, type PptxToolbarProps } from "./toolbar";
export { PptxCommandButton, type PptxCommandButtonProps } from "./toolbar/command-button";
export { PPTX_FIND_COMMAND, PPTX_QUICK_ACCESS_COMMANDS, PPTX_RIBBON_CONTEXTUAL_TABS, PPTX_RIBBON_TABS, PPTX_TAB_ROW_COMMANDS, PPTX_VIEW_TOGGLE_COMMAND, pptxGroupPriority, pptxRibbonCommandIds, pptxRibbonTabs, type PptxGroupId, type PptxRibbonContextualSelection, type PptxRibbonContextualTabSpec, type PptxRibbonGroupSpec, type PptxRibbonOptions, type PptxRibbonPanelSpec, type PptxRibbonTabSpec, type PptxTabId } from "./pptx-ribbon";
// UNI-927 D1: the desktop host mounts this format view through the package
// entry, so the view and the opaque deck model are re-exported here.
export { PptxEditorView, type PptxEditorViewProps } from "./editor-view";
export type { PptxDeckModel } from "./canvas/deck-renderer";

// UNI-927 WIRE3: mount every built-but-unmounted panel through the lane barrel.
export { PptxDesignPanel, type PptxDesignPanelProps } from "./design";
export { PptxSorterPanel, type PptxSorterPanelProps } from "./sorter";
export { PptxInsertPanel, type PptxInsertPanelProps } from "./insert";
export { PptxAnimationsPanel, type PptxAnimationsPanelProps } from "./animations";
export { PptxTransitionsPanel, type PptxTransitionsPanelProps } from "./transitions";
export { PptxChartsPanel, type PptxChartsPanelProps } from "./charts";
export { PptxFormatPanel, type PptxFormatPanelProps } from "./format";
export { PptxFindReplacePanel, flattenDeckRuns, type PptxFindReplacePanelProps } from "./find";
export { PptxLinkEditor, type PptxLinkEditorProps } from "./links";

// UNI-927 B2ui: the Tables tab body and its pure model. Self-contained (no
// shared pptx view file is imported), so the serialized UI-wire round can mount
// it without racing the chrome owner.
export { PptxTablesPanel, type PptxTablesPanelProps } from "./tables/pptx-tables-panel";
export {
  PPTX_TABLE_STYLE_PRESETS,
  buildCellAnchorEdit,
  buildCellTextEdit,
  buildColWidthEdit,
  buildInsertTableEdit,
  buildMergeEdit,
  buildRowHeightEdit,
  buildStructureEdit,
  buildStyleFlagsEdit,
  buildStylePresetEdit,
  cellParagraphs,
  validateTableSize,
  validateTableTarget,
  type PptxTableRefusal,
  type PptxTableRefusalCode,
  type PptxTableTarget,
  type PptxTableValidation,
} from "./tables/table-model";

// UNI-927 WIRE-TEXT: the text-format panel (text-format-model + pptx-text-format-panel).
export { PptxTextFormatPanel, type PptxTextFormatPanelProps } from "./text/pptx-text-format-panel";

// UNI-939 T01 (B6): the master/layout view types the web and desktop adapters read.
export type { MasterElementView, MasterPartView } from "./masters";
