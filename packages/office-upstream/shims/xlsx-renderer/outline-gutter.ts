// UNI-964 - the outline gutters: a strip left of the row headers and one
// above the column headers where each group's bracket and "+" / "-" toggle
// sit (outline-brackets.ts lays them out). The grid makes room for them
// through the level bar (outline-bar.ts sizes the grid with
// outlineGutterExtent), so both gutters are absolutely placed in that room
// and every toggle is a real button: focusable, aria-expanded, labelled.
// Colours and sizes are the design tokens.
import type { OutlineAxis } from "./outline-levels";
import type { OutlineBracket } from "./outline-brackets";

/** The room a gutter takes for `levels` outline levels, as CSS. */
export function outlineGutterExtent(levels: number): string {
  return levels > 0 ? `calc(${levels} * var(--uniwork-outline-level-width) + 4px)` : "0px";
}

export interface OutlineGutterAxis {
  readonly levels: number;
  readonly brackets: readonly OutlineBracket[];
}

export interface OutlineGutters {
  update(layout: { rows: OutlineGutterAxis; cols: OutlineGutterAxis }): void;
  dispose(): void;
}

export interface OutlineGutterOptions {
  /** The renderer root (`.xlsx-surface`). */
  container: HTMLElement;
  /** The grid host inside it; the gutters go before it in DOM order, so Tab
   *  from the level bar reaches the toggles before the grid. */
  grid?: HTMLElement;
  label: (key: string, params?: Record<string, unknown>) => string;
  onToggle: (axis: OutlineAxis, start: number, depth: number, collapse: boolean) => void;
}

const GUTTER_CLASS = "uniwork-xlsx-outline-gutter";
const STYLE_ID = "uniwork-xlsx-outline-gutter-style";
// A coarse pointer gets a wider level column and a 44px hit area around each
// toggle (the primitives' touch contract), without moving its neighbours.
const STYLE = `
.${GUTTER_CLASS} { position: absolute; box-sizing: border-box; overflow: hidden; z-index: 1;
  background: var(--color-muted); color: var(--color-muted-foreground); }
.${GUTTER_CLASS}[hidden] { display: none; }
.${GUTTER_CLASS}[data-axis="rows"] { left: 0; bottom: 0; border-right: 1px solid var(--color-border); }
.${GUTTER_CLASS}[data-axis="cols"] { left: 0; right: 0; border-bottom: 1px solid var(--color-border); }
.${GUTTER_CLASS}-line { position: absolute; box-sizing: border-box; pointer-events: none;
  border-color: var(--color-muted-foreground); border-style: solid; border-width: 0; }
.${GUTTER_CLASS}[data-axis="rows"] .${GUTTER_CLASS}-line { width: 5px; border-left-width: 1px; border-top-width: 1px; }
.${GUTTER_CLASS}[data-axis="cols"] .${GUTTER_CLASS}-line { height: 5px; border-top-width: 1px; border-left-width: 1px; }
.${GUTTER_CLASS} button { position: absolute; box-sizing: border-box; width: 13px; height: 13px; padding: 0;
  transform: translate(-50%, -50%); border: 1px solid var(--color-border); border-radius: 2px;
  background: var(--color-background); color: var(--color-foreground); font: inherit;
  font-size: var(--text-caption); font-weight: 600; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center; }
.${GUTTER_CLASS} button[hidden] { display: none; }
.${GUTTER_CLASS} button:hover { background: var(--color-surface-hover); }
@media (pointer: coarse) {
  .${GUTTER_CLASS} button { width: 22px; height: 22px; }
  .${GUTTER_CLASS} button::after { content: ""; position: absolute; inset: -11px; }
}
`;

function installStyle(document: Document): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

/** Excel's column letters for a 0-based index (A, Z, AA, ...). */
export function columnName(index: number): string {
  let name = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  }
  return name;
}

/** The centre of level column `depth` across the gutter, as CSS. */
const levelCentre = (depth: number): string => `calc(${depth - 0.5} * var(--uniwork-outline-level-width) + 2px)`;

