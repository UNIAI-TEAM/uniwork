import { describe, expect, it } from "vitest";
import { libraryCell, libraryGroupSpans, specLadder } from "../library-columns";
import { DOC_LIST_SCREENS, NARROW_HIDING_ORDER, docListRungs, docListSpec } from "./columns";

// The container-query ladder of the unified list is built from the column
// spec. jsdom cannot evaluate container queries, so the test reads the
// classes and checks the rung each one names against the spec's own rungs.

const rungOf = (cell: string | null): number | null => {
  const match = cell?.match(/@min-\[(\d+)rem\]\/library:table-cell/);
  return match ? Number(match[1]) : null;
};

describe("specLadder", () => {
  it.each(DOC_LIST_SCREENS)("builds the %s ladder from the spec's rungs", (screen) => {
    const spec = docListSpec(screen);
    const rungs = docListRungs(spec);
    const ladder = specLadder(screen);

    expect(ladder.columns.map((column) => column.id)).toEqual(spec.columns.map((column) => column.id));
    expect(ladder.head).toContain(`@min-[${rungs.table}rem]/library:table-header-group`);

    expect(rungOf(libraryCell(ladder, "access"))).toBe(rungs.access);
    expect(rungOf(libraryCell(ladder, "editor"))).toBe(rungs.editor);
    expect(rungOf(libraryCell(ladder, "size"))).toBe(rungs.size);
    expect(rungOf(libraryCell(ladder, "updated"))).toBe(rungs.table);
    if (spec.screenColumn) expect(rungOf(libraryCell(ladder, spec.screenColumn))).toBe(rungs.table);
  });

  it("opens Access, then Editor, then Size: the reverse of the hiding order", () => {
    for (const screen of DOC_LIST_SCREENS) {
      const ladder = specLadder(screen);
      const rungs = NARROW_HIDING_ORDER.map((id) => rungOf(libraryCell(ladder, id)) ?? 0);
      expect(rungs[0], screen).toBeGreaterThan(rungs[1] ?? 0);
      expect(rungs[1], screen).toBeGreaterThan(rungs[2] ?? 0);
    }
  });

  it("keeps Select, Name and Actions on at every width, and Size right-aligned", () => {
    for (const screen of DOC_LIST_SCREENS) {
      const ladder = specLadder(screen);
      for (const id of ["select", "name", "actions"] as const) expect(libraryCell(ladder, id)).toBe("");
      expect(libraryCell(ladder, "size")).toContain("text-right");
    }
  });

  it("has no screen column on the workspace screen and one elsewhere", () => {
    expect(specLadder("workspace").columns).toHaveLength(7);
    for (const screen of DOC_LIST_SCREENS.filter((s) => s !== "workspace")) expect(specLadder(screen).columns).toHaveLength(8);
  });

  it("spans the group header once per rung, as wide as the columns that join there", () => {
    const spans = libraryGroupSpans(specLadder("trash"));
    // table rung: the screen column + Updated; then Access, Editor and Size one each.
    expect(spans.map((entry) => entry.span)).toEqual([2, 1, 1, 1]);
    expect(libraryGroupSpans(specLadder("workspace")).map((entry) => entry.span)).toEqual([1, 1, 1, 1]);
  });

  it("answers null for a column the ladder does not have", () => {
    expect(libraryCell(specLadder("workspace"), "deleted")).toBeNull();
  });
});
