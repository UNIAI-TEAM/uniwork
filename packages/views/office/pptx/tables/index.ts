/**
 * B2ui (UNI-927) - the Tables panel's public surface.
 *
 * Self-contained by design: the serialized UI-wire round imports from here,
 * mounts `PptxTablesPanel` in the Tables context, and merges `./tables-i18n`
 * into the shared locale files. Nothing in this folder imports a shared pptx
 * view file (toolbar, editor, command map, status bar, canvas), so the panel
 * cannot race the chrome owner.
 *
 * The edits it emits are exactly the committed B2e `TableEdit` union from
 * `@uniwork/office-engine/pptx`, so the wire round is a one-line binding:
 *
 *   <PptxTablesPanel
 *     onApplyEdit={(edit) => handle.edit([edit])}   // or model.applyEdit(edit)
 *     slideCount={deck.slides.length}
 *     slideIndex={selectedIndex}
 *     tableElementId={selectedTableId}
 *     cell={selectedCell}
 *   />
 */
export { PptxTablesPanel, type PptxTablesPanelProps } from "./pptx-tables-panel";
export {
  PPTX_TABLE_ANCHORS,
  PPTX_TABLE_DEFAULT_BOX,
  PPTX_TABLE_MERGE_KINDS,
  PPTX_TABLE_SIZE_MAX,
  PPTX_TABLE_SIZE_MIN,
  PPTX_TABLE_STRUCTURE_KINDS,
  PPTX_TABLE_STYLE_FLAGS,
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
  missingTargetRefusal,
  validateCellRef,
  validateLengthPx,
  validateTableSize,
  validateTableTarget,
  type PptxTableRefusal,
  type PptxTableRefusalCode,
  type PptxTableCellRef,
  type PptxTableStyleFlag,
  type PptxTableStylePreset,
  type PptxTableTarget,
  type PptxTableValidation,
} from "./table-model";
export {
  PPTX_TABLES_I18N,
  tablesPanelDictionary,
  type PptxTablesI18nEntry,
  type PptxTablesLocale,
} from "./tables-i18n";