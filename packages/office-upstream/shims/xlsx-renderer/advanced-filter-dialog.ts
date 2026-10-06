// G3-05c (UNI-824) / B4 (UNI-926) - the `./AdvancedFilterDialog` scope
// boundary. The vendored `univer-sync` consumes only the logic half of the
// genoffice module: `buildCustomFilters` (used by `applyFilterCriteria`, the
// shared landing path for column criteria) and the column/condition types.
// UniWork renders its own Advanced Filter dialog in the shared toolbar (Data
// tab), so no UI is vendored here - this module is the mapping the vendored
// renderer needs, not the genoffice dialog.
import { BooleanNumber } from "@univerjs/core";
import type { IFilterColumn } from "@univerjs/sheets-filter";

/** The OOXML comparison operators the filter model and the writer share. An
 *  explicit `equal` is only compared numerically by Univer and is therefore
 *  dropped to the default (equality with text matching). */
export type AdvancedFilterOperator =
  | "equal"
  | "notEqual"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual";

export interface AdvancedFilterCondition {
  readonly operator: AdvancedFilterOperator;
  readonly val: string;
}

/** A column choice: colId is the 0-based offset inside the filter range (the
 *  same colId the gateway serializes). */
export interface AdvancedFilterColumn {
  readonly colId: number;
  readonly label: string;
}

/** Builds the Univer `customFilters` payload from dialog conditions. OOXML
 *  custom filters carry one or two conditions; `and` only matters (and only
 *  serializes) with two. */
export function buildCustomFilters(
  and: boolean,
  conditions: readonly AdvancedFilterCondition[],
): NonNullable<IFilterColumn["customFilters"]> {
  const [first, second] = conditions;
  if (first === undefined) throw new Error("advanced filter needs at least one condition");
  if (conditions.length > 2) throw new Error("advanced filter supports at most two conditions");
  return {
    ...(and && second !== undefined ? { and: BooleanNumber.TRUE } : {}),
    customFilters:
      second === undefined
        ? [toUniverCustomFilter(first)]
        : [toUniverCustomFilter(first), toUniverCustomFilter(second)],
  };
}

function toUniverCustomFilter(condition: AdvancedFilterCondition): {
  val: string;
  operator?: AdvancedFilterOperator;
} {
  // Univer evaluates an explicit `equal` numerically only; omitting it is the
  // OOXML default equality (with text matching).
  return condition.operator === "equal"
    ? { val: condition.val }
    : { val: condition.val, operator: condition.operator };
}
