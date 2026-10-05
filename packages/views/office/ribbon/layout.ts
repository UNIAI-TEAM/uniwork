import type { RibbonGalleryItem, RibbonGroup, RibbonGroupStage, RibbonItem, RibbonSize } from "./types";

/**
 * Pure layout of the ribbon body: which size each item takes at a collapse
 * stage, how items pack into columns/rows, how wide a group is, and which
 * stage every group needs so the row fits the measured width. Widths are
 * estimates from label lengths; OfficeRibbon corrects them against the real
 * scrollWidth (one more step while the row still overflows).
 */

const RANK: Record<RibbonSize, number> = { icon: 0, small: 1, large: 2 };
const BY_RANK: readonly RibbonSize[] = ["icon", "small", "large"];

/** Average px per character of a text-caption / text-label run. */
const CHAR_PX = 6.5;
const LARGE_MIN = 48;
const SMALL_CHROME = 16 + 6 + 12; // icon + gap + padding
const ICON_CELL = 26; // 24 px button + 2 px gap
/** Combo width default and floor in px (font family boxes need ~140). */
export const COMBO_DEFAULT = 140;
export const COMBO_MIN = 56;
const CUSTOM_DEFAULT = 96;
const GALLERY_CARD = 76;
const GALLERY_MORE = 22; // 20 px more column + box border
const BLOCK_GAP = 4;
const GROUP_CHROME = 12 + 1; // horizontal padding + separator
const LAUNCHER = 16;
const SMALL_PER_COLUMN = 3;
const MAX_STRIP_ROWS = 3;

/** Text width estimate for a label key; the ribbon passes `t()` through it. */
export type RibbonMeasure = (labelKey: string) => number;

export function textMeasure(translate: (key: string) => string): RibbonMeasure {
  return (key) => translate(key).length * CHAR_PX;
}

/** The size an item takes at a collapse stage, never below its `collapseAs`. */
export function itemSize(item: RibbonItem, stage: RibbonGroupStage): RibbonSize {
  const declared = item.size ?? "small";
  const fallbackFloor: RibbonSize = item.icon ? "icon" : "small";
  const floorRank = Math.min(RANK[item.collapseAs ?? fallbackFloor], RANK[declared]);
  let rank = RANK[declared];
  if (stage >= 1 && rank === RANK.large) rank = RANK.small;
  if (stage >= 2 && rank === RANK.small) rank = RANK.icon;
  return BY_RANK[Math.max(rank, floorRank)] ?? declared;
}

/** Cards a gallery shows at a stage: all of `maxVisible`, then half way, then
 * `minVisible` — the gallery shrinks before anything else in its group. */
export function galleryVisible(item: RibbonGalleryItem, stage: RibbonGroupStage): number {
  const max = Math.max(1, Math.min(item.maxVisible ?? 4, item.options.length));
  const min = Math.max(1, Math.min(item.minVisible ?? 1, max));
  if (stage === 0) return max;
  if (stage === 1) return Math.max(min, Math.ceil((max + min) / 2));
  return min;
}

export type RibbonBlock =
  | { kind: "large"; item: RibbonItem }
  | { kind: "column"; items: RibbonItem[] }
  | { kind: "strip"; rows: RibbonItem[][] }
  | { kind: "inline"; item: RibbonItem };

function stripRows(run: RibbonItem[]): RibbonItem[][] {
  if (run.some((item, index) => index > 0 && item.rowBreak)) {
    const rows: RibbonItem[][] = [];
    for (const item of run) {
      if (rows.length === 0 || (item.rowBreak && rows.length < MAX_STRIP_ROWS)) rows.push([item]);
      else rows[rows.length - 1]?.push(item);
    }
    return rows;
  }
  const count = run.length <= 6 ? 1 : run.length <= 12 ? 2 : MAX_STRIP_ROWS;
  const perRow = Math.ceil(run.length / count);
  const rows: RibbonItem[][] = [];
  for (let index = 0; index < run.length; index += perRow) rows.push(run.slice(index, index + perRow));
  return rows;
}

/** Packs a group's items at a stage: large items own a column, consecutive
 * small items stack three per column, consecutive icon items and combos share
 * a strip of up to three rows, galleries and custom items stand alone. */
export function groupBlocks(items: readonly RibbonItem[], stage: RibbonGroupStage): RibbonBlock[] {
  const blocks: RibbonBlock[] = [];
  let column: RibbonItem[] = [];
  let strip: RibbonItem[] = [];
  const flush = () => {
    if (column.length) blocks.push({ kind: "column", items: column });
    if (strip.length) blocks.push({ kind: "strip", rows: stripRows(strip) });
    column = [];
    strip = [];
  };
  for (const item of items) {
    if (item.kind === "gallery" || item.kind === "custom") {
      flush();
      blocks.push({ kind: "inline", item });
      continue;
    }
    const size = item.kind === "combo" ? "icon" : itemSize(item, stage);
    if (size === "large") {
      flush();
      blocks.push({ kind: "large", item });
    } else if (size === "small") {
      if (strip.length) flush();
      column.push(item);
      if (column.length === SMALL_PER_COLUMN) flush();
    } else {
      if (column.length) flush();
      strip.push(item);
    }
  }
  flush();
  return blocks;
}

