import { OFFICE_DOCS_WEB_FLAG } from "./format-flags";
import type { Capabilities, OfficeModule } from "./docs-frame-protocol";

/**
 * The genoffice web modules (UNI-1013 docs, UNI-1014 pdf/markdown/html,
 * UNI-1015 slides, UNI-1016 sheets): one protocol, one frame host, one row
 * here per module. The server derives a token's module from the stored
 * format (`server/internal/service/office_frame_module.go`); this table must
 * name the same flag and format for each.
 */

/**
 * What the host may grant a module's frame, before readonly and the API narrow
 * it. An absent key is off; a module-specific key the protocol adds later is
 * passed through as granted here.
 */
export type OfficeModuleGrant = Capabilities;

export interface OfficeModuleSpec {
  /** Organization-scoped flag that turns the module's frame on (default off). */
  flag: string;
  /** `detectDocumentFormat` id of the documents this module opens. */
  format: string;
  /** Mime type of the bytes a save or save-as uploads. */
  mimeType: string;
  /** File extension a save-as appends. */
  extension: string;
  /**
   * Capability grants. Only Docs is filled in; a module's worker turns its
   * own on once the frame implements them (off = the frame hides the action).
   */
  grant: OfficeModuleGrant;
}

const NONE: OfficeModuleGrant = {};

const OFFICE_MODULE_SPECS: Readonly<Record<OfficeModule, OfficeModuleSpec>> = {
  docs: {
    flag: OFFICE_DOCS_WEB_FLAG, format: "docx", extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    grant: { save: true, saveAs: true, recents: true, print: true, exportPdf: true, exportHtml: false, attachments: true, images: true },
  },
  pdf: { flag: "office_pdf_web", format: "pdf", extension: "pdf", mimeType: "application/pdf", grant: NONE },
  markdown: { flag: "office_markdown_web", format: "md", extension: "md", mimeType: "text/markdown", grant: NONE },
  html: { flag: "office_html_web", format: "html", extension: "html", mimeType: "text/html", grant: NONE },
  slides: {
    flag: "office_slides_web", format: "pptx", extension: "pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", grant: NONE,
  },
  sheets: {
    flag: "office_sheets_web", format: "xlsx", extension: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", grant: NONE,
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
