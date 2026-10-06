// Reads a live data-validation rule (Univer's rule without ranges and id) for
// the rule manager: a description for the row, and the dialog form when the
// dialog can rebuild the rule.

import {
  errorStyleOfCode,
  isRealIsoDate,
  isTwoValueOperator,
  parsePlainDecimal,
  XLSX_DV_EMPTY_FORM,
  XLSX_DV_OPERATORS,
  XLSX_DV_TYPES,
  type XlsxDvErrorStyle,
  type XlsxDvForm,
  type XlsxDvOperator,
  type XlsxDvType,
} from "./dv-commands";

export interface XlsxDvDescription {
  /** i18n key under `office.xlsx.dataValidation.manager.rules.*`. */
  key: "list" | "value" | "range" | "other";
  /** `typeKey` / `operatorKey` name `types.*` / `operators.*` entries. */
  typeKey: string | null;
  operatorKey: string | null;
  params: Record<string, string>;
  errorStyle: XlsxDvErrorStyle;
}

const asText = (value: unknown): string => (typeof value === "number" || typeof value === "string" ? String(value) : "");
const dvType = (value: unknown): XlsxDvType | null => XLSX_DV_TYPES.find((type) => type === value) ?? null;
const dvOperator = (value: unknown): XlsxDvOperator | null => XLSX_DV_OPERATORS.find((operator) => operator === value) ?? null;

export function describeDvRule(rule: Readonly<Record<string, unknown>>): XlsxDvDescription {
  const errorStyle = errorStyleOfCode(rule.errorStyle);
  const type = dvType(rule.type);
  if (type === "list") {
    return { key: "list", typeKey: "list", operatorKey: null, params: { items: asText(rule.formula1) }, errorStyle };
  }
  if (type) {
    const operator = dvOperator(rule.operator) ?? "between";
    const two = isTwoValueOperator(operator);
    return {
      key: two ? "range" : "value",
      typeKey: type,
      operatorKey: operator,
      params: two
        ? { min: asText(rule.formula1), max: asText(rule.formula2) }
        : { value: asText(rule.formula1) },
      errorStyle,
    };
  }
  return { key: "other", typeKey: null, operatorKey: null, params: { type: asText(rule.type) || "?" }, errorStyle };
}

/** The dialog form for a rule the dialog can rebuild, or null (other types,
 *  range-based lists, values the dialog would refuse). */
export function editableDvForm(rule: Readonly<Record<string, unknown>>): XlsxDvForm | null {
  const type = dvType(rule.type);
  if (!type || typeof rule.formula1 !== "string") return null;
  const base: XlsxDvForm = {
    ...XLSX_DV_EMPTY_FORM,
    type,
    errorTitle: asText(rule.errorTitle),
    error: asText(rule.error),
    errorStyle: errorStyleOfCode(rule.errorStyle),
  };
  if (type === "list") {
    return rule.formula1.startsWith("=") || rule.formula1.includes('"') ? null : { ...base, value1: rule.formula1 };
  }
  const operator = rule.operator === undefined ? "between" : dvOperator(rule.operator);
  if (!operator) return null;
  const formula2 = typeof rule.formula2 === "string" ? rule.formula2 : "";
  const valid = (raw: string) => (type === "date" ? isRealIsoDate(raw) : parsePlainDecimal(raw) !== null);
  if (!valid(rule.formula1)) return null;
  if (isTwoValueOperator(operator) && !valid(formula2)) return null;
  return { ...base, operator, value1: rule.formula1, value2: isTwoValueOperator(operator) ? formula2 : "" };
}
