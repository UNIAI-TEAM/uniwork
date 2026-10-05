/**
 * B7ui (UNI-927) - the Header/Footer panel's public surface.
 *
 * Self-contained by design: the serialized UI-wire round imports from here,
 * mounts `PptxHeaderFooterPanel` behind the Insert/Header & Footer command, and
 * merges `./headerfooter-i18n` into the shared locale files. Nothing in this
 * folder imports a shared pptx view file (toolbar, editor, command map, status
 * bar, canvas), so the panel cannot race the chrome owner.
 *
 * The edit it emits is exactly the committed B7e `apply_header_footer` union
 * member from `@uniwork/office-engine/pptx`, so the wire round is a one-line
 * binding:
 *
 *   <PptxHeaderFooterPanel
 *     onApplyEdit={(edit) => handle.edit([edit])}   // or model.applyEdit(edit)
 *     slideCount={deck.slides.length}
 *     settings={readHeaderFooter(deck.slides[0])}
 *   />
 */
export { PptxHeaderFooterPanel } from "./pptx-headerfooter-panel";
