"use client";

// Wave A / A9 (UNI-926): the View-tab entry that opens the shortcuts help
// dialog. Like the other dialog entries (find, page setup, function library),
// the editor owns the dialog and this group only signals it; without a mounted
// grid or the handler the button stays in the tab order and inert.

import { Keyboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxToolbarGroupProps } from "./types";

export function XlsxViewShortcutsGroup({ commands, onOpenShortcuts }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const blocked = !commands || !onOpenShortcuts;
  return (
    <Button
      type="button"
      variant="toolbar"
      size="icon-sm"
      aria-label={t("office.xlsx.shortcuts.open")}
      title={t("office.xlsx.shortcuts.openHint")}
      aria-haspopup="dialog"
      aria-disabled={blocked || undefined}
      data-testid="xlsx-shortcuts-open"
      onClick={() => {
        if (blocked) return;
        onOpenShortcuts?.();
      }}
    >
      <Keyboard aria-hidden />
    </Button>
  );
}