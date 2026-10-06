// X01 review r2 (M-A) + r3 (MA-1..MA-3): the save-time backstop for CF/DV
// rule sets, client half. When a journalled rule-set snapshot still fails the
// gateway, the engine refuses the one-shot save job with a reason
//   "xlsx_rule_sets_dropped:" + JSON [["cf" | "dv", [opIndex, ...]], ...]
// (packages/office-engine/src/xlsx/adapter-rule-sets.ts writes it): per
// failing whole-sheet state, the positions in the job's edit list of every
// rule-set op folded into it. It names no sheet, so no document text reaches
// a log, and a sheet renamed after its rule edit still matches (r3 MA-2).
// The runtimes plan the drop against the exact list the failed job sent,
// drop those ops from the candidate, the pending list and the live op stream,
// and fail the save with XLSX_RULE_SETS_DROPPED - a non-terminal code
// (packages/core/office/error-state.ts), so the next explicit Save re-runs the
// intent without them and every other edit is kept. The notice names family
// and sheet from the host's own op list. A payload that is malformed or does
// not match the sent list drops nothing and shows the generic notice.

import type { XlsxGridRuleSetRule } from "./rule-set-bridge";

export const XLSX_RULE_SETS_DROPPED = "xlsx_rule_sets_dropped";

const PREFIX = `${XLSX_RULE_SETS_DROPPED}:`;
/** The engine caps the reason at 300 characters; anything longer is not its. */
const MAX_PAYLOAD = 600;
const MAX_INDEXES = 200;
/** ENGINE_LIMITS.max_edit_ops: no job carries more edits. */
const MAX_OP_INDEX = 20_000;

type RuleSetFamily = "conditionalFormats" | "dataValidations";

/** One rule set the last save left out: its family, the sheet's live name
 *  (for the notice and the grid restore) and the rules the file holds for it
 *  after the last commit of this session - null when no save of this session
 *  wrote them, so the file's rules as opened stand. */
export interface XlsxDroppedRuleSet {
  family: RuleSetFamily;
  sheet: string;
  savedRules: XlsxGridRuleSetRule[] | null;
}

/** One failing state of a refusal: its family and its op positions. */
interface XlsxRuleSetRefusal {
  family: RuleSetFamily;
  ops: number[];
}

/** The refusal's failing states, `[]` when the payload is malformed (the
 *  generic notice), or null when the message is not one. */
export function parseRuleSetDrops(message: unknown): XlsxRuleSetRefusal[] | null {
  if (typeof message !== "string") return null;
  const at = message.indexOf(PREFIX);
  if (at < 0) return null;
  const payload = message.slice(at + PREFIX.length).trim();
  if (payload.length > MAX_PAYLOAD) return [];
  let value: unknown;
  try { value = JSON.parse(payload); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const refusals: XlsxRuleSetRefusal[] = [];
  let total = 0;
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return [];
    const [family, ops] = entry as unknown[];
    if ((family !== "cf" && family !== "dv") || !Array.isArray(ops) || ops.length === 0) return [];
    if (!ops.every((index) => Number.isSafeInteger(index) && (index as number) >= 0 && (index as number) < MAX_OP_INDEX)) return [];
    total += ops.length;
    if (total > MAX_INDEXES) return [];
    refusals.push({ family: family === "cf" ? "conditionalFormats" : "dataValidations", ops: ops as number[] });
  }
  return refusals;
}

/** The message a host sees: a job error carries it as message or reason. */
export function ruleSetDropMessage(error: unknown): unknown {
  const value = error as { message?: unknown; reason?: unknown } | null;
  return typeof value?.message === "string" && value.message.includes(PREFIX) ? value.message : value?.reason;
}

interface WireOp {
  op?: unknown;
  target?: { sheet?: unknown };
  attributes?: { name?: unknown; newName?: unknown; rules?: unknown };
}

function wire(operation: unknown): WireOp {
  return operation && typeof operation === "object" ? (operation as WireOp) : {};
}

