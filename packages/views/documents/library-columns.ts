import { docListRungs, docListSpec, type DocListColumnId, type DocListScreen } from "./doclist/columns";

/**
 * The width ladders of the Documents library table.
 *
 * The table is `table-fixed` inside a `max-w-6xl` list (<= 1104px), beside the
 * docs aside and the app sidebar, so the viewport says nothing about the room
 * it has. At the default shell the container measures ~712px at a 1280
 * viewport and ~872px at 1440. Every optional column therefore joins by the
 * width of the list's own container (`@container/library`), in a ladder that
 * keeps Name readable: a rung opens at `the fixed columns up to and including
 * it + 2px border + a 220px name floor`, rounded up to the next rem. Header,
 * colgroup, cells and the group spanner all read the one class per column, so
 * none can drift out of step. Tailwind finds the classes as literals, so each
 * rung is written out in full.
 *
 * The ladder is `specLadder` (the unified list, contract UNI-2045, driven
 * from doclist/columns.ts), one for every screen.
 */

interface LibraryColumn {
  id: DocListColumnId;
  /** Classes of the `<col>`. */
  col: string;
  /** Visibility (and alignment) classes shared by the `<th>` and every `<td>` of the column. */
  cell: string;
  /** Horizontal padding of the `<th>` and every `<td>`; absent reads `px-3`. */
  pad?: string;
}

/** What a library row reads from the ladder: its columns and the classes of its narrow secondary line. */
export interface RowLadder {
  /** DOM order, Name first (after Select) and actions last. */
  columns: readonly LibraryColumn[];
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
  /** The level · scope part of the secondary line: hidden once the access column exists. */
  accessGroupHides: string;
  /** The separator between the meta group and the access group: hidden when either neighbour leaves. */
  metaDotHides: string;
  /** The screen column's content under Name: hidden once the screen column exists (the unified ladder only). */
  screenLineHides?: string;
}

/** The horizontal padding of one column's header and cells: the spec ladder tightens the optional ones to `px-2`. */
export function libraryPad(ladder: { columns: readonly LibraryColumn[] }, id: DocListColumnId): string {
  return ladder.columns.find((column) => column.id === id)?.pad ?? "px-3";
}

/** The visibility class of one column's cells, or null when this ladder has no such column. */
export function libraryCell(ladder: { columns: readonly LibraryColumn[] }, id: DocListColumnId): string | null {
  return ladder.columns.find((column) => column.id === id)?.cell ?? null;
}

/**
 * Group-header spanners after the first (Name + one more column, always on
 * screen): one per distinct rung, each as wide as the columns that join at it,
 * so the spanner covers exactly the visible columns at every width (a wider
 * colSpan would add implicit columns that squeeze Name).
 */
export function libraryGroupSpans(ladder: { columns: readonly LibraryColumn[] }): { cell: string; span: number }[] {
  const spans: { cell: string; span: number }[] = [];
  for (const column of ladder.columns) {
    if (!column.cell) continue;
    const last = spans.find((entry) => entry.cell === column.cell);
    if (last) last.span += 1;
    else spans.push({ cell: column.cell, span: 1 });
  }
  return spans;
}

// The ladder of the unified list (contract UNI-2045): driven from the column
// spec in doclist/columns.ts, which owns the widths and derives the rungs. Name,
// Select and Actions are always on; below the table rung the header, Updated and
// the screen column are off and the row stacks under Name. Above it Truy cập,
// Người sửa gần nhất and Dung lượng join in that order (they hide in the
// reverse). Tailwind finds a class only as a literal, so every rung the specs
// can produce is written out here; `doclist/ladder.test.ts` fails when a spec
// derives a rung that has no entry.
// `hideNow` is `hide` with `!`: it wins over a display class of the same rung
// (the row's own 34rem `inline`, which the workspace Access rung can equal).
type RungClasses = { col: string; cell: string; head: string; hide: string; hideNow: string; show: string };

// `w-[Npx]` of each column, written out for the same reason: Tailwind cannot see a class built from a number.
const WIDTH_CLASSES: Record<number, string> = {
  32: "w-[32px]",
  76: "w-[76px]",
  84: "w-[84px]",
  118: "w-[118px]",
  120: "w-[120px]",
  128: "w-[128px]",
  130: "w-[130px]",
};

/** The width class of a spec column; a spec width without an entry throws (the ladder test names it). */
function widthClass(px: number): string {
  const cls = WIDTH_CLASSES[px];
  if (!cls) throw new Error(`library-columns: no width class for ${px}px`);
  return cls;
}

