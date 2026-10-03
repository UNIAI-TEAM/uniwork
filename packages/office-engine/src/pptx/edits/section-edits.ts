// Section edits — the five vendored pptx-ops section ops bound to one typed,
// validated op builder, plus the pure positional grouping helper the slide
// sorter consumes. The wire round registers these kinds as PptxEdit in model.ts;
// the sorter UI is a later task.
//
// Vendored source of truth (READ-ONLY, never imported):
//   packages/office-upstream/upstream/packages/pptx-ops/src/ops/slide-ops.ts
//     setSections   slide-ops.ts:638  op { sections: SectionInfo[] }
//     addSection    slide-ops.ts:648  op { atSlideIndex, name }
//     renameSection slide-ops.ts:651  op { id, name }
//     removeSection slide-ops.ts:654  op { id } (registered with keepSlides: true)
//     moveSection   slide-ops.ts:657  op { id, dir: 'up' | 'down' }
//   packages/office-upstream/upstream/packages/pptx-engine/src/sections.ts
//     SectionInfo { id, name, slideIndices }  sections.ts:28-34
//     positional normalization rule          sections.ts:148-173
//
// Section ops carry slide indices only (no pixel geometry), so this builder
// emits the indices untouched. fitWidthPx stays in the signature for the
// uniform wire-round call shape: this.txn(buildSectionOps(this.opened,
// this.fitWidthPx, edit)).
import { PptxEngineError, type OpenedPptxLike, type PptxOp } from "../engine";

/** One section, mirroring the vendored SectionInfo (sections.ts:28-34):
 * id = section GUID (braces, PowerPoint style), name = user label,
 * slideIndices = 0-based deck indices in slide order. The engine normalizes
 * them positionally on every write — see groupSlidesIntoSections. */
export interface PptxSectionInfo {
  id: string;
  name: string;
  slideIndices: number[];
}

/** Sorter group: the unsectioned leading slides plus one span per section,
 * mirroring the vendored positional rule (sections.ts:148-173) and the
 * genoffice sidebar grouping (apps/slides/src/renderer/App.tsx:2088-2112). */
export interface PptxSectionGroup {
  /** Section id; null marks the unsectioned leading slides. */
  id: string | null;
  /** Section name; empty for the unsectioned group (the UI supplies a label). */
  name: string;
  /** First slide index of the group (inclusive). */
  start: number;
  /** One past the last slide index (exclusive) — the group covers [start, end). */
  end: number;
}

/** One section gesture; snake_case kinds like every other PptxEdit. */
export type SectionEdit =
  | { op: "add_section"; atSlideIndex: number; name: string }
  | { op: "rename_section"; id: string; name: string }
  | { op: "remove_section"; id: string }
  | { op: "move_section"; id: string; dir: "up" | "down" }
  | { op: "set_sections"; sections: PptxSectionInfo[] };

function requireSectionId(id: unknown): string {
  if (typeof id !== "string" || id.trim() === "") {
    throw new PptxEngineError("bad_section_id", "a section id must be a non-empty string");
  }
  return id;
}

function requireSectionName(name: unknown): string {
  if (typeof name !== "string" || name.trim() === "") {
    throw new PptxEngineError("bad_section_name", "a section name must be a non-empty string");
  }
  return name;
}

function requireDir(dir: unknown): "up" | "down" {
  if (dir !== "up" && dir !== "down") {
    throw new PptxEngineError("bad_section_dir", 'move_section needs dir "up" or "down"');
  }
  return dir;
}

function requireSlideIndex(index: unknown, slideCount: number): number {
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= slideCount) {
    throw new PptxEngineError(
      "no_slide",
      "add_section needs atSlideIndex in 0.." + (slideCount - 1) + ", got " + String(index),
    );
  }
  return index as number;
}

/** The vendored setSections payload: an array of {id, name, slideIndices}
 * where every index is a real slide of the deck (the op writes sldIds). */
