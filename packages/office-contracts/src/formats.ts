import { z } from "zod";

// The format vocabulary the engine boundary speaks (engine-contract.md §4.2).
// Upstream may implement more; the boundary only accepts these. G2-07b extends
// the editable six with the Q7 conversion *source* formats: `xls` (BIFF8) and
// `odt` (ODF text) are accepted for capability and for `convert` jobs (their
// only bound target is an OOXML copy); open/edit/serialize stay not-bound for
// them, so an editor can never open them in place.
export const officeFormats = ["docx", "xlsx", "pptx", "pdf", "md", "html", "xls", "odt"] as const;
export const officeFormatSchema = z.enum(officeFormats);
export type OfficeFormat = (typeof officeFormats)[number];
export function isOfficeFormat(value: string): value is OfficeFormat {
  return (officeFormats as readonly string[]).includes(value);
}