const RUNG_CLASSES: Record<number, RungClasses> = {
  26: { col: "hidden @min-[26rem]/library:table-column", cell: "hidden @min-[26rem]/library:table-cell", head: "hidden bg-muted/50 @min-[26rem]/library:table-header-group", hide: "@min-[26rem]/library:hidden", hideNow: "@min-[26rem]/library:hidden!", show: "hidden @min-[26rem]/library:block" },
  34: { col: "hidden @min-[34rem]/library:table-column", cell: "hidden @min-[34rem]/library:table-cell", head: "hidden bg-muted/50 @min-[34rem]/library:table-header-group", hide: "@min-[34rem]/library:hidden", hideNow: "@min-[34rem]/library:hidden!", show: "hidden @min-[34rem]/library:block" },
  41: { col: "hidden @min-[41rem]/library:table-column", cell: "hidden @min-[41rem]/library:table-cell", head: "hidden bg-muted/50 @min-[41rem]/library:table-header-group", hide: "@min-[41rem]/library:hidden", hideNow: "@min-[41rem]/library:hidden!", show: "hidden @min-[41rem]/library:block" },
  42: { col: "hidden @min-[42rem]/library:table-column", cell: "hidden @min-[42rem]/library:table-cell", head: "hidden bg-muted/50 @min-[42rem]/library:table-header-group", hide: "@min-[42rem]/library:hidden", hideNow: "@min-[42rem]/library:hidden!", show: "hidden @min-[42rem]/library:block" },
  47: { col: "hidden @min-[47rem]/library:table-column", cell: "hidden @min-[47rem]/library:table-cell", head: "hidden bg-muted/50 @min-[47rem]/library:table-header-group", hide: "@min-[47rem]/library:hidden", hideNow: "@min-[47rem]/library:hidden!", show: "hidden @min-[47rem]/library:block" },
  49: { col: "hidden @min-[49rem]/library:table-column", cell: "hidden @min-[49rem]/library:table-cell", head: "hidden bg-muted/50 @min-[49rem]/library:table-header-group", hide: "@min-[49rem]/library:hidden", hideNow: "@min-[49rem]/library:hidden!", show: "hidden @min-[49rem]/library:block" },
  54: { col: "hidden @min-[54rem]/library:table-column", cell: "hidden @min-[54rem]/library:table-cell", head: "hidden bg-muted/50 @min-[54rem]/library:table-header-group", hide: "@min-[54rem]/library:hidden", hideNow: "@min-[54rem]/library:hidden!", show: "hidden @min-[54rem]/library:block" },
};

/** The rung's literal classes; a spec that derives a rung without an entry throws (the ladder test names it). */
function atRung(rung: number): RungClasses {
  const classes = RUNG_CLASSES[rung];
  if (!classes) throw new Error(`library-columns: no container-query classes for the ${rung}rem rung`);
  return classes;
}

/** The unified list's ladder: the spec's columns, the header class and the classes of the row's narrow line. */
export interface SpecLadder extends RowLadder {
  columns: LibraryColumn[];
  screenLineHides: string;
}

/**
 * The unified list's column ladder for one screen, in DOM order. The Select
 * column is the spec's and stays unless the caller passes `selectable: false`
 * (the live screens until bulk selection lands, W9); the rungs count it either
 * way, so turning it on moves no other column.
 *
 * The row's narrow line stands in for the columns that are off: below the
 * table rung it carries the screen column's content and the updated · size
 * part; the level · scope part leaves when Truy cập joins, the editor (and so
 * the whole line) when Người sửa gần nhất joins.
 */
export function specLadder(screen: DocListScreen, opts: { selectable?: boolean } = {}): SpecLadder {
  const spec = docListSpec(screen);
  const rungs = docListRungs(spec);
  const at = (column: keyof typeof rungs) => atRung(rungs[column]);
  // Every `<col>` takes the spec's width; Name has none. The optional columns carry px-2, Name keeps px-3.
  const PAD = "px-2";
  // Select: 16px box + 14px of hit area each side is 44px on a coarse pointer (pointer-coarse:after:-inset-3.5 on the
  // Checkbox), so the column grows to 44px and the box sits 14px in, clear of the Name button.
  const SELECT_PAD = "px-2 pointer-coarse:px-3.5";
  const columns: LibraryColumn[] = spec.columns.flatMap((column): LibraryColumn[] => {
    const w = column.id === "name" ? "" : widthClass(column.width);
    switch (column.id) {
      case "select":
        return opts.selectable === false ? [] : [{ id: column.id, col: `${w} pointer-coarse:w-11`, cell: "", pad: SELECT_PAD }];
      case "name":
        return [{ id: column.id, col: "", cell: "" }];
      case "access":
        return [{ id: column.id, col: `${w} ${at("access").col}`, cell: at("access").cell, pad: PAD }];
      case "editor":
        return [{ id: column.id, col: `${w} ${at("editor").col}`, cell: at("editor").cell, pad: PAD }];
      case "updated":
        return [{ id: column.id, col: `${w} ${at("table").col}`, cell: at("table").cell, pad: PAD }];
      case "size":
        return [{ id: column.id, col: `${w} ${at("size").col}`, cell: `${at("size").cell} text-right`, pad: PAD }];
      case "actions":
        return [{ id: column.id, col: `${w} pointer-coarse:w-27`, cell: "" }];
      default:
        // The screen column: it holds the table layout's second slot, so it joins with Updated at the table rung.
        return [{ id: column.id, col: `${w} ${at("table").col}`, cell: at("table").cell, pad: PAD }];
    }
  });
  return {
    columns,
    head: at("table").head,
    quick: at("table").show,
    metaHides: at("editor").hide,
    metaTailHides: at("table").hide,
    accessLineHides: at("editor").hide,
    accessGroupHides: at("access").hide,
    metaDotHides: at("access").hideNow,
    screenLineHides: at("table").hide,
  };
}
