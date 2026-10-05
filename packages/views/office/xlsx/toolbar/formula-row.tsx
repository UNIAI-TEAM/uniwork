"use client";

import { useTranslation } from "react-i18next";
import { XlsxFormulaBar } from "../formulas/formula-bar";

export interface XlsxFormulaRowProps {
  /** The current cell address, shown in the name box (C6: the address lives
   *  here, not in the ribbon tab row). */
  address: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
}

/**
 * FIX-CHROME C11 (UNI-926): the XLSX skeleton's formula-bar row, laid out as
 * NAME BOX (current address) | fx | formula input. Extracted from
 * `xlsx-editor.tsx` so the shell stays inside its line budget; the formula bar
 * itself (input, caret, hints) is unchanged and owned elsewhere.
 */
export function XlsxFormulaRow({ address, value, disabled, onChange, onCommit }: XlsxFormulaRowProps) {
  const { t } = useTranslation();
  return (
    <div className="flex h-7 shrink-0 items-stretch border-b border-border bg-background pointer-coarse:h-11" data-testid="xlsx-formula-row">
      <input
        readOnly
        value={address}
        aria-label={t("office.xlsx.formula.nameBox")}
        data-testid="xlsx-name-box"
        className="w-24 shrink-0 border-r border-border bg-background px-2 text-caption pointer-coarse:min-h-11"
      />
      <span aria-hidden className="flex shrink-0 items-center px-2 text-caption italic text-muted-foreground">{t("office.xlsx.formula.fx")}</span>
      <div className="min-w-0 flex-1">
        <XlsxFormulaBar value={value} disabled={disabled} onChange={onChange} onCommit={onCommit} />
      </div>
    </div>
  );
}
