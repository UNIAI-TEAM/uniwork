/**
 * B8ui (UNI-927) - the Media panel's public surface.
 *
 * Self-contained by design: the serialized UI-wire round imports from here,
 * mounts `PptxMediaPanel`, and merges `./media-i18n` into the shared locale
 * files. Nothing in this folder imports a shared pptx view file (toolbar,
 * editor, command map, status bar, canvas), so the panel cannot race the
 * chrome owner.
 *
 * The insert edit it emits is exactly the committed B8e `MediaEdit` `add_media`
 * member from `@uniwork/office-engine/pptx`; replace/remove reuse the already
 * registered `replace_picture` / `delete_element` kinds, so the wire round is a
 * one-line binding:
 *
 *   <PptxMediaPanel
 *     onSelect={(edit) => handle.edit([edit])}   // or model.applyEdit(edit)
 *     slideCount={deck.slides.length}
 *     slideIndex={selectedIndex}
 *     mediaElementId={selectedMediaId}
 *   />
 */
export { PptxMediaPanel, type PptxMediaPanelProps } from "./pptx-media-insert";
export {
  PPTX_MEDIA_AUDIO_ACCEPT,
  PPTX_MEDIA_AUDIO_BOX,
  PPTX_MEDIA_AUDIO_EXTS,
  PPTX_MEDIA_KINDS,
  PPTX_MEDIA_POSTER_ACCEPT,
  PPTX_MEDIA_POSTER_EXTS,
  PPTX_MEDIA_VIDEO_ACCEPT,
  PPTX_MEDIA_VIDEO_BOX,
  PPTX_MEDIA_VIDEO_EXTS,
  buildAddMediaEdit,
  buildRemoveMediaEdit,
  buildReplaceMediaEdit,
  defaultMediaBox,
  isPosterExt,
  mediaExtFromName,
  mediaKindFromExt,
  validateMediaBox,
  validateMediaBytes,
  validateMediaExt,
  validatePoster,
  type PptxMediaAddEdit,
  type PptxMediaAddRequest,
  type PptxMediaBox,
  type PptxMediaEdit,
  type PptxMediaKind,
  type PptxMediaPoster,
  type PptxMediaRefusal,
  type PptxMediaRefusalCode,
  type PptxMediaRemoveEdit,
  type PptxMediaRemoveRequest,
  type PptxMediaReplaceEdit,
  type PptxMediaReplaceRequest,
  type PptxMediaValidation,
} from "./media-model";
export { PPTX_MEDIA_I18N, mediaPanelDictionary, pptxMediaI18nVars, type PptxMediaI18nEntry, type PptxMediaLocale } from "./media-i18n";