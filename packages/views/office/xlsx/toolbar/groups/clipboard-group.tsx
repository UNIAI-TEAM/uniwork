"use client";

import { Clipboard, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxToolbarGroupProps } from "../types";

export function XlsxClipboardGroup({ readOnly = false, permissions = {}, selection, onCopy, onPaste }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const noSelection = selection === null;
  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.actions.copy")}
        aria-disabled={noSelection || permissions.canCopy === false || undefined}
        title={permissions.canCopy === false ? t("office.xlsx.clipboardUnavailable") : noSelection ? t("office.xlsx.selection.none") : undefined}
        onClick={onCopy}
      >
        <Copy aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.xlsx.actions.paste")}
        aria-disabled={readOnly || noSelection || permissions.canPaste === false || undefined}
        title={readOnly ? t("office.xlsx.saveState.readonly") : permissions.canPaste === false ? t("office.xlsx.clipboardUnavailable") : noSelection ? t("office.xlsx.selection.none") : undefined}
        onClick={onPaste}
      >
        <Clipboard aria-hidden />
      </Button>
    </>
  );
}
