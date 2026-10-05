// B5ui (UNI-927) - the Animations pane's public surface.
//
// SELF-CONTAINED: the serialized UI-wire round imports these names to register
// the Animations tab (adds the tab/command/export and merges the i18n keys).
// Nothing here is imported by the shared editor files yet, so this barrel is the
// one seam the wire round needs.
export { PptxAnimationsPanel, type PptxAnimationsPanelProps } from "./pptx-animations-panel";

export { type PptxAnimationEntry } from "./animations-model";
