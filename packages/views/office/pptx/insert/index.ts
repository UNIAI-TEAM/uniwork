/**
 * A3ui (UNI-927) - the Insert panel's public surface.
 *
 * Self-contained by design: the UI-wire round imports from here and merges
 * `./insert-i18n` into the shared locale files. Nothing in this folder imports a
 * shared pptx view file (toolbar, editor, command map, status bar, canvas), so
 * the panel cannot race the chrome owner.
 */
export { PptxInsertPanel, type PptxInsertPanelProps } from "./pptx-insert-panel";
export { PptxShapeGallery, type PptxShapeGalleryProps } from "./pptx-shape-gallery";
export { PptxWordArtPicker, type PptxWordArtPickerProps } from "./pptx-wordart-picker";
export { PptxImageInsert, type PptxImageBytes, type PptxImageInsertProps } from "./pptx-image-insert";
export { PptxConnectorPicker, type PptxConnectorPickerProps } from "./pptx-connector-picker";
export {
  PPTX_CONNECTOR_ARROWS,
  PPTX_CONNECTOR_KINDS,
  PPTX_CONNECTABLE_TYPES,
  PPTX_IMAGE_ACCEPT,
  PPTX_IMAGE_EXTS,
  PPTX_INSERT_COMMAND_IDS,
  PPTX_INSERT_FLAT_PRSTS,
  PPTX_INSERT_LINE_PRSTS,
  PPTX_INSERT_PICTURE_BOX,
  PPTX_INSERT_SHAPE_GROUPS,
  PPTX_INSERT_TEXT_BOX_KIND,
  PPTX_INSERT_WORDART_BOX,
  PPTX_INSERT_WORDART_PRESETS,
  addElementEdit,
  defaultInsertBox,
  groupableSelection,
  imageExtFromName,
  shapePreviewBox,
  shapePreviewPath,
  validateConnectorRequest,
  wordArtParagraphs,
  wordArtStrokePt,
  wordArtStrokePx,
  type PptxConnectorArrow,
  type PptxConnectorKind,
  type PptxInsertBox,
  type PptxInsertCommandId,
  type PptxInsertConnectorRequest,
  type PptxInsertConnectorValidation,
  type PptxInsertEdit,
  type PptxInsertElementRef,
  type PptxInsertShape,
  type PptxInsertShapeGroup,
  type PptxInsertWordArtPreset,
} from "./insert-model";
export {
  PPTX_INSERT_I18N,
  pptxInsertI18nVars,
  pptxInsertNestedDictionary,
  type PptxInsertI18nEntry,
} from "./insert-i18n";