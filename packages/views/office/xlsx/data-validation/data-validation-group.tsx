"use client";

// Data-tab Data Validation group. The large button opens the group-owned rules
// dialog; the small button clears validation on the selection through
// `sheets.command.clear-range-data-validation`. Both run through the toolbar's
// one command port and stay focusable (aria-disabled) when blocked.

import { useState } from "react";
import { Eraser, ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { fireCommand } from "../fire-command";
import { XLSX_ICON_BUTTON_CLASS, XlsxGroupBody, XlsxGroupRow, XlsxGroupRows, XlsxLargeButton, XlsxLargeLabel } from "../toolbar/group-layout";
import type { XlsxToolbarGroupProps } from "../toolbar/types";
import { XlsxDataValidationDialog } from "./data-validation-dialog";
import { clearDvParams, selectionDvRange, XLSX_DV_CLEAR_COMMAND } from "./dv-commands";

export function XlsxDataValidationGroup({
  readOnly = false,
  commands,
  selection,
  unitId,
  sheetName,
  resolveSheetId,
  host,
}: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const range = selectionDvRange(selection);
  const sheetId = sheetName ? resolveSheetId?.(sheetName) : undefined;
  const blocked = readOnly || !commands || range === null || sheetId === undefined || !unitId;

  const x14 = host?.file.sheets.find((sheet) => sheet.id === sheetId)?.ruleSets?.dataValidations === "x14";
  const x14Reason = t("office.xlsx.dataValidation.errors.x14Sheet");

  const clear = () => {
    if (blocked || x14 || !commands || range === null || sheetId === undefined || !unitId) return;
    fireCommand(commands, XLSX_DV_CLEAR_COMMAND, clearDvParams(unitId, sheetId, range));
  };

  return (
    <XlsxGroupBody>
      <XlsxLargeButton
        aria-label={t("office.xlsx.dataValidation.open")}
        title={t("office.xlsx.dataValidation.open")}
        aria-haspopup="dialog"
        aria-disabled={blocked || undefined}
        data-testid="xlsx-dv-open"
        onClick={() => {
          if (blocked) return;
          setOpen(true);
        }}
      >
        <ListChecks aria-hidden />
        <XlsxLargeLabel>{t("office.xlsx.dataValidation.open")}</XlsxLargeLabel>
      </XlsxLargeButton>
      <XlsxGroupRows>
        <XlsxGroupRow>
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className={XLSX_ICON_BUTTON_CLASS}
            aria-label={t("office.xlsx.dataValidation.clear")}
            title={x14 ? x14Reason : t("office.xlsx.dataValidation.clear")}
            aria-disabled={blocked || x14 || undefined}
            data-testid="xlsx-dv-clear"
            onClick={clear}
          >
            <Eraser aria-hidden />
          </Button>
        </XlsxGroupRow>
      </XlsxGroupRows>
      {open && !blocked && commands && range !== null && sheetId !== undefined && unitId ? (
        <XlsxDataValidationDialog
          commands={commands}
          unitId={unitId}
          subUnitId={sheetId}
          range={range}
          blocked={x14}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </XlsxGroupBody>
  );
}
