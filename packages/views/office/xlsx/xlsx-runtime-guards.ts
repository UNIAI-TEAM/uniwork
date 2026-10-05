import type { XlsxRenderModel } from "@uniwork/office-engine/xlsx";

/** Deterministic JSON with sorted object keys, so two workbooks with the same
 *  content compare equal regardless of key insertion order. The web and
 *  desktop xlsx hosts both use it to prove a save snapshot still matches the
 *  pending op journal before spending an edit job. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

/** Required renderer fields: an older or misbehaving engine must fail clearly
 *  instead of silently mounting the legacy value-only table. Ported from the
 *  web xlsx runtime so desktop validates the open render model the same way. */
export function isRenderModel(value: unknown): value is XlsxRenderModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<XlsxRenderModel>;
  return Number.isSafeInteger(model.revision) && Number.isSafeInteger(model.activeTab) &&
    typeof model.date1904 === "boolean" && Array.isArray(model.styles) && Array.isArray(model.dxfStyles) &&
    [...model.styles, ...model.dxfStyles].every((style) => style !== null && typeof style === "object") &&
    Array.isArray(model.sheets) && model.sheets.length > 0 && model.sheets.every((sheet) =>
      sheet !== null && typeof sheet === "object" && typeof sheet.id === "string" && typeof sheet.name === "string" &&
      Number.isSafeInteger(sheet.rowCount) && sheet.rowCount > 0 && Number.isSafeInteger(sheet.columnCount) && sheet.columnCount > 0 &&
      sheet.cells !== null && typeof sheet.cells === "object" && !Array.isArray(sheet.cells) &&
      Array.isArray(sheet.merges) && Array.isArray(sheet.columnWidths) && Array.isArray(sheet.rowsMeta) && Array.isArray(sheet.hyperlinks));
}
