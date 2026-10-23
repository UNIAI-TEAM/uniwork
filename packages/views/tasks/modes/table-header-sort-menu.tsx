"use client";

import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, EyeOff } from "lucide-react";
import {
  propertyIdFromViewKey,
  type SortDirection,
  type SortField,
  type TableColumnKey,
  type TableSystemColumnKey,
} from "@uniwork/core/tasks/stores/view-store";
import type { TaskProperty } from "@uniwork/core/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";

const SORTABLE_COLUMNS: Partial<Record<TableSystemColumnKey, SortField>> = {
  title: "title",
  status: "status",
  priority: "priority",
  start_date: "start_date",
  due_date: "due_date",
  created_at: "created_at",
  updated_at: "updated_at",
};

/** The server orders these by position whatever is asked, so no sort is offered. */
const UNSORTABLE_PROPERTY_TYPES = new Set(["multi_select", "checkbox"]);

/**
 * The sort field a column header offers, if any. A property column sorts as
 * `property:<id>` while the property is in the active catalog and of a type
 * the server orders; a stale or archived one would silently fall back to
 * position order, so it offers none.
 */
export function sortFieldForColumn(
  columnKey: TableColumnKey,
  properties: ReadonlyMap<string, TaskProperty>,
): SortField | undefined {
  const propertyId = propertyIdFromViewKey(columnKey);
  if (!propertyId) return SORTABLE_COLUMNS[columnKey as TableSystemColumnKey];
  const property = properties.get(propertyId);
  if (!property || property.archived_at) return undefined;
  if (UNSORTABLE_PROPERTY_TYPES.has(property.type)) return undefined;
  return `property:${propertyId}`;
}

/** Column header: its label opens Ascending / Descending / Hide column. */
export function TableHeaderSortMenu({
  columnKey,
  label,
  sortField,
  sortBy,
  sortDirection,
  onSort,
  onHide,
}: {
  columnKey: TableColumnKey;
  label: string;
  sortField?: SortField;
  sortBy: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField, direction: SortDirection) => void;
  onHide: (key: TableColumnKey) => void;
}) {
  const { t } = useTranslation();
  const active = sortField !== undefined && sortBy === sortField;
  const hideable = columnKey !== "title";
  return (
    // One 16px line, no vertical padding: DataTable's header cell is h-8 py-2
    // (a 16px content box), and a reorderable column wraps this in an
    // overflow-hidden span exactly one line tall. Anything taller grows the
    // row and clips the label's top, diacritics first.
    //
    // On coarse pointers the row is 44px (pointer-coarse:h-11) and the
    // trigger stays 16px, so an invisible `after:` hit area spans the cell's
    // full height. Nothing between the trigger and the <th> is positioned, so
    // the pseudo-element's containing block is DataTable's `relative` header
    // cell — which also keeps it outside the overflow-hidden label span that
    // would otherwise clip it (and its hit testing) to one line. Horizontally
    // it starts after the grip's 44px coarse hit area and stops before the
    // 8px resize handle.
    <div className="flex min-w-0 items-center">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex min-w-0 items-center gap-1 rounded px-1.5 hover:bg-accent pointer-coarse:after:absolute pointer-coarse:after:inset-y-0 pointer-coarse:after:right-2 pointer-coarse:after:left-11">
          <span className="truncate">{label}</span>
          {active ? (
            sortDirection === "asc" ? (
              <ArrowUp className="size-3 shrink-0" aria-hidden />
            ) : (
              <ArrowDown className="size-3 shrink-0" aria-hidden />
            )
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          {sortField ? (
            <>
              <DropdownMenuItem onClick={() => onSort(sortField, "asc")}>
                <ArrowUp aria-hidden />
                {t("tasks.table.sort_ascending")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSort(sortField, "desc")}>
                <ArrowDown aria-hidden />
                {t("tasks.table.sort_descending")}
              </DropdownMenuItem>
            </>
          ) : null}
          {sortField && hideable ? <DropdownMenuSeparator /> : null}
          {hideable ? (
            <DropdownMenuItem onClick={() => onHide(columnKey)}>
              <EyeOff aria-hidden />
              {t("tasks.table.columns.hide")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
