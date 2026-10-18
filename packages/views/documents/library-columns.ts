/**
 * The width ladder of the Documents library table.
 *
 * The table is `table-fixed` inside a `max-w-6xl` list (<= 1104px), beside the
 * docs aside and the app sidebar, so the viewport says nothing about the room
 * it has. At the default shell the container measures ~712px at a 1280
 * viewport and ~872px at 1440. Every optional column therefore joins by the
 * width of the list's own container (`@container/library`), in a ladder that
 * keeps Name readable: a rung opens at `the fixed columns up to and including
 * it + 2px border + a 220px name floor`, rounded up to the next rem. Name
 * never drops under ~220px: a lower-priority column drops before that can
 * happen, Truy cập first (no longer reachable at the 1440 shell — it needs a
 * ~968px container, i.e. a ~1536px viewport) and Dung lượng next. Header,
 * colgroup, cells and the group spanner all read the one class below, so none
 * can drift out of step.
 *
 * Below the first rung only Name and the actions column exist (Name = the
 * container - 82px, and -110px on a coarse pointer). Tailwind finds the
 * classes as literals, so each rung is written out in full;
 * `documents-library-ladder.test.tsx` re-derives every threshold from the
 * column widths.
 *
 * The six board columns (Main.dc.html / Folder.dc.html — the same at Home and
 * inside a folder) and their fixed widths: Truy cập 190px, Người sửa gần nhất
 * 200px, Cập nhật 140px, Dung lượng 90px (right-aligned), Thao tác 80px.
 * Thao tác is 80 and not 48 so a source row's icon button (28) can sit next
 * to the ⋯ menu (28) with the gap and cell padding; on a coarse pointer both
 * grow to the 44px touch target and the column grows to 108 with them. On a
 * fine pointer it widens to 96px from the first rung, where the app quick
 * command joins it.
 *
 * | container | columns on screen                    |
 * | --------- | ------------------------------------ |
 * | < 29rem   | Name, actions                        |
 * | 29rem     | + Cập nhật, Thao tác 96px, quick     |
 * | 42rem     | + Người sửa gần nhất                 |
 * | 47rem     | + Dung lượng                         |
 * | 59rem     | + Truy cập                           |
 */

export type LibraryColumnId =
  | "name"
  | "access"
  | "editor"
  | "updated"
  | "size"
  | "actions"
  // Shelved-only columns (ARCHIVE-01 U-2): who archived it and when.
  | "shelved_by"
  | "shelved_at";

interface LibraryColumn {
  id: LibraryColumnId;
  /** Classes of the `<col>`. */
  col: string;
  /** Visibility (and alignment) classes shared by the `<th>` and every `<td>` of the column. */
  cell: string;
}

export interface LibraryLadder {
  /** DOM order, Name first and actions last. */
  columns: LibraryColumn[];
  /** The header row: hidden while only Name and actions exist. */
  head: string;
  /** The app command in the actions cell: shown once the actions column has room for it. */
  quick: string;
  /** The editor part of the secondary line: hidden once its column exists. */
  metaHides: string;
  /** The updated · size part of the secondary line: hidden once those columns exist. */
  metaTailHides: string;
  /** The whole secondary line (level + Restricted mark): hidden once Truy cập exists. */
  accessLineHides: string;
}

const NAME: LibraryColumn = { id: "name", col: "", cell: "" };
const ACTIONS: LibraryColumn = { id: "actions", col: "w-20 pointer-coarse:w-27 pointer-fine:@min-[29rem]/library:w-24", cell: "" };

