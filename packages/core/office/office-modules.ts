import { OFFICE_DOCS_WEB_FLAG } from "./format-flags";
import type { Capabilities, OfficeModule } from "./docs-frame-protocol";

/**
 * The genoffice web modules (UNI-1013 docs, UNI-1014 pdf/markdown/html,
 * UNI-1015 slides, UNI-1016 sheets): one protocol, one frame host, one row
 * here per module. The server derives a token's module from the stored
 * format (`server/internal/service/office_frame_module.go`); this table must
 * name the same flag, format and size cap for each
 * (`scripts/office-modules.test.mjs` fails when they differ).
 */

/**
 * What the host may grant a module's frame, before readonly and the API narrow
 * it. An absent key is off; a module-specific key the protocol adds later is
 * passed through as granted here.
 */
export type OfficeModuleGrant = Capabilities;

export interface OfficeModuleSpec {
  /** Organization-scoped flag that turns the module's frame on (default on server-side; an override turns it off). */
  flag: string;
  /** `detectDocumentFormat` id of the documents this module opens. */
  format: string;
  /** Mime type of the bytes a save or save-as uploads. */
  mimeType: string;
  /** File extension a save-as appends. */
  extension: string;
  /**
   * Capability grants (off = the frame hides the action). Recents, file pick
   * and attachments stay off for every module but Docs, and only Docs has the
   * server PDF export. Markdown and HTML grant images (UNI-1232): their open
   * carries `assets` (relative path -> signed same-origin URL) and a pasted
   * picture uploads as a document asset through `api.images.upload`.
   */
  grant: OfficeModuleGrant;
  /**
   * The module's frame has AI panels (genoffice AI members on its preload
   * globals; all six modules today). The host grants `ai` (and the cloud tool
   * keys) only here and only as far as the minted token's AI grant allows
   * (CONTRACT C16); a module without AI never gets the keys.
   */
  ai?: boolean;
  /**
   * Web draft recovery (CONTRACT C18): the host hands the frame the session's
   * draft key and the "<userId>:<documentId>" scope in `init`, and the frame
   * keeps encrypted copies of unsaved edits in IndexedDB. Off = no `recovery`.
   */
  recovery?: boolean;
}

const EDIT_PRINT: OfficeModuleGrant = { save: true, saveAs: true, print: true };
const EDIT_PRINT_PDF: OfficeModuleGrant = { save: true, saveAs: true, print: true, exportPdf: true };
const EDIT_PRINT_HTML_IMAGES: OfficeModuleGrant = { save: true, saveAs: true, print: true, exportHtml: true, images: true };

const OFFICE_MODULE_SPECS: Readonly<Record<OfficeModule, OfficeModuleSpec>> = {
  docs: {
    flag: OFFICE_DOCS_WEB_FLAG, format: "docx", extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    grant: { save: true, saveAs: true, saveCopy: true, recents: true, print: true, exportPdf: true, exportHtml: false, attachments: true, images: true },
    recovery: true, ai: true,
  },
  pdf: { flag: "office_pdf_web", format: "pdf", extension: "pdf", mimeType: "application/pdf", grant: EDIT_PRINT, recovery: true, ai: true },
  markdown: { flag: "office_markdown_web", format: "md", extension: "md", mimeType: "text/markdown", grant: EDIT_PRINT_HTML_IMAGES, recovery: true, ai: true },
  html: { flag: "office_html_web", format: "html", extension: "html", mimeType: "text/html", grant: EDIT_PRINT_HTML_IMAGES, recovery: true, ai: true },
  slides: {
    flag: "office_slides_web", format: "pptx", extension: "pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", grant: EDIT_PRINT_PDF, recovery: true, ai: true,
  },
  sheets: {
    flag: "office_sheets_web", format: "xlsx", extension: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", grant: EDIT_PRINT, recovery: true, ai: true,
  },
};

export function officeModuleSpec(module: OfficeModule): OfficeModuleSpec {
  return OFFICE_MODULE_SPECS[module];
}

/** The module that opens a `detectDocumentFormat` id; null for a format with no web module (xls, odt, …). */
export function officeModuleForFormat(format: string | null | undefined): OfficeModule | null {
  for (const [module, spec] of Object.entries(OFFICE_MODULE_SPECS) as [OfficeModule, OfficeModuleSpec][]) {
    if (spec.format === format) return module;
  }
  return null;
}

/** Same-origin URL of a pinned module frame build (served by the web app). */
export function officeFrameSrc(module: OfficeModule, version: string): string {
  return `/office-frame/${module}/${encodeURIComponent(version)}/index.html`;
}

export type LegacyOfficeFormat = "doc" | "xls" | "ppt";

export interface LegacyOfficeFormatInput {
  format?: string | null;
  name?: string | null;
  filename?: string | null;
  extension?: string | null;
  mime?: string | null;
  mime_type?: string | null;
}

const LEGACY_FORMAT_BY_EXTENSION: Readonly<Record<string, LegacyOfficeFormat>> = {
  doc: "doc",
  xls: "xls",
  ppt: "ppt",
};

const LEGACY_FORMAT_BY_MIME: Readonly<Record<string, LegacyOfficeFormat>> = {
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
};

function normalizedExtension(input: LegacyOfficeFormatInput): string {
  const explicit = input.extension?.trim().replace(/^\.+/, "").toLowerCase();
  if (explicit) return explicit;
  const rawName = (input.filename ?? input.name ?? "").trim();
  const dot = rawName.lastIndexOf(".");
  return dot > 0 && dot < rawName.length - 1 ? rawName.slice(dot + 1).toLowerCase() : "";
}

/**
 * Resolves the legacy binary Office format (`doc` | `xls` | `ppt`) for a file by
 * its extension (which wins when present so a double-extension name like
 * `a.doc.pdf` stays `.pdf`) or its MIME type (`application/msword`,
 * `application/vnd.ms-excel`, `application/vnd.ms-powerpoint`). Returns `null`
 * for OOXML (`.docx`/`.xlsx`/`.pptx`) and every other format.
 */
export function legacyOfficeFormat(input: LegacyOfficeFormatInput | null | undefined): LegacyOfficeFormat | null {
  if (!input) return null;
  const explicitFormat = input.format?.trim().toLowerCase();
  if (explicitFormat) {
    return Object.hasOwn(LEGACY_FORMAT_BY_EXTENSION, explicitFormat) ? LEGACY_FORMAT_BY_EXTENSION[explicitFormat]! : null;
  }
  const ext = normalizedExtension(input);
  if (ext) {
    return Object.hasOwn(LEGACY_FORMAT_BY_EXTENSION, ext) ? LEGACY_FORMAT_BY_EXTENSION[ext]! : null;
  }
  const rawMime = (input.mime ?? input.mime_type ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return Object.hasOwn(LEGACY_FORMAT_BY_MIME, rawMime) ? LEGACY_FORMAT_BY_MIME[rawMime]! : null;
}

/** True for legacy binary Office formats (`.doc`, `.xls`, `.ppt`) by extension or MIME type. */
export function isLegacyOfficeFormat(input: LegacyOfficeFormatInput | null | undefined): boolean {
  return legacyOfficeFormat(input) !== null;
}
