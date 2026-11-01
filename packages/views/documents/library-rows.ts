import { DOCUMENT_FILE_FORMATS, type DocumentList } from "@uniwork/core/types/document";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { documentIconFormat, fileExtension } from "./document-type-icon";

// The library table's rows as one model: a workspace document or a file that
// lives in another module (chat, task, meeting, email) and is listed here as
// a link (sorting lives in library-sort.ts, the date groups in
// doclist/date-groups.ts); nothing here invents a row or a count. The Type
// picks are the repeated `type` query parameter of every list, the sources
// route included (UNI-2113): the server filters, no row is narrowed here.
export type DocumentSummaryRow = DocumentList["documents"][number];

export type LibraryRow =
  | { type: "document"; id: string; doc: DocumentSummaryRow }
  | { type: "source"; id: string; source: DocumentSourceFile };

/**
 * Every pickable type of the Loại multi-select, in its order on every screen
 * (UNI-2045 W10; `txt` is SV-7). Tất cả is "no pick", never a value; the values
 * are the server's `type` values (`page` or a file format).
 */
export const TYPE_FILTERS = ["page", "docx", "xlsx", "pptx", "pdf", "md", "html", "txt"] as const;
export type DocumentTypeFilter = (typeof TYPE_FILTERS)[number];

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
  if (row.source.kind === "page") return "page";
  return row.source.extension?.toLowerCase() || fileExtension(row.source.name) || "file";
}

/** A file document's or a source file's size; pages, folders and unknown sizes say nothing. */
export function rowSizeBytes(row: LibraryRow): number | null {
  if (row.type === "source") {
    if (row.source.kind === "page") return null;
    return row.source.size_bytes ?? null;
  }
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

/** The translation key for a row's visibility, or null when it carries none this client knows. */
export function rowVisibilityLabelKey(row: LibraryRow): string | null {
  if (row.type !== "document") return null;
  const visibility: string | null | undefined = row.doc.visibility;
  switch (visibility) {
    case "workspace":
      return "documents.scope.workspace";
    case "restricted":
      return "documents.scope.private";
    default:
      return null;
  }
}

export interface RowGroup {
  /** "all" for a flat list, else the date group's id (doclist/groups.ts). */
  key: string;
  rows: LibraryRow[];
}
