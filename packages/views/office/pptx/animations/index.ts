// B5ui (UNI-927) - the Animations pane's public surface.
//
// SELF-CONTAINED: the serialized UI-wire round imports these names to register
// the Animations tab (adds the tab/command/export and merges the i18n keys).
// Nothing here is imported by the shared editor files yet, so this barrel is the
// one seam the wire round needs.
export { PptxAnimationsPanel, type PptxAnimationsPanelProps } from "./pptx-animations-panel";
export { PptxAnimationList, type PptxAnimationListProps } from "./animation-list";
export {
  animClassLabelKey,
  animDefaultDurationMs,
  animEffectClass,
  animEffectLabelKey,
  animStepNumbers,
  animTriggerLabelKey,
  isPptxAnimEffect,
  isPptxAnimTrigger,
  moveEntry,
  msToSecondsText,
  parseSecondsToMs,
  removeEntryAt,
  resolveEffect,
  resolveTrigger,
  type PptxAnimClass,
  type PptxAnimationEntry,
  type PptxSecondsParse,
} from "./animations-model";
export {
  PPTX_ANIMATIONS_I18N,
  pptxAnimationsResources,
  registerPptxAnimationsI18n,
  type PptxPanelI18nEntry,
} from "./animations-i18n";
