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
// and sheet from the host's own op list. A payload that is malformed drops
// nothing and shows the generic notice; positions that do not match the sent
// list drop the refused family's unsaved ops (planRuleSetDrops, r4 R4-4).

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
  /** How many rules the dropped (newest) snapshot held, for the notice. */
  rules: number;
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

/** The copy's name when the op is a duplicate_sheet: the engine names a
 *  copy's inherited rule set by its duplicate op (review r4 R4-2). */
function copyOf(operation: unknown): string | undefined {
  const { op, attributes } = wire(operation);
  return op === "duplicate_sheet" && targetOf(operation) !== undefined && typeof attributes?.name === "string" ? attributes.name : undefined;
}

function ruleCount(operation: unknown): number {
  const rules = wire(operation).attributes?.rules;
  return Array.isArray(rules) ? rules.length : 0;
}

/** The family's rules on that sheet just before `earlier` ended, walking it
 *  backward through renames and copies: the last rule-set op of the family on
 *  the sheet, [] for a sheet added this session, null when nothing in
 *  `earlier` wrote them (the file's rules as opened; for a copy, the rules it
 *  inherited from its source's file sheet). */
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

/** The only ops `rulesBefore` reads: what a host keeps of the ops it already
 *  committed (review r4 R4-1), so a session does not hold every committed
 *  cell batch and picture body for a rare restore lookup. */
export function ruleSetHistory(operations: readonly unknown[]): unknown[] {
  return operations.filter((operation) => {
    const { op } = wire(operation);
    return familyOf(operation) !== null || op === "rename_sheet" || op === "add_sheet" || op === "duplicate_sheet";
  });
}

/** What a host drops after a refusal: the positions in the failed job's edit
 *  list (`indexes`) and in the ops queued after the job's snapshot
 *  (`laterIndexes`), and the notice / restore entries. */
export interface XlsxRuleSetDropPlan {
  indexes: number[];
  laterIndexes: number[];
  drops: XlsxDroppedRuleSet[];
}

/** The same positions in a host's pending list (the sent list, then later). */
export function pendingDropIndexes(plan: XlsxRuleSetDropPlan, sentLength: number): number[] {
  return [...plan.indexes, ...plan.laterIndexes.map((index) => sentLength + index)];
}

/** An op of the sent list or of the later queue. */
interface Located {
  list: "sent" | "later";
  index: number;
}

/** One refused state: its family, the sheet name its walk starts from, its
 *  oldest op (a copy's duplicate op included) and the ops dropped for it. */
interface DropGroup {
  family: RuleSetFamily;
  start: string;
  first: Located;
  throughFirst: boolean;
  ops: Located[];
  /** The sheet's live name when it is not the newest op's (a copy). */
  named?: string;
}

/** Plan a refusal against the exact list the failed job sent (`sent`), the
 *  ops this session already committed (`committed`, oldest first) and the
 *  ops queued after the job's snapshot (`later`).
 *  - A refusal whose positions all hold a rule-set op of its family (or the
 *    duplicate_sheet a copy inherited it from) drops those ops, plus every
 *    later op of the family on that sheet: a later whole-sheet snapshot still
 *    carries the refused rules, and one Save must converge (r4 R4-3).
 *  - A refusal with a position that matches nothing (stale, out of range,
 *    another op), or that names only a copy's duplicate op, cannot be
 *    narrowed: every unsaved op of that family, sent or later, is dropped
 *    (r4 R4-4, lead option A). Re-sending the same list would only loop, so
 *    this is the way out; the notice names each sheet it touched.
 *  Never another family, a cell edit or any other op. */
