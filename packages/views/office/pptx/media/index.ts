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
export { PptxMediaPanel } from "./pptx-media-insert";
