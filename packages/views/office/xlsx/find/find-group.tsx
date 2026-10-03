"use client";

import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxToolbarGroupProps } from "../toolbar/types";

/** Home tab: the find & replace entry point. The panel itself is mounted by
 *  the editor (it needs the renderer host for its bounded cell reads), so this
 *  group only signals the editor; without a mounted grid or that handler the
 *  button stays in the tab order and inert. */
export function XlsxFindGroup({ readOnly = false, commands, onOpenFind }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const blocked = readOnly || !commands || !onOpenFind;
  return (
    <Button
      type="button"
      variant="toolbar"
      size="icon-sm"
      aria-label={t("office.xlsx.toolbar.groups.find.label")}
      aria-haspopup="dialog"
      aria-disabled={blocked || undefined}
      data-testid="xlsx-find-open"
      onClick={() => {
        if (blocked) return;
        onOpenFind?.();
      }}
    >
      <Search aria-hidden />
    </Button>
  );
}
