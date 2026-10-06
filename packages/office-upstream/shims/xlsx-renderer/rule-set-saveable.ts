import { cfRuleUnsaveableReason } from "../../upstream/packages/xlsx-gateway/src/gateway/xlsx-cf";

// ── CF/DV rule dry-run (X01) ───────────────────────────────────────────────
//
// Whether the gateway's declarative save can write one Univer rule. The policy
// runs it on a new rule; the capture runs it on every rule the loader installs
// from the file (review r2 M-B), so a loaded rule the save cannot re-serialize
// refuses its family instead of failing every later save.

/** The rule families the gateway serializer writes (xlsx-cf.ts / xlsx-dv.ts);
 *  `listMultiple` is Univer-only and fails the save, so it is refused here. */
const CF_RULE_TYPES = new Set(["highlightCell", "colorScale", "dataBar", "iconSet"]);
const DV_RULE_TYPES = new Set(["any", "whole", "decimal", "list", "date", "time", "textLength", "custom", "checkbox"]);
/** xlsx-dv.ts DV_OPERATORS and DV_ERROR_STYLE_NAMES (no dry-run export there). */
const DV_OPERATORS = new Set(["between", "notBetween", "equal", "notEqual", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"]);
const DV_ERROR_STYLES = new Set([0, 1, 2]);

/** A Univer DV rule (type, operator, error style) xlsx-dv.ts maps. */
export function dvRuleSaveable(rule: unknown): boolean {
  if (!rule || typeof rule !== "object") return false;
  const { type, operator, errorStyle } = rule as { type?: unknown; operator?: unknown; errorStyle?: unknown };
  if (typeof type !== "string" || !DV_RULE_TYPES.has(type)) return false;
  if (operator !== undefined && operator !== "" && (typeof operator !== "string" || !DV_OPERATORS.has(operator))) return false;
  return errorStyle === undefined || errorStyle === null || DV_ERROR_STYLES.has(Number(errorStyle));
}

/** The inner Univer CF rule object (`rule.rule`) the gateway's own serializer
 *  dry-run accepts (cfRuleUnsaveableReason, zero drift). */
export function cfRuleSaveable(inner: unknown): boolean {
  if (!inner || typeof inner !== "object") return false;
  const { type } = inner as { type?: unknown };
  return typeof type === "string" && CF_RULE_TYPES.has(type) &&
    cfRuleUnsaveableReason(inner as Record<string, unknown>) === null;
}
