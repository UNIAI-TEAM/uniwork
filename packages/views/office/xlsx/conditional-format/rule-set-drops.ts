// X01 review r2 (M-A): the save-time backstop for CF/DV rule sets, client
// half. When a journalled rule-set snapshot still fails the gateway, the
// engine refuses the one-shot save job with a reason
//   "xlsx_rule_sets_dropped:" + JSON [["cf" | "dv", sheetName], ...]
// (packages/office-engine/src/xlsx/adapter-rule-sets.ts writes it, trimmed to
// whole entries). It reaches the web runtime as the job error reason and the
// desktop session inside the IPC error message. Both runtimes drop exactly
// the named rule-set ops from their pending list, remember the names for the
// notice, and fail the save with XLSX_RULE_SETS_DROPPED - a non-terminal code
// (packages/core/office/error-state.ts), so the next explicit Save re-runs the
// intent without them and every other edit is kept. Sheet names are user
// text: parsing is bounded and a malformed payload yields the generic notice.

export const XLSX_RULE_SETS_DROPPED = "xlsx_rule_sets_dropped";

const PREFIX = `${XLSX_RULE_SETS_DROPPED}:`;
/** The engine caps the reason at 300 characters; anything longer is not its. */
const MAX_PAYLOAD = 600;
const MAX_SHEET_NAME = 31;

export interface XlsxDroppedRuleSet {
  family: "conditionalFormats" | "dataValidations";
  sheet: string;
}

/** The named rule sets of a dropped-rule-set refusal, `[]` when the payload is
 *  malformed (the generic notice), or null when the message is not one. */
export function parseRuleSetDrops(message: unknown): XlsxDroppedRuleSet[] | null {
  if (typeof message !== "string") return null;
  const at = message.indexOf(PREFIX);
  if (at < 0) return null;
  const payload = message.slice(at + PREFIX.length).trim();
  if (payload.length > MAX_PAYLOAD) return [];
  let value: unknown;
  try { value = JSON.parse(payload); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const drops: XlsxDroppedRuleSet[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return [];
    const [family, sheet] = entry as unknown[];
    if ((family !== "cf" && family !== "dv") || typeof sheet !== "string" || sheet.length === 0 || sheet.length > MAX_SHEET_NAME) return [];
    drops.push({ family: family === "cf" ? "conditionalFormats" : "dataValidations", sheet });
  }
  return drops;
}

function isDropped(operation: unknown, drops: readonly XlsxDroppedRuleSet[]): boolean {
  if (!operation || typeof operation !== "object") return false;
  const { op, target } = operation as { op?: unknown; target?: { sheet?: unknown } };
  const family = op === "set_conditional_formats" ? "conditionalFormats" : op === "set_data_validations" ? "dataValidations" : null;
  return family !== null && drops.some((drop) => drop.family === family && drop.sheet === target?.sheet);
}

/** The op list without the named rule-set ops; every other op is kept. */
export function withoutDroppedRuleSets<T>(operations: readonly T[], drops: readonly XlsxDroppedRuleSet[], operationOf: (entry: T) => unknown = (entry) => entry): T[] {
  return operations.filter((entry) => !isDropped(operationOf(entry), drops));
}

/** The save failure both runtimes throw after dropping the named ops. */
export function ruleSetsDroppedError(): Error & { code: string; errorClass: string } {
  return Object.assign(new Error(XLSX_RULE_SETS_DROPPED), { code: XLSX_RULE_SETS_DROPPED, errorClass: "engine" });
}
