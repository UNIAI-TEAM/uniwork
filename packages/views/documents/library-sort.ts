import type { DocumentScreenSort, DocumentSortColumn } from "@uniwork/core/api/endpoints/documents-collections";
import { defaultStorage } from "@uniwork/core/platform";
import type { StorageAdapter } from "@uniwork/core/types/storage";
import { DOC_LIST_SCREENS, docListSpec, nextDocListSort, type DocListScreen, type DocListSortKey, type DocListSortOrder } from "./doclist/columns";
import { rowSizeBytes, rowTitle, rowUpdatedAt, type LibraryRow } from "./library-rows";

// The column sort of the documents tables (UNI-2038 S2, UNI-2045 W12).
// `{ column, order }` is one piece of state per viewer *per screen*: a screen
// with a screen column (Gần đây, Có gắn sao, the two Shared lists, Lưu trữ)
// starts on that column, newest first, and a column picked on one screen never
// reaches another. The lists that page on the server send the sort as
// `sort`/`order` and show the server's order untouched, the lists that are
// loaded in full (Starred, an open folder) are ordered here.

export type LibrarySortColumn = DocListSortKey;
export type LibrarySortOrder = DocListSortOrder;

export interface LibrarySort {
  column: LibrarySortColumn;
  order: LibrarySortOrder;
}

/** What the viewer picked, per screen; a screen that is not in the map is in its default order. */
export type LibrarySortMap = Partial<Record<DocListScreen, LibrarySort>>;

const DEFAULTS = new Map<DocListScreen, LibrarySort>();

/**
 * The order a screen shows until a column is picked: its screen column,
 * newest first (Thùng rác: Đã xóa, the soonest to go first, and fixed); on the
 * workspace, which has no screen column, Cập nhật. One object per screen, so a
 * caller may compare it by reference.
 */
export function defaultSortOf(screen: DocListScreen): LibrarySort {
  let sort = DEFAULTS.get(screen);
  if (!sort) {
    const { key, order } = docListSpec(screen).defaultSort;
    sort = { column: key, order };
    DEFAULTS.set(screen, sort);
  }
  return sort;
}

export const DEFAULT_LIBRARY_SORT: LibrarySort = defaultSortOf("workspace");

/** The sort a screen shows: the viewer's pick, else its default. The trash is fixed. */
export function sortOf(sorts: LibrarySortMap, screen: DocListScreen): LibrarySort {
  return (screen === "trash" ? undefined : sorts[screen]) ?? defaultSortOf(screen);
}

/** What a header click does: the sorted column flips, a new one starts at its natural end (Tên and Người sửa ascending, the rest newest/largest first). */
export function nextSort(current: LibrarySort, column: LibrarySortColumn): LibrarySort {
  const { key, order } = nextDocListSort({ key: current.column, order: current.order }, column);
  return { column: key, order };
}

const S3_COLUMNS: readonly LibrarySortColumn[] = ["name", "editor", "updated", "size"];

/** The `sort` values the server takes (starred is ordered here, the trash is fixed). */
type ServerSortColumn = DocumentSortColumn | DocumentScreenSort;

/** The `sort`/`order` request parameters of a sort; nothing when the column is ordered on the client. */
export function serverSortParams(sort: LibrarySort): { sort: ServerSortColumn; order: LibrarySortOrder } | Record<string, never> {
  return sort.column === "starred" || sort.column === "deleted" ? {} : { sort: sort.column, order: sort.order };
}

/** The sort the files of other modules take: the S3 columns only (a screen's own key means nothing there). */
export function sourcesSortParams(sort: LibrarySort): { sort: DocumentSortColumn; order: LibrarySortOrder } | Record<string, never> {
  return S3_COLUMNS.includes(sort.column) ? { sort: sort.column as DocumentSortColumn, order: sort.order } : {};
}

/** The columns a screen's header can sort by: the S3 four and its own screen column; none in the trash. */
function sortableOn(screen: DocListScreen): readonly LibrarySortColumn[] {
  return screen === "trash" ? [] : docListSpec(screen).columns.flatMap((column) => (column.sortKey ? [column.sortKey] : []));
}

/** The display name of a row's last editor, or null when nobody is named (an agent, an unknown member). */
export type EditorNames = ReadonlyMap<string, string>;

