// UNI-953 - the outline level bar: Excel's "1 2 3" buttons for the row
// outline (above the row header) and the column outline (beside them, above
// the column header). The pinned Univer draws no outline bar, so this is a
// DOM strip the controller puts above the grid canvas while the active sheet
// has an outline; the canvas shrinks by the strip's height, so scroll, zoom
// and frozen panes never move it. The grid also makes room for the per-group
// bracket gutters (outline-gutter.ts): one level column per outline level,
// left of the row headers and above the column headers. Colours and sizes
// are the design tokens.
import type { OutlineAxis } from "./outline-levels";
import { outlineGutterExtent } from "./outline-gutter";

export interface OutlineLevelBar {
  /** Show 1..max+1 buttons per axis with an outline; hide the strip when
   *  neither axis has one. Rebuilds only when the levels or copy change. */
  update(levels: { rows: number; cols: number }): void;
  dispose(): void;
}

export interface OutlineLevelBarOptions {
  /** The renderer root (`.xlsx-surface`) and the grid host inside it. */
  container: HTMLElement;
  grid: HTMLElement;
  label: (key: string, params?: Record<string, unknown>) => string;
  onLevel: (axis: OutlineAxis, level: number) => void;
}

const BAR_CLASS = "uniwork-xlsx-outline-levels";
const STYLE_ID = "uniwork-xlsx-outline-levels-style";
// The strip's height is a variable so a coarse pointer gets 44px targets
// (the primitives' touch contract) and the grid shrinks by the same amount.
const STYLE = `
.xlsx-surface { --uniwork-outline-bar-height: 24px; --uniwork-outline-level-width: 16px; }
@media (pointer: coarse) { .xlsx-surface { --uniwork-outline-bar-height: 44px; --uniwork-outline-level-width: 26px; } }
.${BAR_CLASS} { display: flex; align-items: center; gap: 12px; box-sizing: border-box;
  height: var(--uniwork-outline-bar-height); padding: 0 4px; overflow: hidden;
  background: var(--color-muted); border-bottom: 1px solid var(--color-border);
  color: var(--color-muted-foreground); font-size: var(--text-caption); line-height: 1; }
.${BAR_CLASS}[hidden] { display: none; }
.${BAR_CLASS}-group { display: flex; align-items: center; gap: 2px; white-space: nowrap; }
.${BAR_CLASS}-caption { margin-inline-end: 4px; }
.${BAR_CLASS} button { box-sizing: border-box; min-width: 18px; height: 18px; padding: 0 4px;
  border: 1px solid var(--color-border); border-radius: 3px; background: var(--color-background);
  color: var(--color-foreground); font: inherit; font-weight: 600; cursor: pointer; }
.${BAR_CLASS} button:hover { background: var(--color-surface-hover); }
@media (pointer: coarse) { .${BAR_CLASS} button { min-width: 44px; height: 44px; } }
`;

function installStyle(document: Document): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

/** The grid's box: below the strip and the column gutter, right of the row
 *  gutter; the whole container without an outline. */
function layoutGrid(grid: HTMLElement, levels: { rows: number; cols: number } | null): void {
  const rows = outlineGutterExtent(levels?.rows ?? 0);
  const cols = outlineGutterExtent(levels?.cols ?? 0);
  grid.style.height = levels ? `calc(100% - var(--uniwork-outline-bar-height) - ${cols})` : "100%";
  grid.style.width = levels ? `calc(100% - ${rows})` : "100%";
  grid.style.marginTop = levels ? cols : "";
  grid.style.marginLeft = levels ? rows : "";
}

export function createOutlineLevelBar(options: OutlineLevelBarOptions): OutlineLevelBar {
  const { container, grid, label, onLevel } = options;
  const document = container.ownerDocument;
  let bar: HTMLElement | null = null;
  let renderedKey = "";

  const axisGroup = (axis: OutlineAxis, max: number): HTMLElement => {
    const group = document.createElement("div");
    group.className = `${BAR_CLASS}-group`;
    group.setAttribute("role", "group");
    const name = label(axis === "rows" ? "outlineLevelsRows" : "outlineLevelsCols");
    group.setAttribute("aria-label", name);
    group.setAttribute("data-axis", axis);
    const caption = document.createElement("span");
    caption.className = `${BAR_CLASS}-caption`;
    caption.setAttribute("aria-hidden", "true");
    caption.textContent = name;
    group.appendChild(caption);
    for (let level = 1; level <= max + 1; level += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(level);
      const text = label(axis === "rows" ? "outlineLevelShowRows" : "outlineLevelShowCols", { level });
      button.setAttribute("aria-label", text);
      button.title = text;
      button.setAttribute("data-level", String(level));
      button.addEventListener("click", () => onLevel(axis, level));
      group.appendChild(button);
    }
    return group;
  };

  return {
    update(levels) {
      const visible = levels.rows > 0 || levels.cols > 0;
      // The copy is part of the key, so a language switch relabels the strip.
      const key = visible ? JSON.stringify([levels.rows, levels.cols, label("outlineLevelsRows")]) : "";
      if (key === renderedKey) return;
      renderedKey = key;
      if (!visible) {
        if (bar) bar.hidden = true;
        layoutGrid(grid, null);
        return;
      }
      if (!bar) {
        installStyle(document);
        bar = document.createElement("div");
        bar.className = BAR_CLASS;
        bar.setAttribute("role", "group");
        container.insertBefore(bar, grid);
      }
      bar.setAttribute("aria-label", label("outlineLevelsBar"));
      bar.replaceChildren(
        ...(levels.rows > 0 ? [axisGroup("rows", levels.rows)] : []),
        ...(levels.cols > 0 ? [axisGroup("cols", levels.cols)] : []),
      );
      bar.hidden = false;
      layoutGrid(grid, levels);
    },
    dispose() {
      bar?.remove();
      bar = null;
      renderedKey = "";
      layoutGrid(grid, null);
    },
  };
}
