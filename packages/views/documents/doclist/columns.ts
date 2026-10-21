// The column spec of the unified document list: one order for every screen,
// plus exactly one screen column right after Name (none on the workspace
// screen). Pure data and arithmetic, no React: the web table builds its
// container-query ladder from it (../library-columns.ts) and the desktop app
// copies the same rules. Source: contract UNI-2045, "Quy tắc định dạng dùng chung".

/** `workspace` also stands for an open folder; `shelved` is Lưu trữ, `trash` is Thùng rác. */
export const DOC_LIST_SCREENS = ["workspace", "recent", "starred", "shared", "shared-by-me", "shelved", "trash"] as const;
export type DocListScreen = (typeof DOC_LIST_SCREENS)[number];

export type DocListScreenColumnId = "activity" | "starred" | "shared" | "shared_with" | "shelved" | "deleted";
export type DocListColumnId = "select" | "name" | DocListScreenColumnId | "access" | "editor" | "updated" | "size" | "actions";

/** What a header click sorts by. Both shared screens sort by `shared`; the S3 keys are name, editor, updated and size. */
export type DocListSortKey = "name" | "editor" | "updated" | "size" | "activity" | "starred" | "shared" | "shelved" | "deleted";
export type DocListSortOrder = "asc" | "desc";

export interface DocListSort {
  key: DocListSortKey;
  order: DocListSortOrder;
}

export interface DocListColumn {
  id: DocListColumnId;
  /** `documents.list.column.*` or, for the screen column, `documents.list.screen_column.*`. */
  labelKey: string;
  /** Null for the columns that never sort: Select, Access, Actions. */
  sortKey: DocListSortKey | null;
  /**
   * Fixed width in px, cell padding included (the table is `table-fixed`). Name
   * has none: it takes what is left, down to NAME_FLOOR. Each width is what its
   * widest content needs plus the 8px side padding the optional columns carry:
   * "Hôm qua, 16:30" at the 12px mono caption size is ~101px, "Người sửa gần
   * nhất" and "Dung lượng" are the longest headers (~113px and ~70px), the
   * "Được chia sẻ" pill (~104px, icon and padding included) fits Access's 112px content box, and Editor keeps a 24px avatar plus a
   * truncating name.
   */
  width: number;
  align: "left" | "right";
}

export interface DocListSpec {
  screen: DocListScreen;
  /** DOM order, Select first and Actions last. */
  columns: readonly DocListColumn[];
  screenColumn: DocListScreenColumnId | null;
  defaultSort: DocListSort;
}

const SCREEN_COLUMN: Record<DocListScreen, DocListScreenColumnId | null> = {
  workspace: null,
  recent: "activity",
  starred: "starred",
  shared: "shared",
  "shared-by-me": "shared_with",
  shelved: "shelved",
  trash: "deleted",
};

const SCREEN_COLUMN_SORT: Record<DocListScreenColumnId, DocListSortKey> = {
  activity: "activity",
  starred: "starred",
  shared: "shared",
  shared_with: "shared",
  shelved: "shelved",
  deleted: "deleted",
};

/** The room Name keeps before a column joins: it never drops under this. */
export const NAME_FLOOR = 176;
/** The width of a screen column; Recent's Lần mở gần nhất takes 10px more (its label and sort arrow). */
const SCREEN_COLUMN_WIDTH = 118;
const ACTIVITY_WIDTH = 128;
/** The table's 1px borders, both sides. */
const BORDER = 2;

const column = (id: DocListColumnId, sortKey: DocListSortKey | null, width: number, align: "left" | "right" = "left"): DocListColumn => ({
  id,
  labelKey: `documents.list.column.${id}`,
  sortKey,
  width,
  align,
});

const screenColumn = (id: DocListScreenColumnId): DocListColumn => ({
  id,
  labelKey: `documents.list.screen_column.${id}`,
  sortKey: SCREEN_COLUMN_SORT[id],
  width: id === "activity" ? ACTIVITY_WIDTH : SCREEN_COLUMN_WIDTH,
  align: "left",
});

/** The soonest to go first in the trash (Q2); everywhere else the newest first. */
function defaultSortOf(screen: DocListScreen): DocListSort {
  const id = SCREEN_COLUMN[screen];
  if (!id) return { key: "updated", order: "desc" };
  return { key: SCREEN_COLUMN_SORT[id], order: screen === "trash" ? "asc" : "desc" };
}

const SPECS = new Map<DocListScreen, DocListSpec>();

export function docListSpec(screen: DocListScreen): DocListSpec {
  const cached = SPECS.get(screen);
  if (cached) return cached;
  const own = SCREEN_COLUMN[screen];
  const spec: DocListSpec = {
    screen,
    columns: [
      column("select", null, 32),
      column("name", "name", 0),
      ...(own ? [screenColumn(own)] : []),
      column("access", null, 128),
      column("editor", "editor", 130),
      column("updated", "updated", 118),
      column("size", "size", 84, "right"),
      column("actions", null, 76),
    ],
    screenColumn: own,
    defaultSort: defaultSortOf(screen),
  };
  SPECS.set(screen, spec);
  return spec;
}

/** A new column starts ascending for the two text columns and descending for the rest; the sorted column flips. */
export function nextDocListSort(current: DocListSort, key: DocListSortKey): DocListSort {
  if (current.key === key) return { key, order: current.order === "asc" ? "desc" : "asc" };
  return { key, order: key === "name" || key === "editor" ? "asc" : "desc" };
}

/**
 * Narrow tables drop columns in this order, first to go first; Select, Name,
 * the screen column, Updated and Actions stay. The rungs below open them in
 * the reverse order.
 */
export const NARROW_HIDING_ORDER = ["size", "editor", "access"] as const;

export interface DocListRungs {
  /** The table layout itself (header row, Updated, the screen column). Below it the row stacks under Name. */
  table: number;
  access: number;
  editor: number;
  size: number;
}

const rem = (px: number) => Math.ceil(px / 16);

/**
 * The room Name keeps on a screen. Recent's wider activity column takes its 10px
 * from the floor (166), so its rungs sit exactly where the 118px column put them
 * and no other screen moves a rung.
 */
export function nameFloor(spec: DocListSpec): number {
  const own = spec.columns.find((c) => c.id === spec.screenColumn)?.width ?? SCREEN_COLUMN_WIDTH;
  return NAME_FLOOR - (own - SCREEN_COLUMN_WIDTH);
}

/**
 * The container widths, in rem, at which the optional columns join. A rung is
 * every column on screen up to and including it + the border + the Name floor,
 * rounded up to the next rem, so Name never drops under NAME_FLOOR: the
 * columns that hide first open last. The table is measured by its own
 * container, never the viewport, because the docs aside and the app sidebar
 * sit beside it. The design board shows all eight columns at 1440 (a ~870px
 * container: the Size rung is 47rem on the workspace screen, 54rem with a
 * screen column) and, at 1280 (~710px), loses at most Size (Size and Last
 * edited by with a screen column); `doclist/desktop-widths.test.ts` pins it.
 */
export function docListRungs(spec: DocListSpec): DocListRungs {
  const width = (id: DocListColumnId) => spec.columns.find((c) => c.id === id)?.width ?? 0;
  const base =
    width("select") + width("updated") + width("actions") + (spec.screenColumn ? width(spec.screenColumn) : 0) + BORDER + nameFloor(spec);
  const access = base + width("access");
  const editor = access + width("editor");
  const size = editor + width("size");
  return { table: rem(base), access: rem(access), editor: rem(editor), size: rem(size) };
}