export function planRuleSetDrops(
  refusals: readonly XlsxRuleSetRefusal[],
  sent: readonly unknown[],
  committed: readonly unknown[] = [],
  later: readonly unknown[] = [],
): XlsxRuleSetDropPlan {
  const groups: DropGroup[] = [];
  const familyWide = new Set<RuleSetFamily>();
  const at = ({ list, index }: Located) => (list === "sent" ? sent[index] : later[index]);
  const after = ({ list, index }: Located) => (list === "sent" ? [...sent.slice(index + 1), ...later] : later.slice(index + 1));
  for (const { family, ops } of refusals) {
    const matches = ops.every((index) => index < sent.length && ((familyOf(sent[index]) === family && targetOf(sent[index]) !== undefined) || copyOf(sent[index]) !== undefined));
    const droppable = ops.filter((index) => familyOf(sent[index]) === family).sort((a, b) => a - b);
    if (!matches || droppable.length === 0) {
      familyWide.add(family);
      continue;
    }
    const first = Math.min(...ops);
    const last = Math.max(...ops);
    let name = liveName(copyOf(sent[last]) ?? targetOf(sent[last])!, sent.slice(last + 1));
    const located: Located[] = droppable.map((index) => ({ list: "sent", index }));
    for (const [index, operation] of later.entries()) {
      const { op, attributes } = wire(operation);
      if (op === "rename_sheet" && targetOf(operation) === name && typeof attributes?.newName === "string") name = attributes.newName;
      else if (familyOf(operation) === family && targetOf(operation) === name) located.push({ list: "later", index });
    }
    const copy = copyOf(sent[first]);
    groups.push({ family, start: copy ?? targetOf(sent[first])!, first: { list: "sent", index: first }, throughFirst: copy !== undefined, ops: located });
  }
  for (const family of familyWide) {
    const byName = new Map<string, Located[]>();
    const all: Located[] = [
      ...sent.flatMap((operation, index) => (familyOf(operation) === family && targetOf(operation) !== undefined ? [{ list: "sent" as const, index }] : [])),
      ...later.flatMap((operation, index) => (familyOf(operation) === family && targetOf(operation) !== undefined ? [{ list: "later" as const, index }] : [])),
    ];
    for (const entry of all) {
      const name = liveName(targetOf(at(entry))!, after(entry));
      byName.set(name, [...(byName.get(name) ?? []), entry]);
    }
    for (const located of byName.values()) {
      groups.push({ family, start: targetOf(at(located[0]!))!, first: located[0]!, throughFirst: false, ops: located });
    }
    // A sheet copied in this job after one of those ops inherited the dropped
    // rules on screen too: name it and restore it. A copy with ops of its own
    // already has its group above, whose restore walks through the duplicate
    // op to the same baseline, so it is named once (review-session m-1).
    for (const [index, operation] of sent.entries()) {
      const copy = copyOf(operation);
      if (copy === undefined) continue;
      const named = liveName(copy, after({ list: "sent", index }));
      const inherited = all.filter((entry) => entry.list === "sent" && entry.index < index && liveName(targetOf(sent[entry.index])!, sent.slice(entry.index + 1, index)) === targetOf(operation));
      if (!byName.has(named) && inherited.length > 0) groups.push({ family, start: copy, first: { list: "sent", index }, throughFirst: true, ops: [inherited[inherited.length - 1]!], named });
    }
  }
  const sentDrops = new Set<number>();
  const laterDrops = new Set<number>();
  for (const group of groups) for (const entry of group.ops) (entry.list === "sent" ? sentDrops : laterDrops).add(entry.index);
  const kept = (list: readonly unknown[], dropped: Set<number>, end: number) => list.slice(0, end).filter((_operation, index) => !dropped.has(index));
  const drops = groups.map(({ family, start, first, throughFirst, ops, named }): XlsxDroppedRuleSet => {
    // What the file holds before this state: the committed history plus what
    // stays of the job (and, for a state only queued later, of the queue). A
    // copy's walk passes its own duplicate op to reach its source.
    const history = first.list === "sent"
      ? [...committed, ...kept(sent, sentDrops, first.index + (throughFirst ? 1 : 0))]
      : [...committed, ...kept(sent, sentDrops, sent.length), ...kept(later, laterDrops, first.index)];
    const newest = ops[ops.length - 1]!;
    return {
      family,
      sheet: named ?? liveName(targetOf(at(newest))!, after(newest)),
      savedRules: rulesBefore(start, family, history),
      rules: ruleCount(at(newest)),
    };
  });
  return { indexes: [...sentDrops].sort((a, b) => a - b), laterIndexes: [...laterDrops].sort((a, b) => a - b), drops };
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