// The board's fixed widths written as px so the mock columns land where the
// design put them; the rungs derive from those widths plus a 220px Name floor
// (29rem = updated 140 + actions 96 + border 2 + floor 220 rounded up, 42rem =
// + editor 200, 47rem = + size 90, 59rem = + access 190 — Truy cập needs a
// ~968px container, so it drops out at the 1440 shell first, Dung lượng next).
const ACCESS: LibraryColumn = { id: "access", col: "hidden w-[190px] @min-[59rem]/library:table-column", cell: "hidden @min-[59rem]/library:table-cell" };
const EDITOR: LibraryColumn = { id: "editor", col: "hidden w-[200px] @min-[42rem]/library:table-column", cell: "hidden @min-[42rem]/library:table-cell" };
const UPDATED: LibraryColumn = { id: "updated", col: "hidden w-[140px] @min-[29rem]/library:table-column", cell: "hidden @min-[29rem]/library:table-cell" };
const SIZE: LibraryColumn = { id: "size", col: "hidden w-[90px] @min-[47rem]/library:table-column", cell: "hidden text-right @min-[47rem]/library:table-cell" };

const HEAD = "hidden bg-muted/50 @min-[29rem]/library:table-header-group";
const QUICK = "hidden @min-[29rem]/library:block";

const LADDER: LibraryLadder = {
  columns: [NAME, ACCESS, EDITOR, UPDATED, SIZE, ACTIONS],
  head: HEAD,
  quick: QUICK,
  metaHides: "@min-[42rem]/library:hidden",
  metaTailHides: "@min-[29rem]/library:hidden",
  accessLineHides: "@min-[59rem]/library:hidden",
};

export function libraryLadder(): LibraryLadder {
  return LADDER;
}

// Shelved ladder (Archive.dc, ARCHIVE-01 U-2): Name (with the folder path as
// its secondary line) / Truy cập / Lưu trữ bởi / Lưu trữ lúc / Actions. Below
// 46rem only Name and the actions exist; the member name lands last because
// its 160px are the widest single addition.
//
// | container | shelved                          |
// | --------- | -------------------------------- |
// | < 46rem   | Name, actions                    |
// | 46rem     | + Truy cập, Lưu trữ lúc          |
// | 56rem     | + Lưu trữ bởi                    |
const SHELVED: LibraryLadder = {
  columns: [
    NAME,
    { id: "access", col: "hidden w-24 @min-[46rem]/library:table-column", cell: "hidden @min-[46rem]/library:table-cell" },
    { id: "shelved_by", col: "hidden w-40 @min-[56rem]/library:table-column", cell: "hidden @min-[56rem]/library:table-cell" },
    { id: "shelved_at", col: "hidden w-28 @min-[46rem]/library:table-column", cell: "hidden @min-[46rem]/library:table-cell" },
    // Two labelled commands (restore from Lưu trữ, move to trash) plus the ⋯ menu.
    { id: "actions", col: "w-24 pointer-coarse:w-28 @min-[46rem]/library:w-48", cell: "" },
  ],
  head: "hidden bg-muted/50 @min-[46rem]/library:table-header-group",
  quick: "",
  metaHides: "@min-[46rem]/library:hidden",
  metaTailHides: "@min-[46rem]/library:hidden",
  accessLineHides: "@min-[56rem]/library:hidden",
};

/** The Lưu trữ table's ladder: the access column plus the shelved pair. */
export function shelvedLadder(): LibraryLadder {
  return SHELVED;
}

/** The visibility class of one column's cells, or null when this ladder has no such column. */
export function libraryCell(ladder: LibraryLadder, id: LibraryColumnId): string | null {
  return ladder.columns.find((column) => column.id === id)?.cell ?? null;
}

/**
 * Group-header spanners after the first (Name + one more column, always on
 * screen): one per distinct rung, each as wide as the columns that join at it,
 * so the spanner covers exactly the visible columns at every width (a wider
 * colSpan would add implicit columns that squeeze Name).
 */
export function libraryGroupSpans(ladder: LibraryLadder): { cell: string; span: number }[] {
  const spans: { cell: string; span: number }[] = [];
  for (const column of ladder.columns) {
    if (!column.cell) continue;
    const last = spans.find((entry) => entry.cell === column.cell);
    if (last) last.span += 1;
    else spans.push({ cell: column.cell, span: 1 });
  }
  return spans;
}
