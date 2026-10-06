"use client";

import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxRuleScope } from "./use-live-rules";

interface RuleScopeSwitchProps {
  value: XlsxRuleScope;
  onChange: (scope: XlsxRuleScope) => void;
  label: string;
  selectionLabel: string;
  sheetLabel: string;
}

/** "This selection" / "This sheet" switch of a rule manager. */
export function RuleScopeSwitch({ value, onChange, label, selectionLabel, sheetLabel }: RuleScopeSwitchProps) {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      <Button type="button" size="sm" variant={value === "selection" ? "brand" : "outline"} aria-pressed={value === "selection"} data-testid="xlsx-rule-scope-selection" onClick={() => onChange("selection")}>
        {selectionLabel}
      </Button>
      <Button type="button" size="sm" variant={value === "sheet" ? "brand" : "outline"} aria-pressed={value === "sheet"} data-testid="xlsx-rule-scope-sheet" onClick={() => onChange("sheet")}>
        {sheetLabel}
      </Button>
    </div>
  );
}
