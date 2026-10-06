/**
 * B3ui (UNI-927) - the Charts panel's public surface.
 *
 * Self-contained by design: the serialized UI-wire round imports from here,
 * mounts `PptxChartsPanel` in the Charts tab, and merges `./charts-i18n` into
 * the shared locale files. Nothing in this folder imports a shared pptx view
 * file (toolbar, editor, command map, status bar, canvas), so the panel cannot
 * race the chrome owner - and no shared file needed changing for it to work.
 *
 * The edits it emits are exactly the committed B3e `ChartEdit` union from
 * `@uniwork/office-engine/pptx`, so the wire round is a one-line binding:
 *
 *   <PptxChartsPanel
 *     onApplyEdit={(edit) => handle.edit([edit])}   // or model.applyEdit(edit)
 *     slideCount={deck.slides.length}
 *     slideIndex={selectedIndex}
 *     chartElementId={selectedChartId}
 *     chartKind={selectedChart?.kind}
 *     chartData={selectedChart?.data}
 *     chartStyle={selectedChart?.style}
 *   />
 */
export { PptxChartsPanel, type PptxChartsPanelProps } from "./pptx-charts-panel";
