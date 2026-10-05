"use client";

import { Clipboard, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxToolbarGroupProps } from "../types";
import { XLSX_ICON_BUTTON_CLASS, XlsxGroupBody, XlsxGroupRow, XlsxGroupRows, XlsxLargeButton, XlsxLargeLabel } from "../group-layout";

export function XlsxClipboardGroup({ readOnly = false, permissions = {}, selection, onCopy, onPaste }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const noSelection = selection === null;
  const pasteTitle = readOnly ? t("office.xlsx.saveState.readonly") : permissions.canPaste === false ? t("office.xlsx.clipboardUnavailable") : noSelection ? t("office.xlsx.selection.none") : t("office.xlsx.actions.paste");
  return (
    <XlsxGroupBody>
      <XlsxLargeButton
        variant="toolbar"
        aria-label={t("office.xlsx.actions.paste")}
        aria-disabled={readOnly || noSelection || permissions.canPaste === false || undefined}
        title={pasteTitle}
        onClick={onPaste}
      >
        <Clipboard aria-hidden />
        <XlsxLargeLabel>{t("office.xlsx.actions.paste")}</XlsxLargeLabel>
      </XlsxLargeButton>
      <XlsxGroupRows>
        <XlsxGroupRow>
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            className={XLSX_ICON_BUTTON_CLASS}
            aria-label={t("office.xlsx.actions.copy")}
            aria-disabled={noSelection || permissions.canCopy === false || undefined}
            title={permissions.canCopy === false ? t("office.xlsx.clipboardUnavailable") : noSelection ? t("office.xlsx.selection.none") : t("office.xlsx.actions.copy")}
            onClick={onCopy}
          >
            <Copy aria-hidden />
          </Button>
        </XlsxGroupRow>
      </XlsxGroupRows>
    </XlsxGroupBody>
  );
}
