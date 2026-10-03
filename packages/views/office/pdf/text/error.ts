import type { TFunction } from "i18next";
import type { PdfTextOperationError } from "./types";

function asError(value: unknown): PdfTextOperationError {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    fields: record.fields && typeof record.fields === "object" ? record.fields as Record<string, unknown> : undefined,
  };
}

function strings(fields: Record<string, unknown> | undefined): string[] {
  if (!fields) return [];
  const values = [fields.font, fields.font_name, fields.fontName, fields.missing, fields.fonts];
  return values.flatMap((value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : typeof value === "string" ? [value] : []);
}

/** Convert the engine's closed typed error into safe localized copy. */
export function pdfTextErrorMessage(error: unknown, t: TFunction): string {
  const typed = asError(error);
  const signal = `${typed.code ?? ""} ${typed.reason ?? ""}`.toLowerCase();
  if (signal.includes("font") || signal.includes("fallback")) {
    const names = strings(typed.fields);
    return t("office.pdf.fonts.missing", { fonts: names.length ? names.join(", ") : t("office.pdf.errors.editFailed") });
  }
  return t("office.pdf.errors.editFailed");
}