function editorOf(row: LibraryRow, names: EditorNames): string | null {
  if (row.type === "source") return row.source.owner?.name || null;
  if (!row.doc.updated_by || row.doc.updated_by_kind === "agent") return null;
  return names.get(row.doc.updated_by) ?? null;
}

function timeOf(row: LibraryRow): number | null {
  const time = Date.parse(rowUpdatedAt(row));
  return Number.isNaN(time) ? null : time;
}

/** When the viewer starred a document (SV-2); null for a row that carries no such date. */
function starredAtOf(row: LibraryRow): number | null {
  const time = row.type === "document" && row.doc.favorited_at ? Date.parse(row.doc.favorited_at) : Number.NaN;
  return Number.isNaN(time) ? null : time;
}

/** The server's id: a document's id, a source file's own id (not the `source:` row key). */
function idOf(row: LibraryRow): string {
  return row.type === "source" ? row.source.id : row.doc.id;
}

// The server orders Tên and Người sửa by an ICU Vietnamese collation; the web
// reproduces it with Intl.Collator("vi") at "variant" sensitivity (case,
// accents and the five tones all count). The shared fixture
// packages/core/documents/vi-sort-fixture.json holds both sides to the same
// order (library-sort-vi-order.test.ts).
const viCollator = new Intl.Collator("vi", { sensitivity: "variant" });

/** Code-point order of ids (they are ASCII ULIDs, so this is the server's byte order). */
function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const ra = ia.next();
    const rb = ib.next();
    if (ra.done || rb.done) return ra.done === rb.done ? 0 : ra.done ? -1 : 1;
    const diff = ra.value.codePointAt(0)! - rb.value.codePointAt(0)!;
    if (diff !== 0) return diff;
  }
}

/**
 * The one comparator behind every sort. It reproduces the server's order
 * (UNI-2038 S3): Tên and Người sửa by title / editor name in Vietnamese
 * collation (Đ after D, tones in the Vietnamese order), Dung lượng by file
 * size (no file = 0), Cập nhật by update time; ties by id in code-point order
 * in the same direction. A row
 * with no editor name goes last in both orders, like the server's NULLS LAST.
 * The server-sorted pages are never re-sorted with it; it interleaves the two
 * root streams (`mergeSorted`) and orders the lists loaded in full.
 */
export function compareRows(a: LibraryRow, b: LibraryRow, sort: LibrarySort, names: EditorNames): number {
  const sign = sort.order === "asc" ? 1 : -1;
  let primary = 0;
  switch (sort.column) {
    case "name":
      primary = viCollator.compare(rowTitle(a), rowTitle(b));
      break;
    case "size":
      primary = (rowSizeBytes(a) ?? 0) - (rowSizeBytes(b) ?? 0);
      break;
    case "editor": {
      const ea = editorOf(a, names);
      const eb = editorOf(b, names);
      if (ea === null || eb === null) {
        if (ea !== eb) return ea === null ? 1 : -1;
      } else {
        primary = viCollator.compare(ea, eb);
      }
      break;
    }
    default: {
      // Cập nhật, and Ngày gắn sao on Có gắn sao: the only screen column the client orders.
      const at = sort.column === "starred" ? starredAtOf : timeOf;
      const ta = at(a);
      const tb = at(b);
      if (ta === null || tb === null) {
        if (ta !== tb) return ta === null ? 1 : -1;
      } else {
        primary = ta - tb;
      }
    }
  }
  return sign * (primary !== 0 ? primary : compareCodePoints(idOf(a), idOf(b)));
}

/** Orders rows that were loaded in full (Starred, an open folder). */
export function sortRows(rows: LibraryRow[], sort: LibrarySort, names: EditorNames): LibraryRow[] {
  return [...rows].sort((a, b) => compareRows(a, b, sort, names));
}

/**
 * The home root's two independently paged lists (workspace documents, files
 * from other modules), each already in the server's order for `sort`, as one
 * table in that order. A row is shown only when it does not sort after the
 * last row loaded from the other list when that one still has pages: the next
 * page of either list can then only add rows below the ones on screen, so
 * "Load more" never slots a row above what the user already sees. Each list keeps its own
 * order; only the two are interleaved with the one comparator. A list that is exhausted (or empty) sets no bound.
 */
