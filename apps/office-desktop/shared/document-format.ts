import { z } from "zod";

/**
 * The OOXML formats the desktop host accepts, in one place so the wire schema
 * (shared/ipc.ts), the pick/open guards (main/ipc.ts, electron-main.ts) and the
 * packaging file associations cannot drift apart. The vocabulary is closed: an
 * unknown extension is refused instead of reaching a host editor.
 */
export const DESKTOP_DOCUMENT_FORMATS = ["docx", "xlsx", "pptx"] as const;
export type DesktopDocumentFormat = (typeof DESKTOP_DOCUMENT_FORMATS)[number];

/** The media type each format's container declares. */
export const DESKTOP_FORMAT_MIME_TYPES: Readonly<Record<DesktopDocumentFormat, string>> = Object.freeze({
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
});

export const desktopDocumentFormatSchema = z.enum(DESKTOP_DOCUMENT_FORMATS);
export const desktopMimeTypeSchema = z.enum([
  DESKTOP_FORMAT_MIME_TYPES.docx,
  DESKTOP_FORMAT_MIME_TYPES.xlsx,
  DESKTOP_FORMAT_MIME_TYPES.pptx,
]);

/** Filename suffix -> format. Case-insensitive, extension-anchored; a name
 * without one of the three extensions is not a desktop document. */
export function desktopFormatOfName(name: string): DesktopDocumentFormat | undefined {
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  if (!match) return undefined;
  const extension = match[1]!.toLowerCase();
  return (DESKTOP_DOCUMENT_FORMATS as readonly string[]).includes(extension) ? (extension as DesktopDocumentFormat) : undefined;
}

/** True when a path or file name carries one of the accepted extensions. */
export function isDesktopDocumentName(name: string): boolean {
  return desktopFormatOfName(name) !== undefined;
}

/** Pick/open dialog filters for the three formats. */
/** Electron's FileFilter wants a mutable string[]; these factories keep the
 * extension list in sync with DESKTOP_DOCUMENT_FORMATS. */
export function desktopOpenFilters(): Array<{ name: string; extensions: string[] }> {
  return [{ name: "Office", extensions: [...DESKTOP_DOCUMENT_FORMATS] }, { name: "Files", extensions: ["*"] }];
}

export function desktopSaveFilters(): Array<{ name: string; extensions: string[] }> {
  return [{ name: "Office", extensions: [...DESKTOP_DOCUMENT_FORMATS] }];
}
