"use client";

import { useEffect, useRef } from "react";
import { LayoutGrid, ListFilter, Rows3, Search, Settings2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PEOPLE_COLUMN_KEYS,
  type PeopleColumnKey,
  type PeopleViewMode,
} from "@uniwork/core/people/view-store";
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
 * right the menus that shape what is shown — filter, display, view.
 *
 * Department is not in the filter menu: it is the filter people reach for
 * most, so it has its own chip row (`PeopleDepartmentBar`). Role and status
 * stay here as single-valued radio groups, because the server takes one
 * value each. Status carries a default of "active": it only counts as a set
 * filter once it leaves that default, or the toolbar would claim a filter
 * nobody set.
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

/** Filters that live in the menu — the department row counts for itself. */
export function countMenuFilters(filters: PeopleFilterState): number {
  let count = 0;
  if (filters.role !== "") count += 1;
  if (filters.status !== DEFAULT_STATUS) count += 1;
  return count;
}

export function countActiveFilters(filters: PeopleFilterState): number {
  return countMenuFilters(filters) + (filters.departmentId !== "" ? 1 : 0);
}

const TOOLBAR_BUTTON = "h-8 w-8 gap-1 px-0 md:w-auto md:px-2.5";

export function PeopleToolbar({
  search,
  onSearchChange,
  matching,
  filters,
  onFiltersChange,
  viewMode,
  onViewModeChange,
  hiddenColumns,
  onToggleColumn,
}: {
  search: string;
  onSearchChange: (next: string) => void;
  /** How many people match the search and filters, when either is set; null otherwise. */
  matching: number | null;
  filters: PeopleFilterState;
  onFiltersChange: (next: PeopleFilterState) => void;
  viewMode: PeopleViewMode;
  onViewModeChange: (next: PeopleViewMode) => void;
  hiddenColumns: PeopleColumnKey[];
  onToggleColumn: (key: PeopleColumnKey) => void;
}) {
  const { t } = useTranslation();
  const menuCount = countMenuFilters(filters);
  const hasMenuFilters = menuCount > 0;
  const isTable = viewMode === "table";
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" jumps to search, as it does in most directories — unless the reader
  // is already typing somewhere, where "/" is just a character.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 px-4 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="relative w-full max-w-72">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            variant="subtle"
            type="search"
            aria-label={t("people.search")}
            aria-keyshortcuts="/"
            className="h-8 pr-8 pl-8 text-body [&::-webkit-search-cancel-button]:hidden"
            placeholder={t("people.search_placeholder")}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && search !== "") {
                e.preventDefault();
                onSearchChange("");
              }
            }}
          />
          {search !== "" ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("people.search_clear")}
              className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
              onClick={() => {
                onSearchChange("");
                searchRef.current?.focus();
              }}
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {/* Always mounted, so the count is announced when it appears rather
            than arriving with the region; on phones it is only visually
            hidden, so a screen reader there still hears it. */}
        <span role="status" className="shrink-0 text-caption tabular-nums text-muted-foreground max-sm:sr-only">
          {matching !== null ? t("people.result_count", { count: matching }) : ""}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {filters.role !== "" ? (
          <FilterChip
            label={`${t("people.column_role")}: ${t(`people.role_${filters.role}`, { defaultValue: filters.role })}`}
            removeLabel={t("people.filter_remove", { name: t("people.column_role") })}
            onRemove={() => onFiltersChange({ ...filters, role: "" })}
          />
        ) : null}
        {filters.status !== DEFAULT_STATUS ? (
          <FilterChip
            label={`${t("people.column_status")}: ${t(`people.status_${filters.status}`, { defaultValue: filters.status })}`}
            removeLabel={t("people.filter_remove", { name: t("people.column_status") })}
            onRemove={() => onFiltersChange({ ...filters, status: DEFAULT_STATUS })}
          />
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant={hasMenuFilters ? "brandSubtle" : "toolbar"}
                size="sm"
                className={TOOLBAR_BUTTON}
              >
                <ListFilter aria-hidden="true" className="size-3.5" />
                {/* The label is never dropped from the tree, only hidden
                    visually, so the button's accessible name always contains
                    what a sighted user reads on it (WCAG 2.5.3). */}
                <span className="max-md:sr-only">
                  {hasMenuFilters
                    ? t("people.filter_active", { count: menuCount })
                    : t("people.filter")}
                </span>
                {hasMenuFilters ? (
                  <span aria-hidden="true" className="tabular-nums md:hidden">
                    {menuCount}
                  </span>
                ) : null}
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-auto min-w-44">
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

        {/* Columns are the table's own affordance and the card view has none.
            It sits to the left of the view button in a flush-right group, so
            switching views never moves the view button the user just clicked —
            only the controls left of it slide over. Below the table's wide
            zone only name and title render and the switches would do nothing,
            so the button is not offered there (the `people` container is the
            directory's own pane, the same width the table measures). */}
        {isTable ? (
          <Popover>
            <PopoverTrigger
              render={
                <Button variant="toolbar" size="sm" className={cn(TOOLBAR_BUTTON, "hidden @2xl/people:inline-flex")}>
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
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="toolbar" size="sm" className={TOOLBAR_BUTTON}>
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

/** One set filter, said in words and removable on its own. Hidden on phones, where the menu count carries it. */
function FilterChip({ label, removeLabel, onRemove }: { label: string; removeLabel: string; onRemove: () => void }) {
  return (
    <span className="hidden h-7 items-center gap-0.5 rounded-full bg-brand-subtle pr-0.5 pl-2.5 text-label text-brand-subtle-foreground md:inline-flex">
      {label}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={removeLabel}
        className="rounded-full text-current hover:bg-brand/10"
        onClick={onRemove}
      >
        <X aria-hidden="true" />
      </Button>
    </span>
  );
}

const COLUMN_LABEL_KEYS: Record<PeopleColumnKey, string> = {
  department: "people.department",
  email: "people.column_email",
  phone: "people.field_phone",
  role: "people.column_role",
  status: "people.column_status",
};
