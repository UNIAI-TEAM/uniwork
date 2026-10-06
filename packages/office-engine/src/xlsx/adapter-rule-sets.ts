// Save-time backstop for CF/DV rule sets (X01 review M1). The renderer policy
// and the op parser refuse every rule-set edit the gateway is known to throw
// on, so this path should stay cold. If a journalled snapshot still fails the
// gateway (a shape nobody mirrored), the failed save must say which rule set
// broke it and must not block every later save of the document: the adapter
// isolates the failing whole-sheet states here, names them in the refusal
// and drops them from the journal, so the next save succeeds without them.
import { EngineBoundaryError } from "@uniwork/office-contracts";
import type { XlsxGatewayArguments } from "./engine.ts";
import type { XlsxRuleSetEntry } from "./ops-cf-dv.ts";

type XlsxRuleSetFamily = "conditionalFormats" | "dataValidations";

/** One failing whole-sheet state: its family and its index in the gateway
 *  argument list (the same order as the model's pending states). */
interface XlsxRuleSetFailure {
  readonly family: XlsxRuleSetFamily;
  readonly index: number;
}

async function succeeds(attempt: () => Promise<unknown>): Promise<boolean> {
  try {
    await attempt();
    return true;
  } catch {
    return false;
  }
}

/** After a failed assemble: when the same save without any rule set passes,
 *  retry each rule-set state on its own and return the ones that still fail.
 *  An empty answer means the failure is not a rule set's (or a rule set only
 *  fails in combination), and the original error stands. Costs one extra
 *  assemble per pending state, on the failure path only. */
async function isolateRuleSetFailures(
  args: XlsxGatewayArguments | undefined,
  assemble: (args: XlsxGatewayArguments) => Promise<unknown>,
): Promise<XlsxRuleSetFailure[]> {
  const cfStates = args?.cfStates ?? [];
  const dvStates = args?.dvStates ?? [];
  if (!args || cfStates.length + dvStates.length === 0) return [];
  // An empty list is the gateway's own default for both slots.
  const base: XlsxGatewayArguments = { ...args, cfStates: [], dvStates: [] };
  if (!(await succeeds(() => assemble(base)))) return [];
  const failures: XlsxRuleSetFailure[] = [];
  for (const [index, state] of cfStates.entries()) {
    if (!(await succeeds(() => assemble({ ...base, cfStates: [state] })))) failures.push({ family: "conditionalFormats", index });
  }
  for (const [index, state] of dvStates.entries()) {
    if (!(await succeeds(() => assemble({ ...base, dvStates: [state] })))) failures.push({ family: "dataValidations", index });
  }
  return failures;
}

/** The one-shot job refusal's reason (X01 review r2 M-A, r3 MA-2 / m-1):
 *  the prefix plus a JSON list of [family, positions] pairs, where positions
 *  are the indexes, in the session's accepted op stream (for a one-shot job:
 *  the job's edit list), of every rule-set op folded into the failing state.
 *  It names no sheet: sheet names are document content, the reason reaches
 *  logs on both hosts, and a position still matches after a rename. Trimmed
 *  to whole entries (a single long entry keeps its latest positions) so it
 *  fits the job error channel (toXlsxFailure keeps 300 characters); sets left
 *  out are named by the next save, so a client that drops the named ops
 *  always converges. The client half is
 *  packages/views/office/xlsx/conditional-format/rule-set-drops.ts. */
export const XLSX_RULE_SETS_DROPPED_PREFIX = "xlsx_rule_sets_dropped:";
const MAX_REASON = 300;

interface XlsxDroppedRuleSet {
  readonly family: XlsxRuleSetFamily;
  readonly ops: readonly number[];
}

const fits = (entries: readonly (readonly [string, readonly number[]])[]) =>
  XLSX_RULE_SETS_DROPPED_PREFIX.length + JSON.stringify(entries).length <= MAX_REASON;

export function ruleSetDropReason(ruleSets: readonly XlsxDroppedRuleSet[]): string {
  const entries: [string, readonly number[]][] = [];
  for (const { family, ops } of ruleSets) {
    if (ops.length === 0) continue;
    const tag = family === "conditionalFormats" ? "cf" : "dv";
    if (fits([...entries, [tag, ops]])) {
      entries.push([tag, ops]);
      continue;
    }
    // Only a first entry may be cut, keeping its latest positions.
    if (entries.length === 0) {
      let count = 1;
      while (count < ops.length && fits([[tag, ops.slice(-(count + 1))]])) count += 1;
      entries.push([tag, ops.slice(-count)]);
    }
    break;
  }
  return XLSX_RULE_SETS_DROPPED_PREFIX + JSON.stringify(entries);
}

/** The model surface the save failure reads and trims. */
interface XlsxRuleSetJournal {
  readonly ruleSets: ReadonlyMap<string, XlsxRuleSetEntry>;
  discardRuleSet(sheetName: string, family: XlsxRuleSetFamily): void;
}

/** A failed assemble with pending CF/DV rule sets (X01 review M1): name the
 *  whole-sheet states that fail on their own by the op positions folded into
 *  them, drop them from the journal so the next save of this session goes
 *  through, and refuse this one. Any other failure keeps its original error.
 *  The refusal's fields carry no sheet name (r3 m-1). */
export async function ruleSetSaveFailure(
  model: XlsxRuleSetJournal,
  args: XlsxGatewayArguments,
  assemble: (args: XlsxGatewayArguments) => Promise<unknown>,
  error: unknown,
): Promise<unknown> {
  const failures = await isolateRuleSetFailures(args, assemble);
  if (failures.length === 0) return error;
  // The gateway states follow the journal's order, one per sheet holding the
  // family (pendingConditionalFormatStates / pendingDataValidationStates).
  const holders = (family: XlsxRuleSetFamily) => [...model.ruleSets.entries()].filter(([, entry]) => entry[family] !== undefined);
  const states = { conditionalFormats: holders("conditionalFormats"), dataValidations: holders("dataValidations") };
  const named = failures.flatMap(({ family, index }) => {
    const held = states[family][index];
    return held ? [{ family, sheet: held[0], ops: [...(held[1][family]?.sources ?? [])] }] : [];
  });
  for (const { family, sheet } of named) model.discardRuleSet(sheet, family);
  const ruleSets = named.map(({ family, ops }) => ({ family, ops }));
  return new EngineBoundaryError("unsupported_operation", {
    detail: `${ruleSets.length} rule set(s) cannot be saved to xlsx and were dropped from the pending changes; save again to keep everything else`,
    rule_sets: ruleSets,
    reason: ruleSetDropReason(ruleSets),
  });
}
