// Reads a live conditional-format rule (Univer's inner rule object) for the
// rule manager: a description key + params for the row, and the preset-dialog
// values when the rule is one of the shapes the preset dialog can rebuild.

import type { XlsxCfPreset, XlsxCfStyleId } from "./cf-commands";
import { matchCfStyleId } from "./cf-commands";

export interface XlsxCfDescription {
  /** i18n key under `office.xlsx.conditionalFormat.manager.rules.*`. */
  key: string;
  params: Record<string, string>;
}

/** Values the preset dialog opens with when editing a rule. */
export interface XlsxCfEditable {
  preset: XlsxCfPreset;
  first: string;
  second: string;
  /** A preset format, or null when the rule keeps a format the presets lack. */
  styleId: XlsxCfStyleId | null;
  style: unknown;
}

const NUMBER_OPERATORS = [
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "equal",
  "notEqual",
  "between",
  "notBetween",
];
const TEXT_OPERATORS = ["containsText", "notContainsText", "beginsWith", "endsWith", "equal"];
const GENERIC_TYPES = ["dataBar", "colorScale", "iconSet"];

const asText = (value: unknown): string => (typeof value === "number" || typeof value === "string" ? String(value) : "");
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function pair(value: unknown): [unknown, unknown] {
  return Array.isArray(value) ? [value[0], value[1]] : [undefined, undefined];
}

export function describeCfRule(rule: Readonly<Record<string, unknown>>): XlsxCfDescription {
  const { type, subType, operator } = rule;
  if (type === "highlightCell") {
    if (subType === "number" && typeof operator === "string" && NUMBER_OPERATORS.includes(operator)) {
      const [min, max] = pair(rule.value);
      const two = operator === "between" || operator === "notBetween";
      return {
        key: `number.${operator}`,
        params: two ? { min: asText(min), max: asText(max) } : { value: asText(rule.value) },
      };
    }
    if (subType === "text" && typeof operator === "string" && TEXT_OPERATORS.includes(operator)) {
      return { key: `text.${operator}`, params: { value: asText(rule.value) } };
    }
    if (subType === "duplicateValues" || subType === "uniqueValues") return { key: subType, params: {} };
    if (subType === "formula") return { key: "formula", params: {} };
  }
  if (typeof type === "string" && GENERIC_TYPES.includes(type)) return { key: type, params: {} };
  return { key: "other", params: { type: asText(subType) || asText(type) || "?" } };
}

/** The preset-dialog values of a rule, or null when the preset dialog cannot
 *  rebuild it (any other type, operator or value shape). */
export function editableCfRule(rule: Readonly<Record<string, unknown>>): XlsxCfEditable | null {
  if (rule.type !== "highlightCell") return null;
  const styleId = matchCfStyleId(rule.style);
  const base = { second: "", styleId, style: rule.style };
  const { subType, operator, value } = rule;
  if (subType === "duplicateValues" || subType === "uniqueValues") return { ...base, preset: subType, first: "" };
  if (subType === "number" && (operator === "greaterThan" || operator === "lessThan") && finite(value)) {
    return { ...base, preset: operator, first: String(value) };
  }
  if (subType === "number" && operator === "between") {
    const [min, max] = pair(value);
    if (finite(min) && finite(max)) return { ...base, preset: "between", first: String(min), second: String(max) };
    return null;
  }
  if (subType === "text" && operator === "containsText" && typeof value === "string") {
    return { ...base, preset: "containsText", first: value };
  }
  return null;
}
