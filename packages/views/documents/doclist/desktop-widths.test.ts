import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { libraryCell, specLadder } from "../library-columns";
import { DOC_LIST_SCREENS, NAME_FLOOR, WORKSPACE_NAME_FLOOR, docListRungs, nameFloor, docListSpec, type DocListColumnId } from "./columns";

// Desktop widths of the unified list (UNI-2045 W1b). The design board shows all
// eight columns at 1440 (the list container is ~870px beside the two
// sidebars). The workspace screen keeps all eight there; a screen with a
// screen column gives the room of Last edited by and Size to Name (FX6 N1: at
// 184px Name left ~96px of text on Trash and Recent), so its title always
// holds ~200px of text (22 characters) after the cell padding, the group
// indent and the icon.

const CONTAINER_1440 = 870;
const CONTAINER_1280 = 710;

const width = (screen: (typeof DOC_LIST_SCREENS)[number], id: DocListColumnId) =>
  docListSpec(screen).columns.find((column) => column.id === id)?.width;

const rungOf = (cell: string | null): number | null => {
  const match = cell?.match(/@min-\[(\d+)rem\]\/library:table-cell/);
  return match ? Number(match[1]) : null;
};

const own = (screen: (typeof DOC_LIST_SCREENS)[number]) => docListSpec(screen).screenColumn as DocListColumnId;

/** The columns that show at a container width, in DOM order: each optional one joins at its rung. */
function visible(screen: (typeof DOC_LIST_SCREENS)[number], container: number): DocListColumnId[] {
  const spec = docListSpec(screen);
  const rungs = docListRungs(spec);
  const joins: Partial<Record<DocListColumnId, number>> = {
    [spec.screenColumn ?? "name"]: rungs.table,
    updated: rungs.table,
    access: rungs.access,
    editor: rungs.editor,
    size: rungs.size,
  };
  return spec.columns.map((c) => c.id).filter((id) => id === "select" || id === "name" || id === "actions" || container >= (joins[id] ?? 0) * 16);
}

/** What Name gets at a container width: the container less the visible columns and the 2px border. */
function nameRoom(screen: (typeof DOC_LIST_SCREENS)[number], container: number): number {
  const spec = docListSpec(screen);
  const fixed = visible(screen, container).reduce((sum, id) => sum + (spec.columns.find((c) => c.id === id)?.width ?? 0), 0);
  return container - fixed - 2;
}

/** The title text the contract asks for (~22 characters); the workspace screen shows all eight columns at 1440 and keeps a little less. */
const titleText = (screen: (typeof DOC_LIST_SCREENS)[number]) => (screen === "workspace" ? 172 : 200);

