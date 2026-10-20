import type { DocumentSortColumn, DocumentSortOrder } from "@uniwork/core/api/endpoints/documents-collections";
import { defaultStorage } from "@uniwork/core/platform";
import type { StorageAdapter } from "@uniwork/core/types/storage";
import { rowSizeBytes, rowTitle, rowUpdatedAt, type LibraryRow } from "./library-rows";

// The column sort of the documents tables (UNI-2038 S2). `{ column, order }`
// is one piece of state per viewer; the lists that page on the server send it
// as `sort`/`order` and show the server's order untouched, the lists that are
// loaded in full (Starred, an open folder) are ordered here.

export type LibrarySortColumn = DocumentSortColumn;
export type LibrarySortOrder = DocumentSortOrder;

export interface LibrarySort {
  column: LibrarySortColumn;
  order: LibrarySortOrder;
}

export const DEFAULT_LIBRARY_SORT: LibrarySort = { column: "updated", order: "desc" };

/** The header cells that sort: Truy cập (computed per viewer after the query) and Thao tác never do. */
export const SORTABLE_COLUMNS: readonly string[] = ["name", "editor", "updated", "size"];

export function isSortableColumn(id: string): id is LibrarySortColumn {
  return SORTABLE_COLUMNS.includes(id);
}

/** What a header click does: a new column starts ascending (Cập nhật and Dung lượng: newest/largest first), the sorted column flips. */
export function nextSort(current: LibrarySort, column: LibrarySortColumn): LibrarySort {
  if (current.column === column) return { column, order: current.order === "asc" ? "desc" : "asc" };
  return { column, order: column === "updated" || column === "size" ? "desc" : "asc" };
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

/** The server's id: a document's id, a source file's own id (not the `source:` row key). */
function idOf(row: LibraryRow): string {
  return row.type === "source" ? row.source.id : row.doc.id;
}

/**
 * Code-point order, which is the order of UTF-8 bytes (what the server's
 * `COLLATE "C"` gives). Plain `<` compares UTF-16 units and differs for
 * astral characters, so this walks code points.
 */
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

const lowerCodePoints = (a: string, b: string): number => compareCodePoints(a.toLowerCase(), b.toLowerCase());

/**
 * The one comparator behind every sort. It reproduces the server's order
 * (UNI-2038 S3): Tên and Người sửa by lowercase title / editor name in
 * code-point order (an accented or "Đ" first letter sorts after "z", a known
 * cost of a collation the web can reproduce), Dung lượng by file size (no
 * file = 0), Cập nhật by update time; ties by id in the same direction. A row
 * with no editor name goes last in both orders, like the server's NULLS LAST.
 * The server-sorted pages are never re-sorted with it; it interleaves the two
 * root streams (`mergeSorted`) and orders the lists loaded in full.
 */
export function compareRows(a: LibraryRow, b: LibraryRow, sort: LibrarySort, names: EditorNames): number {
  const sign = sort.order === "asc" ? 1 : -1;
  let primary = 0;
  switch (sort.column) {
    case "name":
      primary = lowerCodePoints(rowTitle(a), rowTitle(b));
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
        primary = lowerCodePoints(ea, eb);
      }
      break;
    }
    default: {
      const ta = timeOf(a);
      const tb = timeOf(b);
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

function isSort(value: unknown): value is LibrarySort {
  if (typeof value !== "object" || value === null) return false;
  const { column, order } = value as Record<string, unknown>;
  return typeof column === "string" && isSortableColumn(column) && (order === "asc" || order === "desc");
}

export function sortStorageKey(userId: string): string {
  return `${SORT_STORAGE_KEY}:${userId}`;
}

/**
 * Reads the viewer's sort from the core StorageAdapter. An old folder-sort
 * value ("name" | "updated") becomes the new pair once and its key is removed;
 * missing, malformed or throwing storage falls back to the default.
 */
export function readLibrarySort(
  userId: string | null | undefined,
  storage: Pick<StorageAdapter, "getItem" | "setItem" | "removeItem"> | null | undefined = defaultStorage,
): LibrarySort {
  if (!userId || !storage) return DEFAULT_LIBRARY_SORT;
  try {
    const raw = storage.getItem(sortStorageKey(userId));
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isSort(parsed)) return parsed;
    }
  } catch {
    // Malformed JSON or blocked storage: fall through to the legacy key, then the default.
  }
  try {
    const legacyKey = `${LEGACY_FOLDER_SORT_KEY}:${userId}`;
    const legacy = storage.getItem(legacyKey);
    if (legacy === null) return DEFAULT_LIBRARY_SORT;
    const migrated: LibrarySort = legacy === "name" ? { column: "name", order: "asc" } : DEFAULT_LIBRARY_SORT;
    storage.setItem(sortStorageKey(userId), JSON.stringify(migrated));
    storage.removeItem(legacyKey);
    return migrated;
  } catch {
    return DEFAULT_LIBRARY_SORT;
  }
}

/** Persists the viewer's sort under one key for every table; ignores storage failures. */
export function writeLibrarySort(
  userId: string | null | undefined,
  sort: LibrarySort,
  storage: Pick<StorageAdapter, "setItem"> | null | undefined = defaultStorage,
): void {
  if (!userId || !storage) return;
  try {
    storage.setItem(sortStorageKey(userId), JSON.stringify(sort));
  } catch {
    // Storage unavailable or blocked: keep the in-memory selection for this session.
  }
}
