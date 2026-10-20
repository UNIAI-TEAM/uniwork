import { describe, expect, it } from "vitest";
import { libraryCell, specLadder } from "../library-columns";
import { DOC_LIST_SCREENS, NAME_FLOOR, docListRungs, docListSpec, type DocListColumnId } from "./columns";

// Desktop widths of the unified list (UNI-2045 W1b). The design board shows all
// eight columns at 1440 (the list container is ~870px beside the two
// sidebars) and Rules.dc.html hides optional columns only below ~1024px of
// viewport, so the rungs must open every column at a 870px container and keep
// all but Size (workspace) / Size + Last edited by (screen column) at 710px
// (the 1280 viewport).

const CONTAINER_1440 = 870;
const CONTAINER_1280 = 710;

const width = (screen: (typeof DOC_LIST_SCREENS)[number], id: DocListColumnId) =>
  docListSpec(screen).columns.find((column) => column.id === id)?.width;

const rungOf = (cell: string | null): number | null => {
  const match = cell?.match(/@min-\[(\d+)rem\]\/library:table-cell/);
  return match ? Number(match[1]) : null;
};

describe("desktop widths of the shared columns", () => {
  it("pins the widths the cells need (padding included) and the Name floor", () => {
    for (const screen of DOC_LIST_SCREENS) {
      expect(width(screen, "select"), screen).toBe(36);
      expect(width(screen, "access"), screen).toBe(120);
      expect(width(screen, "editor"), screen).toBe(124);
      expect(width(screen, "updated"), screen).toBe(118);
      expect(width(screen, "size"), screen).toBe(72);
      expect(width(screen, "actions"), screen).toBe(76);
      expect(width(screen, "name"), screen).toBe(0);
      const own = docListSpec(screen).screenColumn;
      if (own) expect(width(screen, own), screen).toBe(120);
    }
    expect(NAME_FLOOR).toBe(194);
  });

  it("shows every column of every screen at a 870px container (1440 viewport)", () => {
    for (const screen of DOC_LIST_SCREENS) {
      const rungs = docListRungs(docListSpec(screen));
      expect(rungs.size * 16, screen).toBeLessThanOrEqual(CONTAINER_1440);
    }
  });

  it("hides at most Size on the workspace screen at a 710px container (1280 viewport)", () => {
    const rungs = docListRungs(docListSpec("workspace"));
    expect(rungs.editor * 16).toBeLessThanOrEqual(CONTAINER_1280);
    expect(rungs.size * 16).toBeGreaterThan(CONTAINER_1280);
  });

  it("hides at most Size and Last edited by on a screen with a screen column at 710px", () => {
    for (const screen of DOC_LIST_SCREENS.filter((s) => s !== "workspace")) {
      const rungs = docListRungs(docListSpec(screen));
      expect(rungs.access * 16, screen).toBeLessThanOrEqual(CONTAINER_1280);
      expect(rungs.table * 16, screen).toBeLessThanOrEqual(CONTAINER_1280);
    }
  });

  it("pins the rungs in rem: table, access, editor, size", () => {
    const rungs = (screen: (typeof DOC_LIST_SCREENS)[number]) => {
      const { table, access, editor, size } = docListRungs(docListSpec(screen));
      return [table, access, editor, size];
    };
    expect(rungs("workspace")).toEqual([27, 35, 42, 47]);
    for (const screen of DOC_LIST_SCREENS.filter((s) => s !== "workspace")) expect(rungs(screen), screen).toEqual([35, 42, 50, 54]);
  });

  it("keeps the stacked layout below the table rung and the Name floor at every rung", () => {
    for (const screen of DOC_LIST_SCREENS) {
      const spec = docListSpec(screen);
      const rungs = docListRungs(spec);
      const w = (id: DocListColumnId) => spec.columns.find((c) => c.id === id)?.width ?? 0;
      const fixed = w("select") + w("updated") + w("actions") + (spec.screenColumn ? w(spec.screenColumn) : 0) + 2;
      expect(rungs.table * 16 - fixed, screen).toBeGreaterThanOrEqual(NAME_FLOOR);
      const ladder = specLadder(screen);
      expect(rungOf(libraryCell(ladder, "updated")), screen).toBe(rungs.table);
    }
  });

  it("sizes each <col> from the spec's width, not a literal of its own", () => {
    for (const screen of DOC_LIST_SCREENS) {
      const ladder = specLadder(screen);
      for (const id of ["select", "access", "editor", "updated", "size"] as const) {
        const col = ladder.columns.find((column) => column.id === id)?.col;
        expect(col, `${screen}/${id}`).toContain(`w-[${width(screen, id)}px]`);
      }
      const own = docListSpec(screen).screenColumn;
      if (own) expect(ladder.columns.find((column) => column.id === own)?.col).toContain(`w-[${width(screen, own)}px]`);
    }
  });
});
