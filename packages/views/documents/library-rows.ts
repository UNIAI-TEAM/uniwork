import { DOCUMENT_FILE_FORMATS, isMyFolder, type DocumentList, type DocumentTreeNode } from "@uniwork/core/types/document";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { defaultStorage } from "@uniwork/core/platform";
import type { StorageAdapter } from "@uniwork/core/types/storage";
import { documentIconFormat, fileExtension } from "./document-type-icon";

// The library table's rows as one model: a workspace document or a file that
// lives in another module (chat, task, meeting, email) and is listed here as
// a link. Grouping and sorting are pure functions of the rows the server
// returned; nothing here invents a row or a count. The type chip and the
// access filter went server-side with UNI-1868 (the document lists take
// `format`/`access`/`kind` and key them), so `matchesChip`/`matchesAccess`
// remain only for what the server cannot filter: merged source rows, the
// starred view (favorites + cache) and the sources view.
export type DocumentSummaryRow = DocumentList["documents"][number];

export type LibraryRow =
  | { type: "document"; id: string; doc: DocumentSummaryRow }
  | { type: "source"; id: string; source: DocumentSourceFile };

export const TYPE_CHIPS = ["all", "page", "docx", "xlsx", "pptx", "pdf", "md", "html"] as const;
export type TypeChip = (typeof TYPE_CHIPS)[number];

/**
 * The access filter beside the type chips: every row, the rows the viewer
 * manages, the rows the viewer can edit (edit or manage), or restricted rows.
 */
export const ACCESS_FILTERS = ["all", "manage", "edit", "restricted"] as const;
export type AccessFilter = (typeof ACCESS_FILTERS)[number];

export const GROUP_BY = ["folder", "source", "type", "none"] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export const FOLDER_SORT = ["name", "updated"] as const;
export type FolderSort = (typeof FOLDER_SORT)[number];

export const DEFAULT_FOLDER_SORT: FolderSort = "updated";
export const FOLDER_SORT_STORAGE_KEY = "uniwork_documents_folder_sort";

/**
 * Where a row came from, for the Source column and "group by source". A
 * document is uploaded or created here; "documents" is a server that does
 * not say which.
 */
export type RowOrigin = "upload" | "created" | "documents" | "chat" | "task" | "meeting" | "email" | "other";

export function documentRow(doc: DocumentSummaryRow): LibraryRow {
  return { type: "document", id: doc.id, doc };
}

export function sourceRow(source: DocumentSourceFile): LibraryRow {
  return { type: "source", id: `source:${source.id}`, source };
}

/**
 * The format a row draws and filters by: page, folder, or the file's format.
 * The server derives a file's format from the current version's MIME (else
 * the title's extension) and reports it as `format`; the extension is the
 * fallback for rows that carry none (an older server, a hand-built row).
 * Anything else — a source file, or a server value this client does not
 * know — falls to the extension, then to the generic file.
 */
export function rowFormat(row: LibraryRow): string {
  if (row.type === "document") {
    if (row.doc.kind === "page" || row.doc.kind === "folder") return row.doc.kind;
    const format = row.doc.format?.toLowerCase() ?? "";
    if ((DOCUMENT_FILE_FORMATS as readonly string[]).includes(format)) return format;
    return fileExtension(row.doc.title) || "file";
  }
  return row.source.extension?.toLowerCase() || fileExtension(row.source.name) || "file";
}

export function rowOrigin(row: LibraryRow): RowOrigin {
  if (row.type === "document") {
    switch (row.doc.origin) {
      case "upload":
      case "created":
        return row.doc.origin;
      default:
        return "documents";
    }
  }
  switch (row.source.source) {
    case "chat":
    case "task":
    case "meeting":
    case "email":
      return row.source.source;
    default:
      return "other";
  }
}

/** A file document's or a source file's size; pages, folders and unknown sizes say nothing. */
export function rowSizeBytes(row: LibraryRow): number | null {
  if (row.type === "source") return row.source.size_bytes ?? null;
  return row.doc.kind === "file" && (row.doc.size_bytes ?? 0) > 0 ? (row.doc.size_bytes ?? null) : null;
}

export function rowTitle(row: LibraryRow): string {
  return row.type === "document" ? row.doc.title : row.source.name;
}

export function rowUpdatedAt(row: LibraryRow): string {
  return (row.type === "document" ? row.doc.updated_at : row.source.updated_at) ?? "";
}

/** A folder row navigates; every other row opens. */
export function isFolderRow(row: LibraryRow): boolean {
  return row.type === "document" && row.doc.kind === "folder";
}

