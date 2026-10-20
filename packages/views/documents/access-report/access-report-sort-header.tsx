"use client";

import { useLayoutEffect, useRef } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AccessReportSort } from "@uniwork/core/types/document-access-report";
import { cn } from "@uniwork/ui/lib/utils";

export type ReportSortKey = NonNullable<AccessReportSort["sort"]>;
export type ReportSortOrder = NonNullable<AccessReportSort["order"]>;

/** The order a column starts in when it is first picked: names A→Z, dates newest first. */
const DEFAULT_ORDER: Record<ReportSortKey, ReportSortOrder> = { title: "asc", changed: "desc" };

/** The column whose button was just pressed; module-level so it outlives a header mounted anew. */
let pendingFocus: { column: ReportSortKey; from: string; at: number } | null = null;
/** How long a press may wait for the new order to render before it is forgotten. */
const PENDING_MS = 3000;

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
  const ref = useRef<HTMLButtonElement>(null);
  const active = sort === column;
  const Arrow = order === "asc" ? ArrowUp : ArrowDown;
  // The sort lives in the URL, so a re-sort is a navigation: the router may
  // move focus or the row may mount anew. The header that asked takes focus
  // back once the new order has rendered.
  useLayoutEffect(() => {
    const pending = pendingFocus;
    // Only once the order the press asked for is the one on screen.
    if (!pending || pending.column !== column || pending.from === `${sort}:${order}` || Date.now() - pending.at > PENDING_MS) return;
    const button = ref.current;
    if (!button) return;
    pendingFocus = null;
    if (document.activeElement !== button) button.focus();
    // The router can move focus after this commit: look once more on the next frame.
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) button.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [column, sort, order]);
  return (
    <th
      scope="col"
      aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-1 text-left text-caption font-medium whitespace-nowrap text-muted-foreground", className)}
    >
      <button
        ref={ref}
        type="button"
        aria-label={t("documents.accessReport.sort_by", { column: label })}
        onClick={() => {
          pendingFocus = { column, from: `${sort}:${order}`, at: Date.now() };
          onSortChange({ sort: column, order: active ? (order === "asc" ? "desc" : "asc") : DEFAULT_ORDER[column] });
        }}
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
