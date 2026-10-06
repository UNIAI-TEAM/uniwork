import table from "./document-formats.json";

/** The ONE desktop document-format table. Every format-scoped decision the
 * host makes — extension filters, dialog and OS-association metadata, MIME
 * types, untitled naming, the engine build stamp on save receipts — reads this
 * table (or the accessors below), so adding a format is a table edit rather
 * than a new branch. The packaging scripts read the same JSON by path. */
export interface DesktopDocumentFormatSpec {
  readonly extensions: readonly string[];
  readonly mimeTypes: readonly string[];
  readonly dialogFilterName: string;
  readonly associationName: string;
  readonly untitledName: string;
  /** Present when the untitled tab title has a translated label; absent formats
   * fall back to the table's untitled file name. */
  readonly untitledLocaleKey?: string;
  readonly engineBuild: string;
}

export type DesktopDocumentFormat = keyof typeof table.formats;

export const DESKTOP_DOCUMENT_FORMATS = Object.keys(table.formats) as DesktopDocumentFormat[];
export const DEFAULT_DESKTOP_DOCUMENT_FORMAT = table.defaultFormat as DesktopDocumentFormat;

export function desktopDocumentFormatSpec(format: DesktopDocumentFormat): DesktopDocumentFormatSpec {
  return table.formats[format] as DesktopDocumentFormatSpec;
}

export function isDesktopDocumentFormat(value: string): value is DesktopDocumentFormat {
  return (DESKTOP_DOCUMENT_FORMATS as readonly string[]).includes(value);
}

/** Case-insensitive extension match on the final path/file name segment. */
export function desktopDocumentFormatForName(name: string): DesktopDocumentFormat | undefined {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  const extension = match?.[1]?.toLowerCase();
  if (!extension) return undefined;
  return DESKTOP_DOCUMENT_FORMATS.find((format) => desktopDocumentFormatSpec(format).extensions.includes(extension));
}

/** MIME parameters are ignored (`application/pdf; charset=binary`). */
export function desktopDocumentFormatForMime(mime: string): DesktopDocumentFormat | undefined {
  const normalized = mime.split(";", 1)[0]?.trim().toLowerCase();
  if (!normalized) return undefined;
  return DESKTOP_DOCUMENT_FORMATS.find((format) => desktopDocumentFormatSpec(format).mimeTypes.some((candidate) => candidate.toLowerCase() === normalized));
}

export function desktopMimeTypeForFormat(format: DesktopDocumentFormat): string {
  return desktopDocumentFormatSpec(format).mimeTypes[0]!;
}

export function desktopExtensionsForFormat(format: DesktopDocumentFormat): readonly string[] {
  return desktopDocumentFormatSpec(format).extensions;
}

export function desktopUntitledName(format: DesktopDocumentFormat): string {
  return desktopDocumentFormatSpec(format).untitledName;
}

export function desktopEngineBuild(format: DesktopDocumentFormat): string {
  return desktopDocumentFormatSpec(format).engineBuild;
}

export function desktopDocumentMimeTypes(): string[] {
  return DESKTOP_DOCUMENT_FORMATS.flatMap((format) => [...desktopDocumentFormatSpec(format).mimeTypes]);
}

/** Dialog filters for open/save pickers: one named filter per format, in table
 * order. The caller appends the catch-all entry the open dialog wants. */
export function desktopDialogFilters(): { name: string; extensions: string[] }[] {
  return DESKTOP_DOCUMENT_FORMATS.map((format) => ({ name: desktopDocumentFormatSpec(format).dialogFilterName, extensions: [...desktopExtensionsForFormat(format)] }));
}
