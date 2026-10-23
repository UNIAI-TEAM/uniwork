"use client";

import { ArchiveRestore, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { canManageTrashed } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import type { DocumentSummaryRow } from "../library-rows";
import type { DocListScreen } from "./columns";

// The row button of Thùng rác (`Khôi phục`) and Lưu trữ (`Bỏ lưu trữ`), beside
// the ⋯ menu (contract UNI-2045 → Thao tác: "hàng = Khôi phục · ⋯", "hàng =
// Bỏ lưu trữ · ⋯"). Icon-sized so it fits the shared Actions column at every
// width; the words live on the tooltip and in the accessible name. Manage
// only (`canManageTrashed`), as the menu item it repeats; a trash row the
// viewer cannot manage shows a view-only mark instead.

export interface DocLifecycleHandlers {
  onRestore?: (doc: DocumentSummaryRow) => void;
  onUnshelve?: (doc: DocumentSummaryRow) => void;
  /** True while that row's restore or unshelve runs: the button is disabled, a second click sends nothing. */
  isBusy?: (documentId: string) => boolean;
}

export function DocLifecycleAction({
  screen,
  doc,
  title,
  handlers,
}: {
  screen: DocListScreen;
  doc: DocumentSummaryRow;
  title: string;
  handlers: DocLifecycleHandlers;
}) {
  const { t } = useTranslation();
  const run = screen === "trash" ? handlers.onRestore : screen === "shelved" ? handlers.onUnshelve : undefined;
  if (screen === "trash" && !canManageTrashed(doc)) {
    // A row the viewer only edits: no command at all, and a mark that says why (RESTORE-01 read-only rows).
    const readOnly = t("documents.trash.read_only");
    return (
      <span title={readOnly} className="inline-flex size-7 items-center justify-center text-muted-foreground pointer-coarse:size-11">
        <Lock aria-hidden className="size-3.5" />
        <span className="sr-only">{readOnly}</span>
      </span>
    );
  }
  if (!run || !canManageTrashed(doc)) return null;
  const busy = handlers.isBusy?.(doc.id) ?? false;
  const label = screen === "trash" ? t("documents.trash.restore") : t("documents.shelved_list.unshelve");
  const name =
    screen === "trash" ? t("documents.trash.restore_item", { title }) : t("documents.shelved_list.unshelve_item", { title });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="pointer-coarse:size-11"
            aria-label={name}
            data-trash-restore={screen === "trash" || undefined}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => run(doc)}
          />
        }
      >
        <ArchiveRestore aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
