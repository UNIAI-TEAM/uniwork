/**
 * Per-format Office feature flags (UNI-941). `office_engine` is the master
 * switch; a format is editable only when it AND the format's own flag are on.
 * The server declares every key below in `server/internal/featureflags/keys.go`
 * (default on), so an operator can turn one format off without the rest.
 */
export const OFFICE_ENGINE_FLAG = "office_engine";

const OFFICE_FORMAT_FLAGS: Readonly<Record<string, string>> = {
  docx: "office_docx",
  xlsx: "office_xlsx",
  pptx: "office_pptx",
  pdf: "office_pdf",
  md: "office_markdown",
  html: "office_html",
};

/** Flag key for an Office format id; null for a format that has none. */
export function officeFormatFlagKey(format: string | null | undefined): string | null {
  if (!format) return null;
  return Object.hasOwn(OFFICE_FORMAT_FLAGS, format) ? OFFICE_FORMAT_FLAGS[format]! : null;
}