export function mergeSorted(
  docs: LibraryRow[],
  sources: LibraryRow[],
  more: { docs: boolean; sources: boolean },
  sort: LibrarySort,
  names: EditorNames,
): LibraryRow[] {
  // A row waits only for the *other* stream's next page: its own list is
  // already in the server's order, so it can never be cut by its own bound.
  const docBound = more.sources ? sources.at(-1) : undefined;
  const sourceBound = more.docs ? docs.at(-1) : undefined;
  const beyond = (row: LibraryRow, bound: LibraryRow | undefined) => bound !== undefined && compareRows(row, bound, sort, names) > 0;
  const out: LibraryRow[] = [];
  let i = 0;
  let j = 0;
  while (i < docs.length || j < sources.length) {
    const takeDoc = j >= sources.length || (i < docs.length && compareRows(docs[i]!, sources[j]!, sort, names) <= 0);
    const row = takeDoc ? docs[i++]! : sources[j++]!;
    if (!beyond(row, takeDoc ? docBound : sourceBound)) out.push(row);
  }
  return out;
}

export const SORT_STORAGE_KEY = "uniwork_documents_sort";
// The folder view's old two-value choice; read once into the new key, then dropped.
const LEGACY_FOLDER_SORT_KEY = "uniwork_documents_folder_sort";

function isSortPair(value: unknown): value is { column: string; order: LibrarySortOrder } {
  if (typeof value !== "object" || value === null) return false;
  const { column, order } = value as Record<string, unknown>;
  return typeof column === "string" && (order === "asc" || order === "desc");
}

function isSortOn(screen: DocListScreen, value: unknown): value is LibrarySort {
  return isSortPair(value) && (sortableOn(screen) as readonly string[]).includes(value.column);
}

export function sortStorageKey(userId: string): string {
  return `${SORT_STORAGE_KEY}:${userId}`;
}

type SortStorage = Pick<StorageAdapter, "getItem" | "setItem" | "removeItem">;

/** The stored map as an object of valid entries: each screen keeps only a column it can sort by (the trash keeps none). */
function validEntries(raw: Record<string, unknown>): LibrarySortMap {
  const sorts: LibrarySortMap = {};
  for (const screen of DOC_LIST_SCREENS) {
    const entry = raw[screen];
    if (isSortOn(screen, entry)) sorts[screen] = { column: entry.column as LibrarySortColumn, order: entry.order };
  }
  return sorts;
}

/**
 * Reads the viewer's sort of every screen from the core StorageAdapter. The
 * stored value is a map by screen. Two older shapes are read once into the
 * workspace entry (an open folder shares it) and the key is rewritten as a
 * map: the single `{ column, order }` every table used to share, and the
 * folder view's "name" | "updated" under its own key, which is removed.
 * Missing, malformed or throwing storage gives no entries, so every screen
 * shows its default.
 */
export function readLibrarySorts(userId: string | null | undefined, storage: SortStorage | null | undefined = defaultStorage): LibrarySortMap {
  if (!userId || !storage) return {};
  try {
    const raw = storage.getItem(sortStorageKey(userId));
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isSortPair(parsed)) {
        const migrated: LibrarySortMap = isSortOn("workspace", parsed) ? { workspace: parsed } : {};
        writeLibrarySorts(userId, migrated, storage);
        return migrated;
      }
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return validEntries(parsed as Record<string, unknown>);
    }
  } catch {
    // Malformed JSON or blocked storage: fall through to the legacy key, then no entries.
  }
  try {
    const legacyKey = `${LEGACY_FOLDER_SORT_KEY}:${userId}`;
    const legacy = storage.getItem(legacyKey);
    if (legacy === null) return {};
    const migrated: LibrarySortMap = { workspace: legacy === "name" ? { column: "name", order: "asc" } : DEFAULT_LIBRARY_SORT };
    writeLibrarySorts(userId, migrated, storage);
    storage.removeItem(legacyKey);
    return migrated;
  } catch {
    return {};
  }
}

/** Persists the viewer's per-screen sorts under one key; ignores storage failures. */
export function writeLibrarySorts(
  userId: string | null | undefined,
  sorts: LibrarySortMap,
  storage: Pick<StorageAdapter, "setItem"> | null | undefined = defaultStorage,
): void {
  if (!userId || !storage) return;
  try {
    storage.setItem(sortStorageKey(userId), JSON.stringify(sorts));
  } catch {
    // Storage unavailable or blocked: keep the in-memory selection for this session.
  }
}