function familyOf(operation: unknown): RuleSetFamily | null {
  const { op } = wire(operation);
  return op === "set_conditional_formats" ? "conditionalFormats" : op === "set_data_validations" ? "dataValidations" : null;
}

function targetOf(operation: unknown): string | undefined {
  const sheet = wire(operation).target?.sheet;
  return typeof sheet === "string" ? sheet : undefined;
}

/** The sheet's name after `later` ran (rename_sheet carries it forward). */
function liveName(sheet: string, later: readonly unknown[]): string {
  let name = sheet;
  for (const operation of later) {
    const { op, attributes } = wire(operation);
    if (op === "rename_sheet" && targetOf(operation) === name && typeof attributes?.newName === "string") name = attributes.newName;
  }
  return name;
}

/** The family's rules on that sheet just before `earlier` ended, walking it
 *  backward through renames and copies: the last rule-set op of the family on
 *  the sheet, [] for a sheet added this session, null when nothing in
 *  `earlier` wrote them (the file's rules as opened). */
function rulesBefore(sheet: string, family: RuleSetFamily, earlier: readonly unknown[]): XlsxGridRuleSetRule[] | null {
  let name = sheet;
  for (let index = earlier.length - 1; index >= 0; index -= 1) {
    const operation = earlier[index];
    const { op, attributes } = wire(operation);
    if (op === "rename_sheet" && attributes?.newName === name) name = targetOf(operation) ?? name;
    else if (op === "add_sheet" && attributes?.name === name) return [];
    else if (op === "duplicate_sheet" && attributes?.name === name) name = targetOf(operation) ?? name;
    else if (familyOf(operation) === family && targetOf(operation) === name) {
      return Array.isArray(attributes?.rules) ? structuredClone(attributes.rules as XlsxGridRuleSetRule[]) : [];
    }
  }
  return null;
}

/** What a host drops after a refusal: the positions in the failed job's
 *  edit list and the notice / restore entries. */
export interface XlsxRuleSetDropPlan {
  indexes: number[];
  drops: XlsxDroppedRuleSet[];
}

/** Plan a refusal against the exact list the failed job sent (`sent`), the
 *  ops this session already committed (`committed`, oldest first) and the
 *  ops queued after the job's snapshot (`later`). Every named position must
 *  hold a rule-set op of its family; one that does not (stale, out of range,
 *  another op) voids the whole refusal: nothing is dropped and the notice is
 *  the generic one, never a wrong drop. */
export function planRuleSetDrops(
  refusals: readonly XlsxRuleSetRefusal[],
  sent: readonly unknown[],
  committed: readonly unknown[] = [],
  later: readonly unknown[] = [],
): XlsxRuleSetDropPlan {
  const indexes = new Set<number>();
  const drops: XlsxDroppedRuleSet[] = [];
  for (const { family, ops } of refusals) {
    if (!ops.every((index) => index < sent.length && familyOf(sent[index]) === family && targetOf(sent[index]) !== undefined)) return { indexes: [], drops: [] };
    const first = Math.min(...ops);
    const last = Math.max(...ops);
    for (const index of ops) indexes.add(index);
    drops.push({
      family,
      sheet: liveName(targetOf(sent[last])!, [...sent.slice(last + 1), ...later]),
      savedRules: rulesBefore(targetOf(sent[first])!, family, [...committed, ...sent.slice(0, first)]),
    });
  }
  return { indexes: [...indexes].sort((a, b) => a - b), drops };
}

/** The list without the entries at the planned positions. */
export function withoutOperationsAt<T>(entries: readonly T[], indexes: readonly number[]): T[] {
  const dropped = new Set(indexes);
  return entries.filter((_entry, index) => !dropped.has(index));
}

/** The save failure every runtime throws after dropping the planned ops. */
export function ruleSetsDroppedError(): Error & { code: string; errorClass: string } {
  return Object.assign(new Error(XLSX_RULE_SETS_DROPPED), { code: XLSX_RULE_SETS_DROPPED, errorClass: "engine" });
}
