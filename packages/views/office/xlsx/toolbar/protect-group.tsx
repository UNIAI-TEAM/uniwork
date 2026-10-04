"use client";

// B7 (UNI-926): Review-tab group for sheet protection and the name manager.
// One control opens the Protect + Name manager dialog; freeze panes already
// live on the existing Page Setup dialog (set_page_setup frozenRows/Columns),
// so they are not duplicated here.

import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxToolbarGroupProps } from "./types";

export function XlsxProtectGroup({ readOnly = false, onOpenProtect }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="toolbar"
      size="icon-sm"
      aria-label={t("office.xlsx.protect.open")}
      aria-haspopup="dialog"
      aria-disabled={readOnly || !onOpenProtect || undefined}
      data-testid="xlsx-protect-open"
      onClick={() => { if (!readOnly && onOpenProtect) onOpenProtect(); }}
    >
      <Lock aria-hidden />
    </Button>
  );
}
