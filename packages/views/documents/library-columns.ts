/**
 * The width ladder of the Documents library table.
 *
 * The table is `table-fixed` inside a `max-w-6xl` list (<= 1104px), beside the
 * docs aside and the app sidebar, so the viewport says nothing about the room
 * it has. At the default shell the container measures ~712px at a 1280
 * viewport and ~872px at 1440. Every optional column therefore joins by the
 * width of the list's own container (`@container/library`), in a ladder that
 * keeps Name readable: a rung opens at `the fixed columns up to and including
 * it + 2px border + a 160px name floor`, rounded up to the next rem — except
 * Truy cập, which sits exactly at the widest width a 1440 shell reaches.
 * Header, colgroup, cells and the group spanner all read the one class below,
 * so none can drift out of step.
 *
 * Below the first rung only Name and the actions column exist (Name = the
 * container - 50px). Tailwind finds the classes as literals, so each rung is
 * written out in full; `documents-library-ladder.test.tsx` re-derives every
 * threshold from the column widths.
 *
 * The six board columns (Main.dc.html / Folder.dc.html — the same at Home and
 * inside a folder) and their fixed widths: Truy cập 190px, Người sửa gần nhất
 * 200px, Cập nhật 140px, Dung lượng 90px (right-aligned), Thao tác 48px.
 * Thao tác widens to 96px once the app command can join it.
 *
 * | container | columns on screen                    |
 * | --------- | ------------------------------------ |
 * | < 25rem   | Name, actions                        |
 * | 25rem     | + Cập nhật, Dung lượng               |
 * | 41rem     | + Người sửa gần nhất                 |
 * | 54rem     | + Truy cập                           |
 */

export type LibraryColumnId = "name" | "access" | "editor" | "updated" | "size" | "actions";

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
const ACTIONS: LibraryColumn = { id: "actions", col: "w-12 @min-[54rem]/library:w-24", cell: "" };

// The board's fixed widths written as px so the mock columns land where the
// design put them; the rungs derive from those widths plus a 160px Name floor
// (28rem = updated 140 + size 90 + actions 48 + border 2 + floor 160 rounded
// up, 40rem = + editor 200, 53rem = + access 190 capped just under what the
// 1440 shell's ~872px container reaches).
const ACCESS: LibraryColumn = { id: "access", col: "hidden w-[190px] @min-[53rem]/library:table-column", cell: "hidden @min-[53rem]/library:table-cell" };
const EDITOR: LibraryColumn = { id: "editor", col: "hidden w-[200px] @min-[40rem]/library:table-column", cell: "hidden @min-[40rem]/library:table-cell" };
const UPDATED: LibraryColumn = { id: "updated", col: "hidden w-[140px] @min-[28rem]/library:table-column", cell: "hidden @min-[28rem]/library:table-cell" };
const SIZE: LibraryColumn = { id: "size", col: "hidden w-[90px] @min-[28rem]/library:table-column", cell: "hidden text-right @min-[28rem]/library:table-cell" };

const HEAD = "hidden bg-muted/50 @min-[28rem]/library:table-header-group";
const QUICK = "hidden @min-[54rem]/library:block";

const LADDER: LibraryLadder = {
  columns: [NAME, ACCESS, EDITOR, UPDATED, SIZE, ACTIONS],
  head: HEAD,
  quick: QUICK,
  metaHides: "@min-[40rem]/library:hidden",
  metaTailHides: "@min-[28rem]/library:hidden",
  accessLineHides: "@min-[53rem]/library:hidden",
};

export function libraryLadder(): LibraryLadder {
  return LADDER;
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
