"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { LibrarySort, LibrarySortColumn } from "./library-sort";

/** The sort button's classes, shared with the access report's headers so every list table sorts alike. */
export const SORT_HEADER_BUTTON =
  "-mx-1 inline-flex max-w-[calc(100%+0.5rem)] items-center gap-1 rounded-sm px-1 font-medium transition-colors hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11";

export interface LibrarySortHeaderProps {
  column: LibrarySortColumn;
  /** The visible, already translated column name. */
  label: string;
  sort: LibrarySort;
  onSort: (column: LibrarySortColumn) => void;
}

/**
 * The button inside a sortable `<th>`: the column name and, on the sorted
 * column only, an arrow. The `<th>` carries `aria-sort`; the button's name
 * says what a click does ("Sắp xếp theo Tên") and, once sorted, the current
 * direction, so a screen reader gets both without leaving the header. The
 * button's -mx-1 px-1 sit inside the cell padding, so its max width gives the
 * 8px back and the label keeps the full content box of a narrow column.
 */
export function LibrarySortHeader({ column, label, sort, onSort }: LibrarySortHeaderProps) {
  const { t } = useTranslation();
  const active = sort.column === column;
  const action = t("documents.home.sort.column", { column: label });
  const name = active ? `${action}, ${t(sort.order === "asc" ? "documents.home.sort.ascending" : "documents.home.sort.descending")}` : action;
  const Arrow = sort.order === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      aria-label={name}
      onClick={() => onSort(column)}
      className={cn(SORT_HEADER_BUTTON, active && "text-foreground")}
    >
      <span className="truncate">{label}</span>
      {active ? <Arrow aria-hidden className="size-3.5 shrink-0" /> : null}
    </button>
  );
}
