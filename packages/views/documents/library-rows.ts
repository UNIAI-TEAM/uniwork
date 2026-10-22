import { DOCUMENT_FILE_FORMATS, type DocumentList } from "@uniwork/core/types/document";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { documentIconFormat, fileExtension } from "./document-type-icon";

// The library table's rows as one model: a workspace document or a file that
// lives in another module (chat, task, meeting, email) and is listed here as
// a link (sorting lives in library-sort.ts, the date groups in
// doclist/date-groups.ts); nothing here invents a row or a count. The type
// chip went server-side with UNI-1868 (the document lists take
// `format`/`kind` and key them), so `matchesChip` remains only for what the
// server cannot filter: merged source rows and the lists loaded in full.
export type DocumentSummaryRow = DocumentList["documents"][number];

export type LibraryRow =
  | { type: "document"; id: string; doc: DocumentSummaryRow }
  | { type: "source"; id: string; source: DocumentSourceFile };

/** The filter bar's type chips, in their order on every screen (UNI-2045 W10; `txt` is SV-7). */
export const TYPE_CHIPS = ["all", "page", "docx", "xlsx", "pptx", "pdf", "md", "html", "txt"] as const;
export type TypeChip = (typeof TYPE_CHIPS)[number];
/** One pick of the Loại multi-select; its Tất cả is "no pick", never a value. */
export type DocumentTypeFilter = Exclude<TypeChip, "all">;

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
 * the server cannot filter: merged source files, an open folder and the
 * starred view (both loaded in full).
 */
export function matchesChip(row: LibraryRow, chip: TypeChip): boolean {
  if (chip === "all") return true;
  if (isFolderRow(row)) return chip !== "page";
  return rowFormat(row) === chip;
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