/** The translation key (`documents.file_types.*`) for a row's Type column cell. */
export function rowTypeKey(row: LibraryRow): string {
  const format = isFolderRow(row) ? "folder" : rowFormat(row);
  switch (format) {
    case "folder":
      return "documents.file_types.folder";
    case "page":
      return "documents.file_types.page";
    case "docx":
      return "documents.file_types.docx";
    case "xlsx":
      return "documents.file_types.xlsx";
    case "pptx":
      return "documents.file_types.pptx";
    case "pdf":
      return "documents.file_types.pdf";
    case "md":
      return "documents.file_types.md";
    case "html":
      return "documents.file_types.html";
    default:
      return "documents.file_types.file";
  }
}

/**
 * The type chip keeps folders visible (they are how one gets to the files)
 * except under "UniNote", which lists pages only. Document lists send the chip
 * to the server (`format`/`kind`); this predicate remains only for the rows
 * the server cannot filter: merged source files and the starred view.
 */
export function matchesChip(row: LibraryRow, chip: TypeChip): boolean {
  if (chip === "all") return true;
  if (isFolderRow(row)) return chip !== "page";
  return rowFormat(row) === chip;
}

/**
 * The translation key for the viewer's level on a row (the "My access"
 * column), or null when the row carries none (a source row, an older server, a
 * level this client does not know). A display mapping, not `rowLevel()`, which
 * reads an unknown level as view to keep commands hidden. The words match
 * `documents.share.level_*`; "comment" is mapped ahead of the server sending it.
 */
export function rowAccessLabelKey(row: LibraryRow): string | null {
  if (row.type !== "document") return null;
  // Widened: the server may send levels this client's type does not list yet.
  const level: string | null | undefined = row.doc.my_level;
  switch (level) {
    case "view":
    case "comment":
    case "edit":
    case "manage":
      return `documents.home.access.${level}`;
    default:
      return null;
  }
}

/** The translation key for a row's visibility, or null when it carries none this client knows. */
export function rowVisibilityLabelKey(row: LibraryRow): string | null {
  if (row.type !== "document") return null;
  const visibility: string | null | undefined = row.doc.visibility;
  switch (visibility) {
    case "workspace":
    case "restricted":
      return `documents.home.visibility.${visibility}`;
    default:
      return null;
  }
}

/**
 * The access filter over rows the server did not narrow, AND-ed with the
 * type chip: document lists send `access` to the server (the trash only ever
 * `restricted`); this predicate remains for merged source rows, the starred
 * view and the sources view. An unknown level never matches "I manage" / "I
 * can edit"; a source row has neither a level nor a visibility, so only
 * "all" keeps it.
 */
export function matchesAccess(row: LibraryRow, filter: AccessFilter): boolean {
  if (filter === "all") return true;
  if (row.type !== "document") return false;
  switch (filter) {
    case "manage":
      return row.doc.my_level === "manage";
    case "edit":
      return row.doc.my_level === "edit" || row.doc.my_level === "manage";
    case "restricted":
      return row.doc.visibility === "restricted";
    default:
      return true;
  }
}

/** Newest first; a row with no usable date sinks to the end. */
export function byUpdatedDesc(a: LibraryRow, b: LibraryRow): number {
  const ta = Date.parse(rowUpdatedAt(a));
  const tb = Date.parse(rowUpdatedAt(b));
  return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
}

const viCollator = new Intl.Collator("vi");

/**
 * Folder contents ordering (FD-08): folders always precede documents in both
 * sorts; within each kind rows sort by Vietnamese title collation (A→Z, "Ă"
 * after "A") or by updated timestamp (newest first).
 */
export function sortFolderRows(rows: LibraryRow[], sort: FolderSort): LibraryRow[] {
  return [...rows].sort((a, b) => {
    const fa = isFolderRow(a);
    const fb = isFolderRow(b);
    if (fa !== fb) return fa ? -1 : 1;
    if (sort === "name") return viCollator.compare(rowTitle(a), rowTitle(b));
    return byUpdatedDesc(a, b);
  });
}

function isFolderSort(value: unknown): value is FolderSort {
  return value === "name" || value === "updated";
}

export function folderSortStorageKey(userId: string): string {
  return `${FOLDER_SORT_STORAGE_KEY}:${userId}`;
}

/** Reads the viewer's folder sort choice from the core StorageAdapter; falls back safely when missing or throwing. */
export function readFolderSort(
  userId: string | null | undefined,
  storage: Pick<StorageAdapter, "getItem"> | null | undefined = defaultStorage,
): FolderSort {
  if (!userId || !storage) return DEFAULT_FOLDER_SORT;
  try {
    const raw = storage.getItem(folderSortStorageKey(userId));
    return isFolderSort(raw) ? raw : DEFAULT_FOLDER_SORT;
  } catch {
    return DEFAULT_FOLDER_SORT;
  }
}

