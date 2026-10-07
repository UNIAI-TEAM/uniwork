"use client";

import { useEffect, type RefObject } from "react";
import type { XlsxEditorHandle } from "../types";
import type { XlsxGridHandle } from "../xlsx-grid-surface";
import { XLSX_RULE_SETS_DROPPED, type XlsxDroppedRuleSet } from "./rule-set-drops";

export type RuleSetRestoreGrid = RefObject<Pick<XlsxGridHandle, "getSheets" | "restoreRuleSet"> | null>;

/** Review r3 MA-3: when a save drops CF/DV rule sets, the live grid still
 *  paints them. Hand each dropped family back to the grid with the rules the
 *  file holds (the host's last committed snapshot, or null: as opened), so
 *  the screen matches the file and the family stays refused for the session.
 *  The host names the sheet by its live name; a sheet that no longer exists
 *  has nothing to restore. Restoring is idempotent, keyed by the drop list. */
export function useRuleSetDropRestore(
  errorCode: string | null | undefined,
  editor: Pick<XlsxEditorHandle, "droppedRuleSets"> | undefined,
  grid: RuleSetRestoreGrid | undefined,
): void {
  const drops = errorCode === XLSX_RULE_SETS_DROPPED ? editor?.droppedRuleSets?.() ?? [] : [];
  const key = drops.length === 0 ? "" : JSON.stringify(drops);
  useEffect(() => {
    const handle = grid?.current;
    if (!key || !handle?.restoreRuleSet) return;
    const sheets = handle.getSheets?.() ?? [];
    for (const drop of JSON.parse(key) as XlsxDroppedRuleSet[]) {
      const sheet = sheets.find((candidate) => candidate.name === drop.sheet);
      if (sheet) handle.restoreRuleSet(sheet.id, drop.family, drop.savedRules);
    }
  }, [key, grid]);
}
