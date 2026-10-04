/**
 * B1ui (UNI-927) - the Design panel's public surface.
 *
 * Self-contained by design: the serialized UI-wire round imports from here,
 * mounts `PptxDesignPanel` in the Design tab, and merges `./design-i18n` into
 * the shared locale files. Nothing in this folder imports a shared pptx view
 * file (toolbar, editor, command map, status bar, canvas), so the panel cannot
 * race the chrome owner - and no shared file needed changing for it to work.
 *
 * The edits it emits are exactly the committed B1e `ThemeEdit` union from
 * `@uniwork/office-engine/pptx`, so the wire round is a one-line binding:
 *
 *   <PptxDesignPanel
 *     onApplyEdit={(edit) => handle.edit([edit])}   // or model.applyEdit(edit)
 *     slideCount={deck.slides.length}
 *     slideIndex={selectedIndex}
 *     slideSize={deck.size}
 *     layouts={listSlideLayouts(archive)}
 *     activeLayoutPath={...}
 *   />
 */
export { PptxDesignPanel, type PptxDesignPanelProps } from "./design-panel";
export { PptxThemeGallery, type PptxThemeGalleryProps } from "./theme-gallery";
export { PptxSlideSizeControl, type PptxSlideSizeControlProps } from "./slide-size-control";
export { PptxBackgroundDialog, type PptxBackgroundDialogProps } from "./background-dialog";
export { PptxLayoutPicker, type PptxLayoutPickerProps } from "./layout-picker";
export {
  EMU_PER_INCH,
  PPTX_DESIGN_SLIDE_SIZES,
  PPTX_DESIGN_THEMES,
  buildBackgroundEdit,
  buildGraphicsHiddenEdit,
  buildLayoutEdit,
  buildSlideSizeEdit,
  buildThemeEdit,
  emuToInches,
  imageExtension,
  isFillColor,
  matchSlideSizePreset,
  nextRovingIndex,
  normalizeHex,
  parseAngleDeg,
  rovingEntryIndex,
  slideIndexRange,
  themeSwatch,
  type PptxDesignBackgroundFill,
  type PptxDesignBackgroundRequest,
  type PptxDesignLayout,
  type PptxDesignSlideSize,
  type PptxDesignTheme,
} from "./design-model";
export {
  PPTX_DESIGN_I18N,
  designPanelDictionary,
  type PptxDesignI18nEntry,
  type PptxDesignLocale,
} from "./design-i18n";