export function createOutlineGutters(options: OutlineGutterOptions): OutlineGutters {
  const { container, grid, label, onToggle } = options;
  const document = container.ownerDocument;
  const gutters = new Map<OutlineAxis, { element: HTMLElement; nodes: Map<string, { lines: HTMLElement[]; button: HTMLButtonElement }> }>();

  const gutterFor = (axis: OutlineAxis) => {
    let gutter = gutters.get(axis);
    if (!gutter) {
      installStyle(document);
      const element = document.createElement("div");
      element.className = GUTTER_CLASS;
      element.setAttribute("data-axis", axis);
      element.setAttribute("role", "group");
      if (grid && grid.parentNode === container) container.insertBefore(element, grid);
      else container.appendChild(element);
      gutter = { element, nodes: new Map() };
      gutters.set(axis, gutter);
    }
    return gutter;
  };

  // Positions are container pixels; a gutter starts below the level bar (and
  // the row gutter below the column gutter too), so its offset comes off them.
  const place = (axis: OutlineAxis, layout: { rows: OutlineGutterAxis; cols: OutlineGutterAxis }): void => {
    const { levels, brackets } = layout[axis];
    if (levels === 0) {
      const gutter = gutters.get(axis);
      if (gutter) {
        gutter.element.hidden = true;
        gutter.element.replaceChildren();
        gutter.nodes.clear();
      }
      return;
    }
    const gutter = gutterFor(axis);
    const { element, nodes } = gutter;
    const cols = outlineGutterExtent(layout.cols.levels);
    const offset = axis === "rows" ? `var(--uniwork-outline-bar-height) + ${cols}` : "0px";
    element.hidden = false;
    element.setAttribute("aria-label", label(axis === "rows" ? "outlineGroupsRows" : "outlineGroupsCols"));
    if (axis === "rows") {
      element.style.top = `calc(var(--uniwork-outline-bar-height) + ${cols})`;
      element.style.width = outlineGutterExtent(levels);
    } else {
      element.style.top = "var(--uniwork-outline-bar-height)";
      element.style.height = cols;
    }
    const along = (px: number): string => `calc(${px}px - (${offset}))`;
    const seen = new Set<string>();
    const ordered: HTMLElement[] = [];
    for (const bracket of brackets) {
      seen.add(bracket.key);
      let node = nodes.get(bracket.key);
      if (!node) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-start", String(bracket.group.start));
        button.setAttribute("data-level", String(bracket.group.depth));
        button.addEventListener("click", () => {
          const expanded = button.getAttribute("aria-expanded") === "true";
          onToggle(axis, bracket.group.start, bracket.group.depth, expanded);
        });
        node = { lines: [], button };
        nodes.set(bracket.key, node);
      }
      const { group } = bracket;
      const first = axis === "rows" ? String(group.start + 1) : columnName(group.start);
      const last = axis === "rows" ? String(group.end + 1) : columnName(group.end);
      const verb = bracket.collapsed ? "Expand" : "Collapse";
      const text = label(`outlineGroup${verb}${axis === "rows" ? "Rows" : "Cols"}`, { start: first, end: last });
      node.button.setAttribute("aria-expanded", String(!bracket.collapsed));
      node.button.setAttribute("aria-label", text);
      node.button.title = text;
      node.button.textContent = bracket.collapsed ? "+" : "−";
      const across = levelCentre(group.depth);
      // One line per pane the group shows in (a group across the freeze has
      // two); spare nodes from an earlier frame stay hidden.
      while (node.lines.length < bracket.lines.length) {
        const line = document.createElement("div");
        line.className = `${GUTTER_CLASS}-line`;
        line.setAttribute("aria-hidden", "true");
        node.lines.push(line);
      }
      node.lines.forEach((line, index) => {
        const extent = bracket.lines[index];
        line.hidden = extent === undefined;
        if (!extent) return;
        const length = `${extent.to - extent.from}px`;
        if (axis === "rows") Object.assign(line.style, { top: along(extent.from), height: length, left: across });
        else Object.assign(line.style, { left: along(extent.from), width: length, top: across });
      });
      node.button.hidden = bracket.button === null;
      if (bracket.button !== null) {
        if (axis === "rows") Object.assign(node.button.style, { top: along(bracket.button), left: across });
        else Object.assign(node.button.style, { left: along(bracket.button), top: across });
      }
      ordered.push(...node.lines, node.button);
    }
    for (const key of [...nodes.keys()]) if (!seen.has(key)) nodes.delete(key);
    // Kept nodes are re-attached in reading order, so a focused toggle keeps
    // its focus across a scroll and Tab walks the groups top to bottom.
    const current = element.children;
    const unchanged = current.length === ordered.length && ordered.every((node, index) => current[index] === node);
    if (unchanged) return;
    const focused = document.activeElement as HTMLElement | null;
    element.replaceChildren(...ordered);
    if (focused && ordered.includes(focused) && document.activeElement !== focused) focused.focus();
  };

  return {
    update(layout) {
      place("cols", layout);
      place("rows", layout);
    },
    dispose() {
      for (const gutter of gutters.values()) gutter.element.remove();
      gutters.clear();
    },
  };
}
