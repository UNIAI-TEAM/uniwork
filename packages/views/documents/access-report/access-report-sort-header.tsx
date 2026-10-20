"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AccessReportSort } from "@uniwork/core/types/document-access-report";
import { cn } from "@uniwork/ui/lib/utils";

export type ReportSortKey = NonNullable<AccessReportSort["sort"]>;
export type ReportSortOrder = NonNullable<AccessReportSort["order"]>;

/** The order a column starts in when it is first picked: names A→Z, dates newest first. */
const DEFAULT_ORDER: Record<ReportSortKey, ReportSortOrder> = { title: "asc", changed: "desc" };

export interface AccessReportSortHeaderProps {
  column: ReportSortKey;
  label: string;
  sort: ReportSortKey;
  order: ReportSortOrder;
  onSortChange: (next: { sort: ReportSortKey; order: ReportSortOrder }) => void;
  className?: string;
}

/**
 * A sortable column header (the UNI-2038 pattern, until it ships a shared one):
 * `aria-sort` on the `th`, a button named "Sort by {column}", and the arrow
 * only on the sorted column. The server sorts; this only asks for an order.
 */
export function AccessReportSortHeader({ column, label, sort, order, onSortChange, className }: AccessReportSortHeaderProps) {
  const { t } = useTranslation();
  const active = sort === column;
  const Arrow = order === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-1 text-left text-caption font-medium whitespace-nowrap text-muted-foreground", className)}
    >
      <button
        type="button"
        aria-label={t("documents.accessReport.sort_by", { column: label })}
        onClick={() =>
          onSortChange({ sort: column, order: active ? (order === "asc" ? "desc" : "asc") : DEFAULT_ORDER[column] })
        }
        className={cn(
          "inline-flex min-h-8 items-center gap-1 rounded-sm hover:text-foreground pointer-coarse:min-h-11",
          active && "text-foreground",
        )}
      >
        {label}
        {active ? <Arrow aria-hidden className="size-3.5" /> : null}
      </button>
    </th>
  );
}
