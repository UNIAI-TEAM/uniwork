"use client";

import { useMemo } from "react";
import { LayoutGrid, ListFilter, Rows3, Search, Settings2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PEOPLE_COLUMN_KEYS,
  type PeopleColumnKey,
  type PeopleViewMode,
} from "@uniwork/core/people/view-store";
import type { Department } from "@uniwork/core/types/people";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Input } from "@uniwork/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * One row of controls above the directory: search on the left, and on the
 * right the three menus that shape what is shown — filter, display, view.
 *
 * The three filter dimensions are single-valued because the server takes one
 * value each, so they are radio groups rather than the checkboxes a
 * client-side filter would use. Status carries a default of "active": it only
 * counts as an active filter once it leaves that default, or the toolbar would
 * claim a filter nobody set.
 */

/** The sentinel a radio group needs for "no value", which is not a value. */
const ANY = "__any__";
const DEFAULT_STATUS = "active";

export interface PeopleFilterState {
  departmentId: string;
  role: string;
  status: string;
}

export const EMPTY_PEOPLE_FILTERS: PeopleFilterState = {
  departmentId: "",
  role: "",
  status: DEFAULT_STATUS,
};

export function countActiveFilters(filters: PeopleFilterState): number {
  let count = 0;
  if (filters.departmentId !== "") count += 1;
  if (filters.role !== "") count += 1;
  if (filters.status !== DEFAULT_STATUS) count += 1;
  return count;
}

const TOOLBAR_BUTTON = "h-8 w-8 gap-1 px-0 text-muted-foreground md:w-auto md:px-2.5";

