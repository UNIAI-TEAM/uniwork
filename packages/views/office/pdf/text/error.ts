import type { useTranslation } from "react-i18next";

type TFunction = ReturnType<typeof useTranslation>["t"];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringField(source: Record<string, unknown> | null, key: string): string {
  const value = source?.[key];
  return typeof value === "string" ? value : "";
}

function fontNames(source: Record<string, unknown> | null): string[] {
  const values = ["font", "fonts", "font_name", "fontName", "missing"].flatMap((key) => {
    const value = source?.[key];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
    return [];
  });
  return [...new Set(values)];
}

/** Convert the engine's closed typed error into safe localized copy.
 *
 * Error extras differ by shape: an `EngineBoundaryError` instance keeps
 * `reason`/`font` under `.fields` while its `toJSON()` wire body spreads them
 * flat, so both levels are read here. */
export function pdfTextErrorMessage(error: unknown, t: TFunction): string {
  const wire = record(error);
  const fields = record(wire?.fields);
  const code = stringField(wire, "code");
  const reason = stringField(fields, "reason") || stringField(wire, "reason");
  if (code === "object_unavailable") return t("office.pdf.errors.objectUnavailable");
  const signal = `${code} ${reason}`.toLowerCase();
  if (signal.includes("font") || signal.includes("fallback")) {
    const names = [...new Set([...fontNames(fields), ...fontNames(wire)])];
    return names.length > 0
      ? t("office.pdf.fonts.missing", { fonts: names.join(", ") })
      : t("office.pdf.fonts.missingUnknown");
  }
  return t("office.pdf.errors.editFailed");
}
