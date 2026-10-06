// Save-time backstop for CF/DV rule sets (X01 review M1). The renderer policy
// and the op parser refuse every rule-set edit the gateway is known to throw
// on, so this path should stay cold. If a journalled snapshot still fails the
// gateway (a shape nobody mirrored), the failed save must say which rule set
// broke it and must not block every later save of the document: the adapter
// isolates the failing whole-sheet states here, names them in the refusal
// and drops them from the journal, so the next save succeeds without them.
import type { XlsxGatewayArguments } from "./engine.ts";

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
export async function isolateRuleSetFailures(
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

/** The one-shot job refusal's reason (X01 review r2, M-A): the prefix plus a
 *  JSON list of [family, sheet] pairs, trimmed to whole entries so it fits
 *  the job error channel (toXlsxFailure keeps 300 characters). Sets left out
 *  are named by the next save, so a client that drops the named ones always
 *  converges. The client half is packages/views/office/xlsx/conditional-format/rule-set-drops.ts. */
export const XLSX_RULE_SETS_DROPPED_PREFIX = "xlsx_rule_sets_dropped:";
const MAX_REASON = 300;

export function ruleSetDropReason(ruleSets: readonly { family: XlsxRuleSetFamily; sheet: string }[]): string {
  const entries: [string, string][] = [];
  for (const { family, sheet } of ruleSets) {
    const next: [string, string][] = [...entries, [family === "conditionalFormats" ? "cf" : "dv", sheet]];
    if (XLSX_RULE_SETS_DROPPED_PREFIX.length + JSON.stringify(next).length > MAX_REASON) break;
    entries.splice(0, entries.length, ...next);
  }
  return XLSX_RULE_SETS_DROPPED_PREFIX + JSON.stringify(entries);
}

/** The save refusal's fields: a human detail, the typed list (an in-process
 *  caller reads it) and the reason, which is all a one-shot job hands back
 *  (adapter-service toXlsxFailure). */
export function ruleSetDropFields(ruleSets: readonly { family: XlsxRuleSetFamily; sheet: string }[]): Record<string, unknown> {
  return {
    detail: "these rule sets cannot be saved to xlsx and were dropped from the pending changes; save again to keep everything else: " +
      ruleSets.map(({ family, sheet }) => `${family === "conditionalFormats" ? "conditional formatting" : "data validation"} on sheet "${sheet}"`).join(", "),
    rule_sets: ruleSets,
    reason: ruleSetDropReason(ruleSets),
  };
}
