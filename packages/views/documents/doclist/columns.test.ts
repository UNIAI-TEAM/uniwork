import { describe, expect, it } from "vitest";
import {
  DOC_LIST_SCREENS,
  NARROW_HIDING_ORDER,
  docListRungs,
  docListSpec,
  nextDocListSort,
  type DocListColumnId,
  type DocListScreen,
} from "./columns";

// The per-screen column spec of the unified document list (contract UNI-2045):
// Select · Name · [screen column] · Access · Last edited by · Updated · Size ·
// Actions, one screen column per screen, none on the workspace screen.

const SCREEN_COLUMN: Record<DocListScreen, DocListColumnId | null> = {
  workspace: null,
  recent: "activity",
  starred: "starred",
  shared: "shared",
  "shared-by-me": "shared_with",
  shelved: "shelved",
  trash: "deleted",
};

const ids = (screen: DocListScreen) => docListSpec(screen).columns.map((column) => column.id);

describe("docListSpec column order", () => {
  it("covers the seven screens", () => {
    expect([...DOC_LIST_SCREENS]).toEqual(["workspace", "recent", "starred", "shared", "shared-by-me", "shelved", "trash"]);
  });

  it.each(DOC_LIST_SCREENS)("orders %s as Select, Name, [screen column], Access, Editor, Updated, Size, Actions", (screen) => {
    const screenColumn = SCREEN_COLUMN[screen];
    expect(ids(screen)).toEqual([
      "select",
      "name",
      ...(screenColumn ? [screenColumn] : []),
      "access",
      "editor",
      "updated",
      "size",
      "actions",
    ]);
    expect(docListSpec(screen).screenColumn).toBe(screenColumn);
  });

  it("labels every column with a documents.list key", () => {
    for (const screen of DOC_LIST_SCREENS) {
      for (const column of docListSpec(screen).columns) {
        expect(column.labelKey).toMatch(/^documents\.list\.(column|screen_column)\./);
      }
    }
    expect(docListSpec("trash").columns.find((c) => c.id === "deleted")?.labelKey).toBe("documents.list.screen_column.deleted");
    expect(docListSpec("workspace").columns.find((c) => c.id === "name")?.labelKey).toBe("documents.list.column.name");
  });
});

describe("docListSpec default sort", () => {
  it("is the screen column, newest first, where the screen has one", () => {
    expect(docListSpec("recent").defaultSort).toEqual({ key: "activity", order: "desc" });
    expect(docListSpec("starred").defaultSort).toEqual({ key: "starred", order: "desc" });
    expect(docListSpec("shared").defaultSort).toEqual({ key: "shared", order: "desc" });
    expect(docListSpec("shared-by-me").defaultSort).toEqual({ key: "shared", order: "desc" });
    expect(docListSpec("shelved").defaultSort).toEqual({ key: "shelved", order: "desc" });
  });

  it("is deleted ascending in the trash, so the soonest to go comes first (Q2)", () => {
    expect(docListSpec("trash").defaultSort).toEqual({ key: "deleted", order: "asc" });
  });

  it("is updated descending where there is no screen column", () => {
    expect(docListSpec("workspace").defaultSort).toEqual({ key: "updated", order: "desc" });
  });
});

describe("sortable columns", () => {
  it("sorts Name, the screen column, Editor, Updated and Size; never Select, Access or Actions", () => {
    for (const screen of DOC_LIST_SCREENS) {
      for (const column of docListSpec(screen).columns) {
        const never = column.id === "select" || column.id === "access" || column.id === "actions";
        expect(column.sortKey === null, `${screen}/${column.id}`).toBe(never);
      }
    }
  });

  it("maps a screen column to its sort key (both shared screens sort by shared)", () => {
    expect(docListSpec("shared-by-me").columns.find((c) => c.id === "shared_with")?.sortKey).toBe("shared");
    expect(docListSpec("recent").columns.find((c) => c.id === "activity")?.sortKey).toBe("activity");
    expect(docListSpec("trash").columns.find((c) => c.id === "deleted")?.sortKey).toBe("deleted");
    expect(docListSpec("workspace").columns.find((c) => c.id === "editor")?.sortKey).toBe("editor");
  });

  it("starts Name and Editor ascending and the rest descending, then flips", () => {
    const spec = docListSpec("workspace");
    expect(nextDocListSort(spec.defaultSort, "name")).toEqual({ key: "name", order: "asc" });
    expect(nextDocListSort(spec.defaultSort, "editor")).toEqual({ key: "editor", order: "asc" });
    expect(nextDocListSort(spec.defaultSort, "size")).toEqual({ key: "size", order: "desc" });
    expect(nextDocListSort({ key: "name", order: "asc" }, "updated")).toEqual({ key: "updated", order: "desc" });
    expect(nextDocListSort({ key: "name", order: "asc" }, "name")).toEqual({ key: "name", order: "desc" });
    expect(nextDocListSort({ key: "updated", order: "desc" }, "updated")).toEqual({ key: "updated", order: "asc" });
    expect(nextDocListSort({ key: "updated", order: "desc" }, "deleted")).toEqual({ key: "deleted", order: "desc" });
  });
});

describe("narrow hiding", () => {
  it("hides Size first, then Last edited by, then Access", () => {
    expect([...NARROW_HIDING_ORDER]).toEqual(["size", "editor", "access"]);
  });

  it("opens the columns in the reverse order, one rung each, from the column widths", () => {
    for (const screen of DOC_LIST_SCREENS) {
      const spec = docListSpec(screen);
      const rungs = docListRungs(spec);
      expect(rungs.access, screen).toBeGreaterThan(rungs.table);
      expect(rungs.editor, screen).toBeGreaterThan(rungs.access);
      expect(rungs.size, screen).toBeGreaterThan(rungs.editor);

      // Each rung = every column on screen up to and including it + 2px border + a 188px Name floor, rounded up to the rem.
      const width = (id: DocListColumnId) => spec.columns.find((c) => c.id === id)?.width ?? 0;
      const base = width("select") + width("updated") + width("actions") + (spec.screenColumn ? width(spec.screenColumn) : 0) + 2 + 188;
      expect(rungs.table, screen).toBe(Math.ceil(base / 16));
      expect(rungs.access, screen).toBe(Math.ceil((base + width("access")) / 16));
      expect(rungs.editor, screen).toBe(Math.ceil((base + width("access") + width("editor")) / 16));
      expect(rungs.size, screen).toBe(Math.ceil((base + width("access") + width("editor") + width("size")) / 16));
    }
  });

  it("never gives Name or the screen column a rung of its own", () => {
    for (const screen of DOC_LIST_SCREENS) {
      const spec = docListSpec(screen);
      for (const id of ["name", "select", "actions", ...(spec.screenColumn ? [spec.screenColumn] : [])] as DocListColumnId[]) {
        expect(NARROW_HIDING_ORDER as readonly string[]).not.toContain(id);
      }
    }
  });
});
