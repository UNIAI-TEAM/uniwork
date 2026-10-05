/**
 * A2 UI half (UNI-927) - pure helpers for the slide sorter.
 *
 * Everything here is view-state math with no React, no engine access and no i18n:
 * the panel component reads these, and they are unit-tested on their own. The
 * positional grouping rule itself is NOT re-implemented - it is the engine half's
 * `groupSlidesIntoSections` (packages/office-engine/src/pptx/edits/section-edits.ts,
 * committed as A2e), so the sorter and the file writer can never disagree about
 * which slides belong to which section.
 */
import { groupSlidesIntoSections, type PptxSectionGroup, type PptxSectionInfo } from "@uniwork/office-engine/pptx";

/** One slide as the sorter draws it. Mirrors `PptxSlideView` (the rail's shape) so a
 *  host can hand the same list to the rail and to this panel. */
export interface PptxSorterSlide {
  id: string;
  label?: string;
  thumbnailUrl?: string;
  hidden?: boolean;
}

/** One slide layout the "New slide" picker can offer (the P0-1 artifact's
 *  `listSlideLayouts` entry: `{ name, path }`). */
export interface PptxSorterLayout {
  name: string;
  path: string;
}

/** A reorder request that will actually change the deck; null when the gesture is a
 *  no-op (same index) or either end is outside the deck. */
export interface PptxSlideMove {
  from: number;
  to: number;
}

/** Clamp a slide index into `0..count-1`; an empty deck answers 0. */
export function clampSlideIndex(index: number, count: number): number {
  const total = Math.max(0, Math.floor(count));
  if (total === 0) return 0;
  const bounded = Math.floor(Number.isFinite(index) ? index : 0);
  return Math.min(Math.max(bounded, 0), total - 1);
}

/**
 * The `move_slide` request for a drag from `from` to `to`, or null when nothing
 * should be written. `move_slide` carries deck indices, so a refused gesture must
 * not reach the edit channel at all (a no-op op would still mark the deck dirty).
 */
export function reorderSlideTargets(from: number, to: number, count: number): PptxSlideMove | null {
  const total = Math.max(0, Math.floor(count));
  if (total < 2) return null;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 0 || from >= total || to < 0 || to >= total) return null;
  if (from === to) return null;
  return { from, to };
}

/**
 * One arrow-key reorder step from `index`: `-1`/`1` columns for the grid, or the
 * row step. Returns null when the move would leave the deck (the caller leaves the
 * event alone rather than wrapping around the last slide).
 */
export function keyboardReorderTarget(index: number, count: number, key: string, columns = 1): number | null {
  const total = Math.max(0, Math.floor(count));
  if (total < 2 || index < 0 || index >= total) return null;
  const step = Math.max(1, Math.floor(columns) || 1);
  const delta =
    key === "ArrowLeft" ? -1
      : key === "ArrowRight" ? 1
        : key === "ArrowUp" ? -step
          : key === "ArrowDown" ? step
            : 0;
  if (delta === 0) return null;
  const target = index + delta;
  return target < 0 || target >= total ? null : target;
}

/** Section groups for a deck, delegating to the engine's positional rule. */
export function sorterSectionGroups(sections: readonly PptxSectionInfo[], slideCount: number): PptxSectionGroup[] {
  return groupSlidesIntoSections([...sections], slideCount);
}

/** The section id a slide currently sits in, or null for the unsectioned lead. */
export function sectionIdAtSlide(sections: readonly PptxSectionInfo[], slideIndex: number): string | null {
  for (const section of sections) {
    if (section.slideIndices.includes(slideIndex)) return section.id;
  }
  return null;
}

/**
 * A default name for a section: one past the number of named sections the deck
 * already has, so adding a section suggests "Section 3" rather than reusing an
 * existing number (PowerPoint numbers by count, not by slide position). The UI
 * passes the result through `t("office.pptx.sections.default_name", { index })`,
 * which is why this returns the number and not the copy.
 */
export function nextSectionNumber(sections: readonly PptxSectionInfo[], slideCount: number): number {
  const groups = sorterSectionGroups(sections, slideCount);
  return groups.filter((group) => group.id !== null).length + 1;
}

/** Trim a typed section name; null when it is empty (the builder refuses blank names). */
export function normalizeSectionName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Whether a section can move one step in `dir` without leaving the section list. */
export function canMoveSection(
  sections: readonly PptxSectionInfo[],
  id: string,
  dir: "up" | "down",
): boolean {
  const index = sections.findIndex((section) => section.id === id);
  if (index < 0) return false;
  return dir === "up" ? index > 0 : index < sections.length - 1;
}

/** The 1-based inclusive slide range a group covers, for the section list's caption. */
export function groupRangeLabel(group: PptxSectionGroup): { start: number; end: number } | null {
  if (group.end <= group.start) return null;
  return { start: group.start + 1, end: group.end };
}

/** The `layout` value a picker row sends to `add_slide_with_layout`. The vendored op
 *  accepts a name, a 0-based index or a part path; the index is the stable spelling
 *  when two layouts share a name, so the sorter always sends the index. */
export function layoutPickerValue(layouts: readonly PptxSorterLayout[], index: number): number | null {
  return index >= 0 && index < layouts.length ? index : null;
}

/** The standard Office layout names (what every default template ships) and the
 *  full i18n key that carries their copy, so a Vietnamese UI never
 *  shows "Blank" next to "Trang chiếu trống". A deck's own custom name has no entry. */
const STANDARD_LAYOUT_KEYS: Readonly<Record<string, string>> = {
  "title slide": "office.pptx.sorter.layout.title_slide",
  "title and content": "office.pptx.sorter.layout.title_content",
  "section header": "office.pptx.sorter.layout.section_header",
  "two content": "office.pptx.sorter.layout.two_content",
  comparison: "office.pptx.sorter.layout.comparison",
  "title only": "office.pptx.sorter.layout.title_only",
  blank: "office.pptx.sorter.layout.blank",
  "content with caption": "office.pptx.sorter.layout.content_caption",
  "picture with caption": "office.pptx.sorter.layout.picture_caption",
  "title and vertical text": "office.pptx.sorter.layout.title_vertical_text",
  "vertical title and text": "office.pptx.sorter.layout.vertical_title_text",
};

/** The i18n key for a standard layout name, or null for a custom (deck-authored) name. */
export function standardLayoutKey(name: string): string | null {
  return STANDARD_LAYOUT_KEYS[name.trim().toLowerCase()] ?? null;
}
