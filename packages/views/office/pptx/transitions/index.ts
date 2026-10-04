// B4ui (UNI-927) - the Transitions tab body's public surface.
//
// This folder is SELF-CONTAINED: the serialized UI-wire round imports these
// names to register the Transitions tab (adds the tab/command/export and merges
// the i18n keys). Nothing here is imported by the shared editor files yet, so
// this barrel is the one seam the wire round needs.
export { PptxTransitionsPanel, type PptxTransitionsPanelProps } from "./pptx-transitions-panel";
export {
  PptxTransitionGallery,
  isPptxTransitionKind,
  resolveSelectedKind,
  transitionKindGlyph,
  transitionKindLabelKey,
  type PptxTransitionGalleryProps,
} from "./transition-gallery";
export { PptxAdvanceTiming, type PptxAdvanceTimingProps } from "./advance-timing";
export {
  advanceMsToSecondsText,
  advanceSecondsIsValid,
  parseAdvanceSeconds,
  type PptxAdvanceParse,
} from "./transition-timing";
export {
  PPTX_TRANSITIONS_I18N,
  pptxTransitionsResources,
  registerPptxTransitionsI18n,
  type PptxPanelI18nEntry,
} from "./transitions-i18n";