function requireSections(sections: unknown, slideCount: number): PptxSectionInfo[] {
  if (!Array.isArray(sections)) {
    throw new PptxEngineError("bad_sections", "set_sections needs a sections array");
  }
  for (const section of sections) {
    if (typeof section !== "object" || section === null || Array.isArray(section)) {
      throw new PptxEngineError("bad_sections", "every section must be an object");
    }
    const entry = section as Partial<PptxSectionInfo>;
    requireSectionId(entry.id);
    requireSectionName(entry.name);
    if (!Array.isArray(entry.slideIndices)) {
      throw new PptxEngineError("bad_sections", "every section needs a slideIndices array");
    }
    for (const index of entry.slideIndices) {
      if (!Number.isInteger(index) || index < 0 || index >= slideCount) {
        throw new PptxEngineError(
          "bad_sections",
          "slideIndices must be integers in 0.." + (slideCount - 1) + ", got " + String(index),
        );
      }
    }
  }
  return sections as PptxSectionInfo[];
}

/** Convert one typed section gesture into the vendored pptx-ops op. The wire
 * round calls this mechanically through PptxSessionModel.txn; decks are never
 * mutated here. Refused input throws PptxEngineError with a stable code:
 * no_slide, bad_section_id, bad_section_name, bad_section_dir, bad_sections
 * (bad_section_op guards a JS caller passing an unregistered kind). */
export function buildSectionOps(
  opened: OpenedPptxLike,
  _fitWidthPx: number,
  edit: SectionEdit,
): PptxOp[] {
  const slideCount = opened.deck.slides.length;
  switch (edit.op) {
    case "add_section":
      return [
        {
          op: "addSection",
          atSlideIndex: requireSlideIndex(edit.atSlideIndex, slideCount),
          name: requireSectionName(edit.name),
        },
      ];
    case "rename_section":
      return [
        {
          op: "renameSection",
          id: requireSectionId(edit.id),
          name: requireSectionName(edit.name),
        },
      ];
    case "remove_section":
      return [{ op: "removeSection", id: requireSectionId(edit.id) }];
    case "move_section":
      return [
        {
          op: "moveSection",
          id: requireSectionId(edit.id),
          dir: requireDir(edit.dir),
        },
      ];
    case "set_sections":
      return [{ op: "setSections", sections: requireSections(edit.sections, slideCount) }];
    default: {
      const unknown = edit as { op?: unknown };
      throw new PptxEngineError("bad_section_op", "unsupported section edit " + String(unknown.op));
    }
  }
}

/** Positional normalization of stale section data, mirroring the vendored
 * normalizeSections (sections.ts:154-173): walking backwards, each section
 * starts at its smallest known slide index (or the next section's start when
 * its slideIndices are empty), clamped by the following section; slides before
 * the first start are unsectioned. Each span is [start, next start), the last
 * one running to slideCount.
 *
 * Pure and total: no i18n, no engine access. Returns one ordered group list
 * (unsectioned lead first, when present); with no sections the whole deck is
 * one unsectioned group, and an empty deck has no groups. */
export function groupSlidesIntoSections(
  sections: PptxSectionInfo[],
  slideCount: number,
): PptxSectionGroup[] {
  const total = Math.max(0, Math.floor(slideCount));
  if (total === 0) return [];
  if (!sections.length) {
    return [{ id: null, name: "", start: 0, end: total }];
  }
  const starts = new Array<number>(sections.length);
  let nextStart = total;
  for (let i = sections.length - 1; i >= 0; i--) {
    const indices = sections[i]?.slideIndices;
    const own = Array.isArray(indices) && indices.length ? Math.min(...indices) : nextStart;
    starts[i] = Math.min(own, nextStart);
    nextStart = starts[i] as number;
  }
  const groups: PptxSectionGroup[] = [];
  const first = starts[0] as number;
  if (first > 0) {
    groups.push({ id: null, name: "", start: 0, end: first });
  }
  sections.forEach((section, i) => {
    groups.push({
      id: section.id,
      name: section.name,
      start: starts[i] as number,
      end: i + 1 < sections.length ? (starts[i + 1] as number) : total,
    });
  });
  return groups;
}
