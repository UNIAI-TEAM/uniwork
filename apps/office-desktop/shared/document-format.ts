import { z } from "zod";

/** The document formats the desktop host carries today. This union is the ONE
 *  format seam: IPC schemas, library entries, tabs, open/pick/drop/argv and the
 *  package file associations all read it, so adding a format (pptx, UNI-927) is
 *  one entry here plus its editor mapping - never another sweep. */
export const desktopDocumentFormats = ["docx", "xlsx"] as const;
export type DesktopDocumentFormat = (typeof desktopDocumentFormats)[number];
export const desktopDocumentFormatSchema = z.enum(desktopDocumentFormats);

/** Formats a local (on-device) file may open into today. C1a mounts the shared
 *  editor for cloud documents only; the bundled local engine (C1b) widens this
 *  list without touching any other site. */
export const desktopLocalDocumentFormats = ["docx"] as const;
export type DesktopLocalDocumentFormat = (typeof desktopLocalDocumentFormats)[number];

export type DesktopFormatProfile = Readonly<{
  format: DesktopDocumentFormat;
  /** Lowercase extension without the dot. */
  extension: string;
  mimeType: string;
  /** File-association label shown by the OS (Windows/macOS/Linux). */
  associationName: string;
  /** Locally editable today; C1b flips xlsx to true. */
  local: boolean;
}>;

/** The single format table. Order is the file-association order. */
export const DESKTOP_FORMAT_PROFILES: readonly DesktopFormatProfile[] = [
  {
    format: "docx",
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    associationName: "Word document",
    local: true,
  },
  {
    format: "xlsx",
    extension: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    associationName: "Excel spreadsheet",
    local: false,
  },
];

const mimeTypes = DESKTOP_FORMAT_PROFILES.map((profile) => profile.mimeType) as [string, ...string[]];
/** The MIME vocabulary a document response may carry. */
export const desktopFormatMimeTypeSchema = z.enum(mimeTypes);

export function desktopFormatProfile(format: DesktopDocumentFormat): DesktopFormatProfile {
  const profile = DESKTOP_FORMAT_PROFILES.find((candidate) => candidate.format === format);
  if (!profile) throw new Error(`unknown desktop document format: ${format}`);
  return profile;
}

export function mimeTypeForFormat(format: DesktopDocumentFormat): string {
  return desktopFormatProfile(format).mimeType;
}

export function extensionForFormat(format: DesktopDocumentFormat): string {
  return desktopFormatProfile(format).extension;
}

export function isDesktopDocumentFormat(value: string): value is DesktopDocumentFormat {
  return (desktopDocumentFormats as readonly string[]).includes(value);
}

export function isLocalDocumentFormat(format: DesktopDocumentFormat): format is DesktopLocalDocumentFormat {
  return (desktopLocalDocumentFormats as readonly string[]).includes(format);
}

/** Resolve a filename to a carried format by its extension (open/pick/drop/
 *  argv all funnel through here). Unknown extensions answer undefined. */
export function formatFromFilename(name: string): DesktopDocumentFormat | undefined {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return undefined;
  const extension = name.slice(dot + 1).toLowerCase();
  return DESKTOP_FORMAT_PROFILES.find((profile) => profile.extension === extension)?.format;
}

/** Resolve a server document to a carried format: the MIME wins when it names
 *  a known format, otherwise the filename extension (list rows omit `file`). */
export function formatFromMimeType(mimeType: string | null | undefined, filename?: string): DesktopDocumentFormat | undefined {
  const mime = mimeType?.trim().toLowerCase();
  if (mime) {
    const byMime = DESKTOP_FORMAT_PROFILES.find((profile) => profile.mimeType.toLowerCase() === mime);
    if (byMime) return byMime.format;
  }
  return filename ? formatFromFilename(filename) : undefined;
}
