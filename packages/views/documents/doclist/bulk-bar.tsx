"use client";

import { Archive, ArchiveRestore, Download, FolderInput, Share2, Trash2, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { BulkActionId, BulkPlan } from "./bulk-actions";

const ICONS: Record<BulkActionId, LucideIcon> = {
  share: Share2,
  move: FolderInput,
  download: Download,
  shelve: Archive,
  trash: Trash2,
  unshelve: ArchiveRestore,
  restore: ArchiveRestore,
  purge: Trash2,
};

/**
 * The bulk bar over the table (Rules §1 "chọn ≥ 1 hiện thanh thao tác hàng
 * loạt", §3 "Thanh chọn hàng loạt"): "<n> đã chọn", the screen's actions the
 * selection allows, the destructive one last in red, and Bỏ chọn.
 */
export function DocListBulkBar({
  count,
  plans,
  busy = false,
  onRun,
  onClear,
}: {
  count: number;
  plans: BulkPlan[];
  /** A batch or a zip is under way: the actions wait for it. */
  busy?: boolean;
  onRun: (plan: BulkPlan) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="toolbar"
      aria-label={t("documents.list.bulk.toolbar")}
      className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/60 px-3 py-1.5"
    >
      <span className="mr-2 text-label font-medium tabular-nums text-foreground" aria-live="polite">
        {t("documents.list.bulk.selected", { count })}
      </span>
      {plans.map((plan) => {
        const Icon = ICONS[plan.action];
        const destructive = plan.action === "trash" || plan.action === "purge";
        return (
          <Button key={plan.action} type="button" size="sm" variant={destructive ? "destructive" : "ghost"} disabled={busy} onClick={() => onRun(plan)}>
            <Icon aria-hidden />
            {t(`documents.list.bulk.action.${plan.action}`)}
          </Button>
        );
      })}
      <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        <X aria-hidden />
        {t("documents.list.bulk.clear")}
      </Button>
    </div>
  );
}
