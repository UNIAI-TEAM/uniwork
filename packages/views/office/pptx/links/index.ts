/**
 * Hyperlink editor (A6ui, UNI-927) - public surface.
 *
 * Self-contained: the UI-wire round imports from here and merges `./links-i18n`
 * into the shared locale files. Nothing in this folder imports a shared pptx
 * view file, so the editor cannot race the chrome owner.
 *
 *   <PptxLinkEditor
 *     slideIndex={selectedIndex}
 *     elementId={selectedIds.length === 1 ? selectedIds[0] : null}
 *     link={currentLink}
 *     slideCount={deck.slides.length}
 *     onSetLink={(edit) => handle.edit([edit])}
 *   />
 */
export { PptxLinkEditor, type PptxLinkEditorProps } from "./pptx-link-editor";
export {
  PPTX_DEFAULT_NAMED_ACTION,
  PPTX_LINK_MODES,
  PPTX_LINK_URL_PREFIX,
  buildSetLinkEdit,
  draftFromLink,
  linkSummary,
  normalizeUrl,
  validateLinkDraft,
  type PptxLinkDraft,
  type PptxLinkMode,
  type PptxLinkSummary,
  type PptxLinkValidation,
  type PptxSetLinkEdit,
} from "./pptx-link-model";
export { PPTX_LINK_I18N, linkI18nResources, type PptxLinkI18nEntry } from "./links-i18n";