// X01: the conditional-formatting / data-validation slice of the journal
// bridge. The renderer emits one whole-sheet rule-set snapshot per CF/DV
// mutation (Univer's rule model, an empty list removes every rule); each maps
// 1:1 to the engine's set_conditional_formats / set_data_validations op and
// the gateway's SheetCfState / SheetDvState. Kept beside the CF group so
// xlsx-edit-bridge.ts only lists the mapping.

import type { XlsxGridEdit, XlsxJournalOpMapping, XlsxStructuralJournalRange } from "../xlsx-edit-bridge";

/** One rule of a snapshot: its areas plus the Univer rule object (CF rules
 *  also carry stopIfTrue). The rule object is opaque here: the engine bounds
 *  it and the gateway owns its vocabulary. */
export interface XlsxGridRuleSetRule {
  ranges: XlsxStructuralJournalRange[];
  stopIfTrue?: boolean;
  rule: Record<string, unknown>;
}

/** One rule-set edit the renderer emits (X01). `sheetName` is the live name
 *  at emission when it differs from the host file's. */
export interface XlsxGridRuleSetEdit {
  sheetId: string;
  sheetName?: string;
  ruleSet: "conditionalFormats" | "dataValidations";
  rules: readonly XlsxGridRuleSetRule[];
}

export type RuleSetOperation = {
  op: "set_conditional_formats" | "set_data_validations";
  target: { sheet: string };
  attributes: { rules: XlsxGridRuleSetRule[] };
};

export function isRuleSetGridEdit(edit: XlsxGridEdit): edit is XlsxGridRuleSetEdit {
  return "ruleSet" in edit;
}

function ruleSetOperation(edit: XlsxGridRuleSetEdit, sheet: string): RuleSetOperation {
  return {
    op: edit.ruleSet === "conditionalFormats" ? "set_conditional_formats" : "set_data_validations",
    target: { sheet },
    attributes: {
      rules: edit.rules.map((rule) => ({
        ranges: rule.ranges.map((range) => ({ ...range })),
        ...(edit.ruleSet === "conditionalFormats" ? { stopIfTrue: rule.stopIfTrue === true } : {}),
        rule: structuredClone(rule.rule),
      })),
    },
  };
}

function ruleSetMapping(op: RuleSetOperation["op"], ruleSet: XlsxGridRuleSetEdit["ruleSet"]): XlsxJournalOpMapping {
  return {
    op,
    matches: (edit) => isRuleSetGridEdit(edit) && edit.ruleSet === ruleSet,
    // A rule-set edit carries its own live name when it differs from the host
    // file's; the second argument is only the id-map fallback.
    build: (edit, sheet) => ruleSetOperation(edit as XlsxGridRuleSetEdit, (edit as XlsxGridRuleSetEdit).sheetName || sheet),
  };
}

export const RULE_SET_OP_MAPPINGS: readonly XlsxJournalOpMapping[] = [
  ruleSetMapping("set_conditional_formats", "conditionalFormats"),
  ruleSetMapping("set_data_validations", "dataValidations"),
];