describe("desktop widths of the shared columns", () => {
  it("pins the widths the cells need (padding included) and the Name floor", () => {
    for (const screen of DOC_LIST_SCREENS) {
      expect(width(screen, "select"), screen).toBe(32);
      // 128: the "Được chia sẻ" pill is ~104px and the cell keeps 16px of padding (F6 truncated it at 120).
      expect(width(screen, "access"), screen).toBe(128);
      // 146 / 102: the sorted header (label + 14px arrow + 4px gap + 16px padding) must fit, see "sorted header" below.
      expect(width(screen, "editor"), screen).toBe(146);
      expect(width(screen, "updated"), screen).toBe(118);
      expect(width(screen, "size"), screen).toBe(102);
      expect(width(screen, "actions"), screen).toBe(76);
      expect(width(screen, "name"), screen).toBe(0);
      const own = docListSpec(screen).screenColumn;
      // Lần mở gần nhất and its sort arrow need 132px; every other screen column is 118px.
      if (own) expect(width(screen, own), screen).toBe(own === "activity" ? 132 : 118);
    }
    // 288 = 200px of title text + 88px around it in a grouped row (12px right padding, 40px left padding under a group
    // header, 24px icon, 12px gap). The workspace screen has no screen column, so its eight columns need 260 to all fit
    // 1440: 870 - (32 + 128 + 146 + 118 + 102 + 76 + 2) leaves Name 266.
    expect(NAME_FLOOR).toBe(288);
    expect(WORKSPACE_NAME_FLOOR).toBe(260);
    for (const screen of DOC_LIST_SCREENS) expect(nameFloor(docListSpec(screen)), screen).toBe(screen === "workspace" ? 260 : 288);
  });

  it("leaves the Access content box room for the full Được chia sẻ pill, on every screen (F6)", () => {
    // Badge: 6px left padding + 12px icon + 4px gap + ~72px of 12px text + 8px right padding + 2px border (measured in the
    // browser look); the cell keeps 8px of padding each side. At 120px the word was cut at 1440 ("Được chia ...").
    const PILL = 104;
    const CELL_PADDING = 16;
    for (const screen of DOC_LIST_SCREENS) expect(width(screen, "access")! - CELL_PADDING, screen).toBeGreaterThanOrEqual(PILL);
  });

  it("shows every column of the workspace screen at a 870px container (1440 viewport)", () => {
    expect(docListRungs(docListSpec("workspace")).size * 16).toBeLessThanOrEqual(CONTAINER_1440);
  });

  it("gives Name the room of Last edited by and Size on a screen with a screen column at 870px (FX6 N1)", () => {
    for (const screen of DOC_LIST_SCREENS.filter((s) => s !== "workspace")) {
      const rungs = docListRungs(docListSpec(screen));
      // Screen column, Access and Updated stay; Last edited by and Size wait for a wider list.
      expect(rungs.access * 16, screen).toBeLessThanOrEqual(CONTAINER_1440);
      expect(rungs.editor * 16, screen).toBeGreaterThan(CONTAINER_1440);
      expect(visible(screen, CONTAINER_1440), screen).toEqual(["select", "name", own(screen), "access", "updated", "actions"]);
    }
  });

  it("keeps ~200px of title text at every width where the table layout shows, on every screen (FX6 N1)", () => {
    // 88px of cell padding, group indent, icon and gap sit around the title in a grouped row.
    const AROUND_TITLE = 88;
    for (const screen of DOC_LIST_SCREENS) {
      const rungs = docListRungs(docListSpec(screen));
      for (const container of [rungs.table, rungs.access, rungs.editor, rungs.size].map((rem) => rem * 16)) {
        expect(nameRoom(screen, container) - AROUND_TITLE, `${screen} @${container}`).toBeGreaterThanOrEqual(titleText(screen));
      }
      // And at the two desktop widths the design is checked at.
      for (const container of [CONTAINER_1280, CONTAINER_1440]) {
        if (container >= rungs.table * 16) expect(nameRoom(screen, container) - AROUND_TITLE, `${screen} @${container}`).toBeGreaterThanOrEqual(titleText(screen));
      }
    }
  });

  it("hides Last edited by and Size on the workspace screen at 710px (the 1280 viewport), keeping Access and Updated", () => {
    const rungs = docListRungs(docListSpec("workspace"));
    expect(rungs.access * 16).toBeLessThanOrEqual(CONTAINER_1280);
    expect(rungs.editor * 16).toBeGreaterThan(CONTAINER_1280);
    expect(visible("workspace", CONTAINER_1280)).toEqual(["select", "name", "access", "updated", "actions"]);
  });

  it("keeps the screen column and Updated at 710px on a screen with a screen column; Access waits for the next rung", () => {
    for (const screen of DOC_LIST_SCREENS.filter((s) => s !== "workspace")) {
      const rungs = docListRungs(docListSpec(screen));
      expect(rungs.table * 16, screen).toBeLessThanOrEqual(CONTAINER_1280);
      expect(rungs.access * 16, screen).toBeGreaterThan(CONTAINER_1280);
      expect(visible(screen, CONTAINER_1280), screen).toEqual(["select", "name", own(screen), "updated", "actions"]);
    }
  });

  it("pins the rungs in rem: table, access, editor, size", () => {
    // Rung = the columns up to it + 2px border + the Name floor, rounded up to the rem.
    // workspace: 32 + 118 + 76 + 2 + 260 = 488 -> 31; + 128 = 616 -> 39; + 146 = 762 -> 48; + 102 = 864 -> 54.
    // screen column (118): 32 + 118 + 118 + 76 + 2 + 288 = 634 -> 40; + 128 = 762 -> 48; + 146 = 908 -> 57; + 102 = 1010 -> 64.
    // recent (132): 648 -> 41; 776 -> 49; 922 -> 58; 1024 -> 64.
    const rungs = (screen: (typeof DOC_LIST_SCREENS)[number]) => {
      const { table, access, editor, size } = docListRungs(docListSpec(screen));
      return [table, access, editor, size];
    };
    expect(rungs("workspace")).toEqual([31, 39, 48, 54]);
    expect(rungs("recent")).toEqual([41, 49, 58, 64]);
    for (const screen of DOC_LIST_SCREENS.filter((s) => s !== "workspace" && s !== "recent")) expect(rungs(screen), screen).toEqual([40, 48, 57, 64]);
  });

  it("keeps the stacked layout below the table rung and the Name floor at every rung", () => {
    for (const screen of DOC_LIST_SCREENS) {
      const spec = docListSpec(screen);
      const rungs = docListRungs(spec);
      const w = (id: DocListColumnId) => spec.columns.find((c) => c.id === id)?.width ?? 0;
      const fixed = w("select") + w("updated") + w("actions") + (spec.screenColumn ? w(spec.screenColumn) : 0) + 2;
      expect(rungs.table * 16 - fixed, screen).toBeGreaterThanOrEqual(nameFloor(spec));
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

describe("Tailwind literals", () => {
  // Tailwind only generates a class it can read in the source: a `w-[${px}px]`
  // built from a number is silently missing in the browser (jsdom cannot tell).
  const source = readFileSync(resolve(process.cwd(), "documents/library-columns.ts"), "utf8");

  it("writes every width class and every rung class of the spec out as a literal", () => {
    for (const screen of DOC_LIST_SCREENS) {
      const spec = docListSpec(screen);
      for (const column of spec.columns.filter((c) => c.id !== "name")) expect(source, `${screen}/${column.id}`).toContain(`"w-[${column.width}px]"`);
      const rungs = docListRungs(spec);
      for (const rung of Object.values(rungs)) {
        for (const utility of ["table-column", "table-cell", "table-header-group", "hidden", "hidden!"]) {
          expect(source, `${screen} ${rung}rem ${utility}`).toContain(`@min-[${rung}rem]/library:${utility}`);
        }
      }
    }
  });
});

describe("sorted header labels", () => {
  // Inter 500 at the 12px caption size, measured in headless Chromium (FX6). A sorted header is the label, a 4px gap and a
  // 14px arrow inside the cell's 8px padding each side; at 128px "Lần mở gần nhất" and at 84px "Dung lượng" lost their tail
  // to the ellipsis (N2).
  const LABEL_PX: Record<string, { vi: [string, number]; en: [string, number] }> = {
    activity: { vi: ["Lần mở gần nhất", 94], en: ["Last opened", 69] },
    starred: { vi: ["Ngày gắn sao", 77], en: ["Starred on", 60] },
    shared: { vi: ["Người chia sẻ", 77], en: ["Shared by", 58] },
    shared_with: { vi: ["Chia sẻ với", 62], en: ["Shared with", 68] },
    shelved: { vi: ["Lưu trữ", 42], en: ["Archived", 52] },
    deleted: { vi: ["Đã xóa", 40], en: ["Deleted", 44] },
    editor: { vi: ["Người sửa gần nhất", 110], en: ["Last edited by", 79] },
    updated: { vi: ["Cập nhật", 51], en: ["Updated", 48] },
    size: { vi: ["Dung lượng", 65], en: ["Size", 25] },
  };
  const ARROW = 4 + 14;
  const CELL_PADDING = 16;

  it("fits the label and the sort arrow in every sortable column, in vi and en", () => {
    for (const screen of DOC_LIST_SCREENS) {
      for (const column of docListSpec(screen).columns) {
        if (!column.sortKey || column.id === "name") continue;
        const label = LABEL_PX[column.id];
        expect(label, `${screen}/${column.id} has a measured label`).toBeDefined();
        for (const lang of ["vi", "en"] as const) {
          expect(column.width - CELL_PADDING - ARROW, `${screen}/${column.id} ${lang}`).toBeGreaterThanOrEqual(label![lang][1]);
        }
      }
    }
  });

  it("measures the labels the locale files carry", () => {
    // The widths above are hand-measured: a renamed label fails here until it is measured again.
    for (const lang of ["vi", "en"] as const) {
      const locale = JSON.parse(readFileSync(resolve(process.cwd(), `../core/i18n/locales/${lang}.json`), "utf8")) as { documents: { list: { column: Record<string, string>; screen_column: Record<string, string> } } };
      const { column, screen_column } = locale.documents.list;
      for (const [id, label] of Object.entries(LABEL_PX)) expect(column[id] ?? screen_column[id], `${lang}/${id}`).toBe(label[lang][0]);
    }
  });
});

describe("sortable header labels", () => {
  it("lets the header button use the cell's whole content box (its -mx-1 px-1 sit in the padding)", () => {
    const header = readFileSync(resolve(process.cwd(), "documents/library-sort-header.tsx"), "utf8");
    expect(header).toContain("-mx-1");
    expect(header).toContain("max-w-[calc(100%+0.5rem)]");
    expect(header).not.toContain("max-w-full");
  });
});