export function PeopleToolbar({
  search,
  onSearchChange,
  shown,
  total,
  departments,
  filters,
  onFiltersChange,
  viewMode,
  onViewModeChange,
  hiddenColumns,
  onToggleColumn,
}: {
  search: string;
  onSearchChange: (next: string) => void;
  shown: number;
  total: number;
  departments: Department[];
  filters: PeopleFilterState;
  onFiltersChange: (next: PeopleFilterState) => void;
  viewMode: PeopleViewMode;
  onViewModeChange: (next: PeopleViewMode) => void;
  hiddenColumns: PeopleColumnKey[];
  onToggleColumn: (key: PeopleColumnKey) => void;
}) {
  const { t } = useTranslation();
  const activeCount = countActiveFilters(filters);
  const hasFilters = activeCount > 0;
  const isTable = viewMode === "table";

  const departmentItems = useMemo(() => flattenDepartments(departments), [departments]);

  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="relative w-full max-w-56">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t("people.search")}
            className="h-8 pl-8 text-body"
            placeholder={t("people.search_placeholder")}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        {hasFilters || search.trim() !== "" ? (
          <span className="hidden shrink-0 text-caption tabular-nums text-muted-foreground md:inline">
            {t("people.result_count", { shown, total })}
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant={hasFilters ? "default" : "outline"}
                size="sm"
                className={
                  hasFilters
                    ? "h-8 w-8 gap-1 bg-brand px-0 text-brand-foreground hover:bg-brand/90 md:w-auto md:px-2.5"
                    : TOOLBAR_BUTTON
                }
              >
                <ListFilter aria-hidden="true" className="size-3.5" />
                {/* The label is never dropped from the tree, only hidden
                    visually, so the button's accessible name always contains
                    what a sighted user reads on it (WCAG 2.5.3). */}
                <span className="max-md:sr-only">
                  {hasFilters
                    ? t("people.filter_active", { count: activeCount })
                    : t("people.filter")}
                </span>
                {hasFilters ? (
                  <span aria-hidden="true" className="tabular-nums md:hidden">
                    {activeCount}
                  </span>
                ) : null}
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-auto min-w-44">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("people.department")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-auto min-w-48 overflow-y-auto">
                <DropdownMenuRadioGroup
                  value={filters.departmentId === "" ? ANY : filters.departmentId}
                  onValueChange={(value) =>
                    onFiltersChange({
                      ...filters,
                      departmentId: value === ANY ? "" : String(value),
                    })
                  }
                >
                  <DropdownMenuRadioItem value={ANY}>
                    {t("people.department_any")}
                  </DropdownMenuRadioItem>
                  {departmentItems.map((item) => (
                    <DropdownMenuRadioItem key={item.value} value={item.value}>
                      {item.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("people.column_role")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-auto min-w-44">
                <DropdownMenuRadioGroup
                  value={filters.role === "" ? ANY : filters.role}
                  onValueChange={(value) =>
                    onFiltersChange({ ...filters, role: value === ANY ? "" : String(value) })
                  }
                >
                  <DropdownMenuRadioItem value={ANY}>{t("people.role_any")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="owner">
                    {t("people.role_owner")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="admin">
                    {t("people.role_admin")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="member">
                    {t("people.role_member")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("people.column_status")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-auto min-w-44">
                <DropdownMenuRadioGroup
                  value={filters.status}
                  onValueChange={(value) =>
                    onFiltersChange({ ...filters, status: String(value) })
                  }
                >
                  <DropdownMenuRadioItem value="active">
                    {t("people.status_active")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="deactivated">
                    {t("people.status_deactivated")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="all">
                    {t("people.status_all")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Kept in the tree with its space reserved when there is nothing to
            clear: a control that appears and disappears shifts every button
            to its right, under the cursor that just clicked one.
            `visibility: hidden` takes it out of the tab order and out of the
            accessibility tree on its own. Below md the buttons are icon-only
            and the row is tight, so there the slot is dropped rather than
            held: a blank 44px is worse on a phone than a small shift. */}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!hasFilters}
          aria-hidden={!hasFilters}
          aria-label={t("people.filter_clear")}
          className={cn("text-muted-foreground", !hasFilters && "invisible max-md:hidden")}
          onClick={() => onFiltersChange(EMPTY_PEOPLE_FILTERS)}
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>

        {/* Columns are the table's own affordance and the card view has none,
            but the slot stays: switching views must not move the view button
            the user is about to click again. */}
        {isTable ? (
          <Popover>
            <PopoverTrigger
              render={
                <Button variant="outline" size="sm" className={TOOLBAR_BUTTON}>
                  <Settings2 aria-hidden="true" className="size-3.5" />
                  <span className="max-md:sr-only">{t("people.display")}</span>
                </Button>
              }
            />
            <PopoverContent align="end" className="w-56 p-0">
              <div className="px-3 py-2.5">
                <span className="text-caption font-medium text-muted-foreground">
                  {t("people.columns")}
                </span>
                <div className="mt-2 space-y-2">
                  {PEOPLE_COLUMN_KEYS.map((key: PeopleColumnKey) => (
                    <label key={key} className="flex cursor-pointer items-center justify-between">
                      <span className="text-body">{t(COLUMN_LABEL_KEYS[key])}</span>
                      <Switch
                        size="sm"
                        checked={!hiddenColumns.includes(key)}
                        onCheckedChange={() => onToggleColumn(key)}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          // The same button, held open as empty space: identical markup is the
          // only way the two views measure the same.
          <Button
            variant="outline"
            size="sm"
            disabled
            aria-hidden="true"
            className={cn(TOOLBAR_BUTTON, "invisible max-md:hidden")}
          >
            <Settings2 aria-hidden="true" className="size-3.5" />
            <span className="max-md:sr-only">{t("people.display")}</span>
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className={TOOLBAR_BUTTON}>
                {isTable ? (
                  <Rows3 aria-hidden="true" className="size-3.5" />
                ) : (
                  <LayoutGrid aria-hidden="true" className="size-3.5" />
                )}
                {/* The purpose is said first so the name reads "Chế độ xem:
                    Thẻ" — it has to contain the visible word to satisfy WCAG
                    2.5.3, and the bare word alone would not say what the
                    button does. */}
                <span className="sr-only">{t("people.view")}: </span>
                <span className="max-md:sr-only">
                  {isTable ? t("people.view_table") : t("people.view_cards")}
                </span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-auto min-w-40">
            <DropdownMenuRadioGroup
              value={viewMode}
              onValueChange={(value) => onViewModeChange(value as PeopleViewMode)}
            >
              <DropdownMenuLabel>{t("people.view")}</DropdownMenuLabel>
              <DropdownMenuRadioItem value="cards">
                <LayoutGrid aria-hidden="true" />
                {t("people.view_cards")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="table">
                <Rows3 aria-hidden="true" />
                {t("people.view_table")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

const COLUMN_LABEL_KEYS: Record<PeopleColumnKey, string> = {
  department: "people.department",
  email: "people.column_email",
  phone: "people.field_phone",
  role: "people.column_role",
  status: "people.column_status",
};

/**
 * The department tree is at most two levels, so a child is shown by indenting
 * its label rather than by a tree widget nobody needs at this depth — the same
 * shape `DepartmentPicker` uses in the profile form.
 */
function flattenDepartments(departments: Department[]): { value: string; label: string }[] {
  const roots = departments.filter((d) => !d.parent_id);
  return roots.flatMap((root) => [
    { value: root.id, label: root.name },
    ...departments
      .filter((d) => d.parent_id === root.id)
      .map((child) => ({ value: child.id, label: `— ${child.name}` })),
  ]);
}
