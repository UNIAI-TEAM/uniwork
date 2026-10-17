/**
 * The width ladder of the Documents library table.
 *
 * The table is `table-fixed` inside a `max-w-6xl` list (<= 1104px), beside the
 * docs aside and the app sidebar, so the viewport says nothing about the room
 * it has. Every optional column therefore joins by the width of the list's own
 * container (`@container/library`), in a ladder where Name keeps >= 280px:
 * a rung opens at `280 + 2px border + the fixed columns up to and including
 * it`, rounded up to the next rem. Header, colgroup, cells and the group
 * spanner all read the one class below, so none can drift out of step.
 *
 * Below the first rung only Name and the actions column exist (Name = the
 * container - 82px). Tailwind finds the classes as literals, so each rung is
 * written out in full; `documents-library-ladder.test.tsx` re-derives every
 * threshold from the column widths.
 *
 * Fixed columns (px): actions 80 -> 96 from the first rung, Editor 144,
 * Updated 96, Size 96, Source 112, Type 144, My access 112, Visibility 144.
 * The actions column is 80 and not 56 so a source row's icon button (28) can
 * sit next to the ⋯ menu (28) with the gap and cell padding; on a coarse
 * pointer both grow to the 44px touch target and the column grows to 108
 * with them — the quick app command stays gated until the first rung.
 *
 * | container | plain library              | open folder (Type)        |
 * | --------- | -------------------------- | ------------------------- |
 * | < 45rem   | Name, actions              | Name, actions             |
 * | 45rem     | + Editor, Updated, Size    | + Editor, Updated, Size   |
 * | 52rem     | + Source                   |                           |
 * | 54rem     |                            | + Type                    |
 * | 61rem     |                            | + Source                  |
 * | 68rem     | + My access, Visibility    | (never: 1130px needed)    |
 */

export type LibraryColumnId =
  | "name"
  | "type"
  | "source"
  | "editor"
  | "updated"
  | "size"
  | "access"
  | "visibility"
  | "actions"
  // Trash-only columns (RESTORE-01): who deleted, when, and the purge countdown.
  | "deleted_by"
  | "deleted_at"
  | "purge_in";

interface LibraryColumn {
  id: LibraryColumnId;
  /** Classes of the `<col>`. */
  col: string;
  /** Visibility classes shared by the `<th>` and every `<td>` of the column. */
  cell: string;
}

export interface LibraryLadder {
  /** DOM order, Name first and actions last. */
  columns: LibraryColumn[];
  /** The header row: hidden while only Name and actions exist. */
  head: string;
  /** The app command in the actions cell: shown once the actions column has room for it. */
  quick: string;
  /** The editor · date · size part of the secondary line: hidden once those columns exist. */
  metaHides: string;
  /** The whole secondary line (level + Restricted mark): hidden once My access / Visibility exist. Empty when they never do. */
  accessLineHides: string;
}

const NAME: LibraryColumn = { id: "name", col: "", cell: "" };
const ACTIONS: LibraryColumn = { id: "actions", col: "w-20 pointer-coarse:w-27 pointer-fine:@min-[45rem]/library:w-24", cell: "" };

const EDITOR: LibraryColumn = { id: "editor", col: "hidden w-36 @min-[45rem]/library:table-column", cell: "hidden @min-[45rem]/library:table-cell" };
const UPDATED: LibraryColumn = { id: "updated", col: "hidden w-24 @min-[45rem]/library:table-column", cell: "hidden @min-[45rem]/library:table-cell" };
const SIZE: LibraryColumn = { id: "size", col: "hidden w-24 @min-[45rem]/library:table-column", cell: "hidden @min-[45rem]/library:table-cell" };

const HEAD = "hidden bg-muted/50 @min-[45rem]/library:table-header-group";
const QUICK = "hidden @min-[45rem]/library:block";
const META_HIDES = "@min-[45rem]/library:hidden";

const PLAIN: LibraryLadder = {
  columns: [
    NAME,
    { id: "source", col: "hidden w-28 @min-[52rem]/library:table-column", cell: "hidden @min-[52rem]/library:table-cell" },
    EDITOR,
    UPDATED,
    SIZE,
    { id: "access", col: "hidden w-28 @min-[68rem]/library:table-column", cell: "hidden @min-[68rem]/library:table-cell" },
    { id: "visibility", col: "hidden w-36 @min-[68rem]/library:table-column", cell: "hidden @min-[68rem]/library:table-cell" },
    ACTIONS,
  ],
  head: HEAD,
  quick: QUICK,
  metaHides: META_HIDES,
  accessLineHides: "@min-[68rem]/library:hidden",
};

// With Type the pair would leave Name 254px at the list's widest (1104px), so
// My access / Visibility stay on the secondary line in an open folder.
const WITH_TYPE: LibraryLadder = {
  columns: [
    NAME,
    { id: "type", col: "hidden w-36 @min-[54rem]/library:table-column", cell: "hidden @min-[54rem]/library:table-cell" },
    { id: "source", col: "hidden w-28 @min-[61rem]/library:table-column", cell: "hidden @min-[61rem]/library:table-cell" },
    EDITOR,
    UPDATED,
    SIZE,
    ACTIONS,
  ],
  head: HEAD,
  quick: QUICK,
  metaHides: META_HIDES,
  accessLineHides: "",
};

export function libraryLadder(showType: boolean): LibraryLadder {
  return showType ? WITH_TYPE : PLAIN;
}
/** The actions column of the trash table: two icon buttons below the first
 *  rung (the countdown keeps Name's room), the outlined Khôi phục button beside
 *  the destructive icon button from there on. */
const TRASH_ACTIONS: LibraryColumn = { id: "actions", col: "w-24 pointer-coarse:w-28 @min-[46rem]/library:w-48", cell: "" };

// Trash ladder (Trash.dc, RESTORE-01): Name / Deleted by / Deleted at /
// Deleted forever in / Actions. Below 46rem only Name and actions exist and
// the secondary line carries the deleted-by/at/countdown meta; Deleted by
// lands last because its 160px are the widest single addition.
//
// | container | trash                       |
// | --------- | --------------------------- |
// | < 46rem   | Name, actions               |
// | 46rem     | + Deleted at, Purge in      |
// | 56rem     | + Deleted by                |
const TRASH: LibraryLadder = {
  columns: [
    NAME,
    { id: "deleted_by", col: "hidden w-40 @min-[56rem]/library:table-column", cell: "hidden @min-[56rem]/library:table-cell" },
    { id: "deleted_at", col: "hidden w-28 @min-[46rem]/library:table-column", cell: "hidden @min-[46rem]/library:table-cell" },
    { id: "purge_in", col: "hidden w-36 @min-[46rem]/library:table-column", cell: "hidden @min-[46rem]/library:table-cell" },
    TRASH_ACTIONS,
  ],
  head: "hidden bg-muted/50 @min-[46rem]/library:table-header-group",
  quick: "",
  metaHides: "@min-[46rem]/library:hidden",
  accessLineHides: "@min-[56rem]/library:hidden",
};

/** The trash table's ladder: a narrower Name than the library's, plus the
 *  three meta columns the deleted rows carry. */
export function trashLadder(): LibraryLadder {
  return TRASH;
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
