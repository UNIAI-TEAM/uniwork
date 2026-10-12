import type { DocumentList, DocumentTreeNode } from "@uniwork/core/types/document";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { documentIconFormat, fileExtension } from "./document-type-icon";

// The library table's rows as one model: a workspace document or a file that
// lives in another module (chat, task, meeting, email) and is listed here as a
// link. Filtering by type chip and grouping are pure functions of the rows the
// server returned; nothing here invents a row or a count.

export type DocumentSummaryRow = DocumentList["documents"][number];

export type LibraryRow =
  | { type: "document"; id: string; doc: DocumentSummaryRow }
  | { type: "source"; id: string; source: DocumentSourceFile };

export const TYPE_CHIPS = ["all", "page", "docx", "xlsx", "pptx", "pdf", "md", "html"] as const;
export type TypeChip = (typeof TYPE_CHIPS)[number];

export const GROUP_BY = ["folder", "source", "type", "none"] as const;
export type GroupBy = (typeof GROUP_BY)[number];

/** Where a row came from, for the Source column and "group by source". */
export type RowOrigin = "documents" | "chat" | "task" | "meeting" | "email" | "other";

export function documentRow(doc: DocumentSummaryRow): LibraryRow {
  return { type: "document", id: doc.id, doc };
}

export function sourceRow(source: DocumentSourceFile): LibraryRow {
  return { type: "source", id: `source:${source.id}`, source };
}

/** The format a row draws and filters by: page, folder, or the file extension. */
export function rowFormat(row: LibraryRow): string {
  if (row.type === "document") return documentIconFormat(row.doc.kind, row.doc.title);
  return row.source.extension?.toLowerCase() || fileExtension(row.source.name) || "file";
}

export function rowOrigin(row: LibraryRow): RowOrigin {
  if (row.type === "document") return "documents";
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

/**
 * The type chip keeps folders visible (they are how one gets to the files)
 * except under "Trang", which lists pages only.
 */
export function matchesChip(row: LibraryRow, chip: TypeChip): boolean {
  if (chip === "all") return true;
  if (isFolderRow(row)) return chip !== "page";
  return rowFormat(row) === chip;
}

/** Newest first; a row with no usable date sinks to the end. */
export function byUpdatedDesc(a: LibraryRow, b: LibraryRow): number {
  const ta = Date.parse(rowUpdatedAt(a));
  const tb = Date.parse(rowUpdatedAt(b));
  return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
}

export interface FolderInfo {
  id: string;
  title: string;
  parentId: string | null;
  kind: string;
}

/** Every tree node by id, so a row's folder path is a walk up parent ids. */
export function indexTree(nodes: DocumentTreeNode[], into = new Map<string, FolderInfo>()): Map<string, FolderInfo> {
  for (const node of nodes) {
    into.set(node.id, { id: node.id, title: node.title, parentId: node.parent_id ?? null, kind: node.kind });
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
 * Groups in first-seen order of the (already sorted) rows. Built-in keys are
 * `unfiled` (no folder), `origin:<origin>` and `type:<format>`; the view
 * translates them. A source row has no folder in the workspace tree, so under
 * "group by folder" it joins the group of its module.
 */
export function groupRows(rows: LibraryRow[], groupBy: GroupBy, index: Map<string, FolderInfo>): RowGroup[] {
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
      if (last) add(`folder:${last.id}`, path.map((node) => node.title).join(" / "), row);
      else add("unfiled", "", row);
    }
  }
  return [...groups.values()];
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
