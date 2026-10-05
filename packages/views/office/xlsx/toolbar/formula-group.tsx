"use client";

// Wave A / A8 (UNI-926): the Formulas-tab Function Library group. Two
// controls: the library dialog entry (the editor owns the dialog because it
// holds the renderer host/unit ids) and AutoSum, which reads the guess window
// through the renderer host and inserts one `=SUM(...)` through the command
// port. Both stay in the tab order and inert when the grid is absent or the
// document is read-only.

import { Sigma, SquareFunction } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxToolbarGroupProps } from "./types";
import { XLSX_ICON_BUTTON_CLASS, XlsxGroupBody, XlsxGroupRow, XlsxGroupRows, XlsxLargeButton, XlsxLargeLabel } from "./group-layout";
import { useXlsxAutoSum } from "../formulas/use-auto-sum";

export function XlsxFormulaGroup({
  readOnly = false,
  selection,
  commands,
  host,
  unitId,
  resolveSheetId,
  sheetName,
  onOpenFunctionLibrary,
}: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const libraryBlocked = readOnly || !commands || !onOpenFunctionLibrary || selection === null;
  const autoSum = useXlsxAutoSum({
    host,
    commands,
    selection,
    sheetName: sheetName ?? null,
    resolveSheetId,
    unitId: unitId ?? null,
    enabled: host !== undefined && commands !== undefined,
    readOnly,
  });
  return (
    <XlsxGroupBody>
      <XlsxLargeButton
        aria-label={t("office.xlsx.formulas.library.open")}
        title={t("office.xlsx.formulas.library.open")}
        aria-haspopup="dialog"
        aria-disabled={libraryBlocked || undefined}
        data-testid="xlsx-function-library-open"
        onClick={() => {
          if (libraryBlocked) return;
          onOpenFunctionLibrary?.();
        }}
      >
        <SquareFunction aria-hidden />
        <XlsxLargeLabel>{t("office.xlsx.formulas.library.open")}</XlsxLargeLabel>
      </XlsxLargeButton>
      <XlsxGroupRows>
        <XlsxGroupRow>
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className={XLSX_ICON_BUTTON_CLASS}
            aria-label={t("office.xlsx.formulas.autosum.label")}
            title={t("office.xlsx.formulas.autosum.hint")}
            aria-disabled={!autoSum.canAutoSum || undefined}
            data-testid="xlsx-autosum"
            onClick={() => autoSum.autoSum()}
          >
            <Sigma aria-hidden />
          </Button>
        </XlsxGroupRow>
      </XlsxGroupRows>
      {autoSum.empty ? (
        <span role="status" aria-live="polite" className="sr-only" data-testid="xlsx-autosum-empty">
          {t("office.xlsx.formulas.autosum.empty")}
        </span>
      ) : null}
      {autoSum.failed ? (
        <span role="alert" className="sr-only" data-testid="xlsx-autosum-failed">
          {t("office.xlsx.formulas.autosum.failed")}
        </span>
      ) : null}
    </XlsxGroupBody>
  );
}