/** Persists the viewer's folder sort choice under one shared key for all folders; ignores storage failures. */
export function writeFolderSort(
  userId: string | null | undefined,
  sort: FolderSort,
  storage: Pick<StorageAdapter, "setItem"> | null | undefined = defaultStorage,
): void {
  if (!userId || !storage) return;
  try {
    storage.setItem(folderSortStorageKey(userId), sort);
  } catch {
    // Storage unavailable or blocked: keep the in-memory selection for this session.
  }
}

function timeOf(row: LibraryRow): number {
  const time = Date.parse(rowUpdatedAt(row));
  return Number.isNaN(time) ? 0 : time;
}

/**
 * The home root's two independently paged lists (workspace documents, files
 * from other modules) as one newest-first table. A row is shown only when it is
 * at least as new as the oldest row loaded from every list that still has
 * pages: the next page of either list can then only add rows below the ones on
 * screen, so "Load more" never slots a row above what the user already sees.
 * A list that is exhausted (or empty) sets no bound.
 */
export function mergeNewestFirst(
  docs: LibraryRow[],
  sources: LibraryRow[],
  more: { docs: boolean; sources: boolean },
): LibraryRow[] {
  const oldest = (rows: LibraryRow[], paged: boolean): number =>
    paged && rows.length > 0 ? Math.min(...rows.map(timeOf)) : Number.NEGATIVE_INFINITY;
  const cutoff = Math.max(oldest(docs, more.docs), oldest(sources, more.sources));
  return [...docs, ...sources].filter((row) => timeOf(row) >= cutoff).sort(byUpdatedDesc);
}

export interface FolderInfo {
  id: string;
  title: string;
  parentId: string | null;
  kind: string;
  systemKind?: string | null;
}

/** Every tree node by id, so a row's folder path is a walk up parent ids. */
export function indexTree(nodes: DocumentTreeNode[], into = new Map<string, FolderInfo>()): Map<string, FolderInfo> {
  for (const node of nodes) {
    into.set(node.id, { id: node.id, title: node.title, parentId: node.parent_id ?? null, kind: node.kind, systemKind: node.system_kind ?? null });
    indexTree(node.children, into);
  }
  return into;
}

/** The folders above a document, outermost first (pages in between are skipped). */
export function folderPath(index: Map<string, FolderInfo>, parentId: string | null | undefined): FolderInfo[] {
  const path: FolderInfo[] = [];
  const seen = new Set<string>();
  let id = parentId ?? null;
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = index.get(id);
    if (!node) break;
    if (node.kind === "folder") path.unshift(node);
    id = node.parentId;
  }
  return path;
}

export interface RowGroup {
  /** Stable id; also the translation hint for the built-in groups. */
  key: string;
  /** A user-visible title the server sent (a folder path); built-in groups leave it empty. */
  title: string;
  rows: LibraryRow[];
}

/**
 * Groups in first-seen order of the (already sorted) rows, with `folders`
 * first under "group by folder". Built-in keys are `folders`, `unfiled` (no
 * folder), `origin:<origin>` and `type:<format>`; the view translates them. A
 * source row has no folder in the workspace tree, so under "group by folder"
 * it joins the group of its module.
 */
export function groupRows(rows: LibraryRow[], groupBy: GroupBy, index: Map<string, FolderInfo>, myFolderLabel?: string): RowGroup[] {
  if (groupBy === "none") return [{ key: "all", title: "", rows }];
  const groups = new Map<string, RowGroup>();
  const add = (key: string, title: string, row: LibraryRow) => {
    const group = groups.get(key) ?? { key, title, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  };
  for (const row of rows) {
    if (groupBy === "source") add(`origin:${rowOrigin(row)}`, "", row);
    else if (groupBy === "type") add(`type:${isFolderRow(row) ? "folder" : rowFormat(row)}`, "", row);
    else if (row.type === "source") add(`origin:${rowOrigin(row)}`, "", row);
    else {
      const path = folderPath(index, row.doc.parent_id);
      const last = path.at(-1);
      if (last) {
        add(
          `folder:${last.id}`,
          path.map((node) => (isMyFolder({ system_kind: node.systemKind }) && myFolderLabel ? myFolderLabel : node.title)).join(" / "),
          row,
        );
      } else if (isFolderRow(row)) add("folders", "", row);
      else add("unfiled", "", row);
    }
  }
  const folders = groups.get("folders");
  if (!folders) return [...groups.values()];
  groups.delete("folders");
  return [folders, ...groups.values()];
}

/** Human-readable size: "318 KB", "1.2 MB" (locale decimal mark). */
export function formatBytes(bytes: number | null | undefined, locale: string): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(locale || undefined, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}
