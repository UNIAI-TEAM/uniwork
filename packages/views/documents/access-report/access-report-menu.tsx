"use client";

import { Ellipsis, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";

/**
 * The Documents header's overflow: the way into the workspace access report.
 * Every workspace member sees it; the report itself lists only what the
 * reader manages and counts the rest.
 */
export function AccessReportMenu({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            aria-label={t("documents.actions.menu_label")}
          />
        }
      >
        <Ellipsis aria-hidden className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem className="gap-2 px-2 py-2 pointer-coarse:min-h-11" onClick={onOpen}>
          <ShieldCheck aria-hidden className="size-3.5" />
          {t("documents.accessReport.menu_workspace")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