function itemWidth(item: RibbonItem, stage: RibbonGroupStage, measure: RibbonMeasure): number {
  if (item.kind === "combo") return Math.max(COMBO_MIN, item.width ?? COMBO_DEFAULT) + 2;
  if (item.kind === "custom") return item.width ?? CUSTOM_DEFAULT;
  if (item.kind === "gallery") {
    return galleryVisible(item, stage) * (item.cardWidth ?? GALLERY_CARD) + GALLERY_MORE;
  }
  const chevron = item.kind === "split" || item.kind === "dropdown" ? 14 : 0;
  const size = itemSize(item, stage);
  if (size === "icon") return ICON_CELL + chevron;
  if (size === "small") return SMALL_CHROME + measure(item.labelKey) + chevron;
  return Math.max(LARGE_MIN, Math.ceil(measure(item.labelKey) * 0.6) + 16);
}

function blockWidth(block: RibbonBlock, stage: RibbonGroupStage, measure: RibbonMeasure): number {
  switch (block.kind) {
    case "column":
      return Math.max(...block.items.map((item) => itemWidth(item, stage, measure)));
    case "strip":
      return Math.max(...block.rows.map((row) => row.reduce((sum, item) => sum + itemWidth(item, stage, measure), 0)));
    default:
      return itemWidth(block.item, stage, measure);
  }
}

/** Width of the single large button a fully collapsed group becomes. */
function collapsedGroupWidth(group: RibbonGroup, measure: RibbonMeasure): number {
  return Math.max(LARGE_MIN + 8, Math.ceil(measure(group.labelKey) * 0.6) + 28) + GROUP_CHROME;
}

export function groupWidth(group: RibbonGroup, stage: RibbonGroupStage, measure: RibbonMeasure): number {
  if (stage === 3) return collapsedGroupWidth(group, measure);
  const blocks = groupBlocks(group.items, stage);
  const content = blocks.reduce((sum, block) => sum + blockWidth(block, stage, measure), 0) + Math.max(0, blocks.length - 1) * BLOCK_GAP;
  const caption = measure(group.labelKey) + (group.launcher ? 2 * LAUNCHER : 0) + 8;
  return Math.ceil(Math.max(content, caption)) + GROUP_CHROME;
}

interface CollapseStep {
  index: number;
  stage: RibbonGroupStage;
}

/** Every collapse step in order: groups by priority (lowest first, ties from
 * the right), each through its stages; a stage that saves no space is skipped,
 * except the final fold into one button. */
function collapseSteps(groups: readonly RibbonGroup[], widths: readonly number[][]): CollapseStep[] {
  const order = groups
    .map((group, index) => ({ index, priority: group.priority }))
    .sort((left, right) => left.priority - right.priority || right.index - left.index)
    .map((entry) => entry.index);
  const steps: CollapseStep[] = [];
  for (const index of order) {
    let current = widths[index]?.[0] ?? 0;
    for (const stage of [1, 2, 3] as const) {
      const next = widths[index]?.[stage] ?? current;
      if (next < current || stage === 3) {
        steps.push({ index, stage });
        current = next;
      }
    }
  }
  return steps;
}

function stageWidths(groups: readonly RibbonGroup[], measure: RibbonMeasure): number[][] {
  return groups.map((group) => ([0, 1, 2, 3] as const).map((stage) => groupWidth(group, stage, measure)));
}

/**
 * Collapse stages for `groups` so they fit `available` px. Groups collapse
 * one at a time in priority order (lowest first, ties from the right), each
 * through large -> small -> icon -> one button; a step that saves no space is
 * skipped. `extraSteps` forces further steps when the rendered row still
 * overflows the estimate. If everything is collapsed and the row still does
 * not fit, the body scrolls instead of clipping.
 */
export function planRibbonStages(
  groups: readonly RibbonGroup[],
  available: number,
  measure: RibbonMeasure,
  extraSteps = 0,
): RibbonGroupStage[] {
  const stages: RibbonGroupStage[] = groups.map(() => 0);
  const widths = stageWidths(groups, measure);
  const steps = collapseSteps(groups, widths);
  let total = widths.reduce((sum, row) => sum + (row[0] ?? 0), 0);
  let taken = 0;
  const apply = (step: CollapseStep) => {
    total += (widths[step.index]?.[step.stage] ?? 0) - (widths[step.index]?.[stages[step.index] ?? 0] ?? 0);
    stages[step.index] = step.stage;
    taken += 1;
  };
  while (taken < steps.length && total > available) apply(steps[taken] as CollapseStep);
  for (let extra = 0; extra < extraSteps && taken < steps.length; extra += 1) apply(steps[taken] as CollapseStep);
  return stages;
}

/** How many collapse steps exist; bounds the overflow correction. */
export function ribbonStepCount(groups: readonly RibbonGroup[], measure: RibbonMeasure): number {
  return collapseSteps(groups, stageWidths(groups, measure)).length;
}
