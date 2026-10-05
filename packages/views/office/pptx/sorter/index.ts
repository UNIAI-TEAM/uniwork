/**
 * A2 UI half (UNI-927) - the slide sorter's public surface.
 *
 * The UI-wire round imports `PptxSorterPanel` from `@uniwork/views/office/pptx`
 * (the lane barrel re-exports this folder) and mounts it behind a View-tab command,
 * passing `editorHandle.edit` as `onEdit` and the deck's slides.
 *
 * Wire-round gap (F5): there is NO `sections` accessor on the typed runtime surface
 * today - `PptxSessionRuntime` exposes `slides()` but not sections, and the engine
 * seam (`PptxEngineFunctions`) binds `listSlideLayouts` but not the vendored
 * `getSections`. The panel consumes `sections` as a prop (correctly); the wire round
 * owns adding a `sections(modelRef)` accessor next to `slides()` rather than
 * reaching into the live model ad hoc.
 */
export { PptxSorterPanel, type PptxSorterPanelProps } from "./sorter-panel";
