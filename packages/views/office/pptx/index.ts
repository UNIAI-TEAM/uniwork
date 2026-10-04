export { createPptxCommandMap, findPptxCommand, type PptxCommand, type PptxCommandCapability, type PptxCommandId } from "./command-map";
export { PptxSlideRail, type PptxSlideRailProps, type PptxSlideView } from "./slide-rail";
export { PptxPresenter, type PptxPresenterProps } from "./presenter";
export { PptxStatusBar, pptxLanguageLabel, type PptxStatusBarProps, type PptxStatusCounts } from "./status-bar";
export { PptxToolbar, type PptxToolbarProps } from "./toolbar";
export { PptxCommandButton, type PptxCommandButtonProps } from "./toolbar/command-button";
export { PptxFindBar, type PptxFindBarProps } from "./toolbar/find-bar";
export { PPTX_FIND_COMMAND, PPTX_QUICK_ACCESS_COMMANDS, PPTX_RIBBON_CONTEXTUAL_TABS, PPTX_RIBBON_TABS, PPTX_TAB_ROW_COMMANDS, PPTX_VIEW_TOGGLE_COMMAND, pptxGroupPriority, pptxRibbonCommandIds, pptxRibbonTabs, type PptxGroupId, type PptxRibbonContextualSelection, type PptxRibbonContextualTabSpec, type PptxRibbonGroupSpec, type PptxRibbonOptions, type PptxRibbonTabSpec, type PptxTabId } from "./pptx-ribbon";
// UNI-927 D1: the desktop host mounts this format view through the package
// entry, so the view and the opaque deck model are re-exported here.
export { PptxEditorView, type PptxEditorViewProps } from "./editor-view";
export type { PptxDeckModel } from "./canvas/deck-renderer";
