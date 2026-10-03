// G3-05c (UNI-824) - the `./WorkbookVisuals` scope boundary for the ported
// sheets renderer. Charts, shapes, sparklines, cell images and the visual
// edit layer are `engine-gap`/out of this slice's render scope (the approved
// checkpoint section 2), so the vendored `univer-sync` installers are no-ops
// here: nothing is installed, nothing pretends to be. The predicates return
// the truthful "no visual interaction in progress" value.
export function installWorkbookVisuals(): [] {
  return [];
}

export function installCellImages(): [] {
  return [];
}

export function installSparklines(): [] {
  return [];
}

export function isVisualDragActive(): boolean {
  return false;
}

export function isChartEditorOpen(): boolean {
  return false;
}
