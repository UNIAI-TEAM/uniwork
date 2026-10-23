import { fileExtension } from "./document-type-icon";

/**
 * The name a file is saved under. The stored file's own name when the document carries it; a list
 * row has none, so a title without an extension takes the row's format (a title that has one stays).
 */
export function documentDownloadName(doc: { title: string; format?: string | null; file?: { filename: string } | null }): string {
  if (doc.file?.filename) return doc.file.filename;
  if (!doc.format || fileExtension(doc.title)) return doc.title;
  return `${doc.title}.${doc.format.toLowerCase()}`;
}
