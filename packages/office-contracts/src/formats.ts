import { z } from "zod";

// The format vocabulary the engine boundary speaks (engine-contract.md §4.2).
// Upstream may implement more; the boundary only accepts these.
export const officeFormats = ["docx", "xlsx", "pptx", "pdf", "md", "html"] as const;
export const officeFormatSchema = z.enum(officeFormats);
export type OfficeFormat = (typeof officeFormats)[number];
export function isOfficeFormat(value: string): value is OfficeFormat {
  return (officeFormats as readonly string[]).includes(value);
}
