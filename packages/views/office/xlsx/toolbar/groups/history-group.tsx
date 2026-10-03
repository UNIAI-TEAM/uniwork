"use client";

import { Redo2, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxToolbarGroupProps } from "../types";

export function XlsxHistoryGroup({ readOnly = false, canUndo, canRedo, onUndo, onRedo }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  return (
    <>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.xlsx.actions.undo")} aria-disabled={readOnly || !canUndo || undefined} onClick={onUndo}>
        <Undo2 aria-hidden />
      </Button>
      <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.xlsx.actions.redo")} aria-disabled={readOnly || !canRedo || undefined} onClick={onRedo}>
        <Redo2 aria-hidden />
      </Button>
    </>
  );
}
