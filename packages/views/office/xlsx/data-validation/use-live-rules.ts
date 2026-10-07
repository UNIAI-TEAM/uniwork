"use client";

import { useCallback, useMemo, useState } from "react";
import type { XlsxLiveRule, XlsxRuleFamily, XlsxToolbarCommands, XlsxToolbarTableRange } from "../toolbar/types";
import { areasTouch } from "./rule-areas";

export type XlsxRuleScope = "selection" | "sheet";

/** Reads a sheet's live rules for a rule manager. `refresh` re-reads after a
 *  command (the model has changed by the time an accepted command resolves);
 *  `scope` filters to the rules that touch the selection. */
export function useLiveRules(
  commands: XlsxToolbarCommands,
  sheetId: string,
  family: XlsxRuleFamily,
  selection: XlsxToolbarTableRange,
) {
  const [scope, setScope] = useState<XlsxRuleScope>("selection");
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((current) => current + 1), []);
  const rules = useMemo<readonly XlsxLiveRule[]>(() => {
    void version;
    return commands.readRuleSets?.(sheetId, family) ?? [];
  }, [commands, sheetId, family, version]);
  const visible = useMemo(
    () => (scope === "sheet" ? rules : rules.filter((rule) => areasTouch(rule.ranges, selection))),
    [rules, scope, selection],
  );
  return { scope, setScope, rules: visible, refresh };
}
