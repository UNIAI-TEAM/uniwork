"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AccessReportSort } from "@uniwork/core/types/document-access-report";
import { cn } from "@uniwork/ui/lib/utils";
import { SORT_HEADER_BUTTON } from "../library-sort-header";

export type ReportSortKey = NonNullable<AccessReportSort["sort"]>;
export type ReportSortOrder = NonNullable<AccessReportSort["order"]>;

/** The order a column starts in when it is first picked: names A→Z, dates newest first. */
const DEFAULT_ORDER: Record<ReportSortKey, ReportSortOrder> = { title: "asc", changed: "desc" };

/** The press a header waits to be answered: its column, the order it left and when. */
export interface PendingSortFocus {
  column: ReportSortKey;
  from: string;
  at: number;
}
/** How long a press may wait for the new order to render before it is forgotten. */
const PENDING_MS = 3000;

/** Focus is free to come back when nothing holds it, or the pressed button itself does. */
function focusIsFree(button: HTMLElement): boolean {
  const active = document.activeElement;
  return !active || active === document.body || button.closest("th")?.contains(active) === true;
}

export interface AccessReportSortHeaderProps {
  column: ReportSortKey;
  label: string;
  sort: ReportSortKey;
  order: ReportSortOrder;
  onSortChange: (next: { sort: ReportSortKey; order: ReportSortOrder }) => void;
  /** The last press, owned by the table so it outlives a header mounted anew. */
  pendingFocus: RefObject<PendingSortFocus | null>;
  className?: string;
}

/**
 * A sortable column header, worn like the shared list's (`LibrarySortHeader`):
 * `aria-sort` on the `th`, a button named "Sort by {column}", and the arrow
 * only on the sorted column. The server sorts; this only asks for an order.
 */
export function AccessReportSortHeader({ column, label, sort, order, onSortChange, pendingFocus, className }: AccessReportSortHeaderProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const active = sort === column;
  const Arrow = order === "asc" ? ArrowUp : ArrowDown;
  // The sort lives in the URL, so a re-sort is a navigation: the router may
  // move focus or the row may mount anew. The header that asked takes focus
  // back once the new order has rendered, unless the user has gone elsewhere.
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    // Only once the order the press asked for is the one on screen.
    if (!pending || pending.column !== column || pending.from === `${sort}:${order}`) return;
    const button = ref.current;
    if (!button) return;
    if (Date.now() - pending.at > PENDING_MS || !focusIsFree(button)) {
      pendingFocus.current = null;
      return;
    }
    if (document.activeElement !== button) button.focus();
    // The router can move focus after this commit: look once more on the next
    // frame. The press is forgotten there, not here, so StrictMode's second
    // effect run (after the cleanup cancelled this frame) still has it.
    const frame = requestAnimationFrame(() => {
      pendingFocus.current = null;
      if (document.activeElement === document.body) button.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [column, sort, order, pendingFocus]);
  return (
    <th
      scope="col"
      aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-2 font-medium whitespace-nowrap", className)}
    >
      <button
        ref={ref}
        type="button"
        aria-label={t("documents.accessReport.sort_by", { column: label })}
        onClick={() => {
          pendingFocus.current = { column, from: `${sort}:${order}`, at: Date.now() };
          onSortChange({ sort: column, order: active ? (order === "asc" ? "desc" : "asc") : DEFAULT_ORDER[column] });
        }}
        className={cn(SORT_HEADER_BUTTON, active && "text-foreground")}
      >
        <span className="truncate">{label}</span>
        {active ? <Arrow aria-hidden className="size-3.5 shrink-0" /> : null}
      </button>
    </th>
  );
}
