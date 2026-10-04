/**
 * A4ui (UNI-927) - the Format panel's public surface.
 *
 * Self-contained by design: the serialized UI-wire round imports from here,
 * mounts `PptxFormatPanel` in the Format tab, and merges `./format-i18n` into
 * the shared locale files. Nothing in this folder imports a shared pptx view
 * file (toolbar, editor, command map, status bar, canvas), so the panel cannot
 * race the chrome owner - and no shared file needed changing for it to work.
 *
 * The edits it emits are exactly the committed A4e `FormatEdit` union from
 * `@uniwork/office-engine/pptx`, so the wire round is a one-line binding:
 *
 *   <PptxFormatPanel
 *     onApplyEdit={(edit) => handle.edit([edit])}   // or model.applyEdit(edit)
 *     slideIndex={selectedSlide}
 *     selectedElementId={selection.ids[0] ?? null}
 *     selectedElementType={elementTypeOf(selection.ids[0])}
 *     selectedIds={selection.ids}
 *     fillColor={element.fill}
 *     strokeWidthEmu={element.stroke?.widthEmu ?? null}
 *   />
 */
export { PptxFormatPanel, type PptxFormatPanelProps } from "./pptx-format-panel";
export {
  PptxFormatEffectsSection,
  PptxFormatFillSection,
  PptxFormatLineSection,
  type PptxFormatSectionProps,
} from "./format-sections";
export {
  PptxFormatArrangeSection,
  PptxFormatGeometrySection,
  PptxFormatTextSection,
  type PptxFormatArrangeSectionProps,
  type PptxFormatTextSectionProps,
} from "./format-sections-b";
export {
  EMU_PER_INCH,
  EMU_PER_POINT,
  PPTX_FORMAT_ALIGN_TO,
  PPTX_FORMAT_DASHES,
  PPTX_FORMAT_SOFT_EDGE_PRESETS,
  arrangeEnabled,
  buildAlignEdit,
  buildAutofitEdit,
  buildDistributeEdit,
  buildEffectsEdit,
  buildFillEdit,
  buildFlipEdit,
  buildGroupEdit,
  buildShapeAdjustEdit,
  buildShapeGeometryEdit,
  buildStrokeEdit,
  buildTextAnchorEdit,
  buildTextBodyPropsEdit,
  buildUngroupEdit,
  buildWrapEdit,
  emuToPoints,
  formatColorInputValue,
  formatFillAllowed,
  formatOpAllowed,
  formatRefusal,
  formatStrokeAllowed,
  gradientAngleUnits,
  gradientStops,
  isFormatColor,
  normalizeFormatHex,
  parseAdjustField,
  parseDegrees,
  parseNonNegative,
  parsePoints,
  pointsToEmu,
  type PptxFormatDash,
  type PptxFormatEffects,
  type PptxFormatFill,
  type PptxFormatShadow,
  type PptxFormatStroke,
} from "./format-model";
export {
  PPTX_FORMAT_I18N,
  formatPanelDictionary,
  type PptxFormatI18nEntry,
  type PptxFormatLocale,
} from "./format-i18n";