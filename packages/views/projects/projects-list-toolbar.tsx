"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Filter,
  LayoutGrid,
  Rows3,
  Search,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PROJECT_PRIORITY_ORDER,
  PROJECT_STATUS_ORDER,
} from "@uniwork/core/projects/config";
import type {
  ProjectColumnKey,
  ProjectListFilters,
  ProjectSortDirection,
  ProjectSortField,
  ProjectViewMode,
} from "@uniwork/core/projects/stores/view-store";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { PAGE_TOOLBAR } from "../layout/page-header";

const COLUMN_KEYS: ProjectColumnKey[] = [
  "priority",
  "progress",
  "lead",
  "tasks",
  "created",
];
const SORT_FIELDS: ProjectSortField[] = [
  "name",
  "priority",
  "status",
  "progress",
  "created",
];

export function countActiveFilters(f: ProjectListFilters): number {
  let c = 0;
  if (f.statuses.length) c++;
  if (f.priorities.length) c++;
  if (f.leads.length) c++;
  return c;
}

export function ProjectsListToolbar({
  search,
  onSearchChange,
  visibleCount,
  totalCount,
  filters,
  toggleFilter,
  clearFilters,
  sortField,
  sortDirection,
  setSortField,
  setSortDirection,
  viewMode,
  setViewMode,
  hiddenColumns,
  toggleColumn,
  isCompact,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  visibleCount: number;
  totalCount: number;
  filters: ProjectListFilters;
  toggleFilter: (key: keyof ProjectListFilters, value: string) => void;
  clearFilters: () => void;
  sortField: ProjectSortField;
  sortDirection: ProjectSortDirection;
  setSortField: (field: ProjectSortField) => void;
  setSortDirection: (direction: ProjectSortDirection) => void;
  viewMode: ProjectViewMode;
  setViewMode: (mode: ProjectViewMode) => void;
  hiddenColumns: ProjectColumnKey[];
  toggleColumn: (key: ProjectColumnKey) => void;
  isCompact: boolean;
}) {
  const { t } = useTranslation();
  const activeFilterCount = countActiveFilters(filters);
  const hasActiveFilters = activeFilterCount > 0;

  const sortLabel = (f: ProjectSortField) => {
    if (f === "name") return t("projects.table.name");
    if (f === "priority") return t("projects.table.priority");
    if (f === "status") return t("projects.table.status");
    if (f === "progress") return t("projects.table.progress");
    return t("projects.table.created");
  };

  const columnLabel = (k: ProjectColumnKey) => {
    if (k === "priority") return t("projects.table.priority");
    if (k === "progress") return t("projects.table.progress");
    if (k === "lead") return t("projects.table.lead");
    if (k === "tasks") return t("projects.table.tasks");
    return t("projects.table.created");
  };

  return (
    <div className={PAGE_TOOLBAR}>
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative hidden md:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label={t("projects.page.search_placeholder")}
            placeholder={t("projects.page.search_placeholder")}
            className="h-8 w-56 pl-8 text-body"
          />
        </div>
        {(hasActiveFilters || search.trim().length > 0) && (
          <span
            title={t("projects.toolbar.result_count_title")}
            className="hidden shrink-0 text-caption tabular-nums text-muted-foreground md:inline"
          >
            {visibleCount} / {totalCount}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant={hasActiveFilters ? "default" : "outline"}
                size="sm"
                className={
                  hasActiveFilters
                    ? "h-8 w-8 gap-1 px-0 md:w-auto md:px-2.5"
                    : "h-8 w-8 gap-1 px-0 text-muted-foreground md:w-auto md:px-2.5"
                }
              />
            }
          >
            <Filter className="size-3.5" />
            {hasActiveFilters ? (
              <>
                <span className="hidden md:inline">
                  {t("projects.toolbar.filter_active_count", {
                    count: activeFilterCount,
                  })}
                </span>
                <span className="tabular-nums md:hidden">{activeFilterCount}</span>
              </>
            ) : (
              <span className="hidden md:inline">
                {t("projects.toolbar.filter_label")}
              </span>
            )}
            {hasActiveFilters ? (
              <button
                type="button"
                aria-label={t("projects.toolbar.clear_filters")}
                className="-mr-1 ml-0.5 hidden rounded-sm p-0.5 hover:bg-white/20 md:inline-flex"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  clearFilters();
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <X className="size-3" />
              </button>
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="flex-1">{t("projects.toolbar.section_status")}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-auto min-w-44">
                {PROJECT_STATUS_ORDER.map((s) => (
                  <DropdownMenuCheckboxItem
                    key={s}
                    checked={filters.statuses.includes(s)}
                    onCheckedChange={() => toggleFilter("statuses", s)}
                  >
                    {t(`projects.status.${s}`)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="flex-1">{t("projects.toolbar.section_priority")}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-auto min-w-44">
                {PROJECT_PRIORITY_ORDER.map((pr) => (
                  <DropdownMenuCheckboxItem
                    key={pr}
                    checked={filters.priorities.includes(pr)}
                    onCheckedChange={() => toggleFilter("priorities", pr)}
                  >
                    {t(`projects.priority.${pr}`)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover>
          <Tooltip>
            <PopoverTrigger
              render={
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 gap-1 px-0 text-muted-foreground md:w-auto md:px-2.5"
                    />
                  }
                />
              }
            >
              {sortDirection === "asc" ? (
                <ArrowUp className="size-3.5" />
              ) : (
                <ArrowDown className="size-3.5" />
              )}
              <span className="hidden md:inline">{sortLabel(sortField)}</span>
            </PopoverTrigger>
            <TooltipContent side="bottom">{t("projects.toolbar.display")}</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-64 p-0">
            <div className="border-b px-3 py-2.5">
              <span className="text-caption font-medium text-muted-foreground">
                {t("projects.toolbar.sort_by")}
              </span>
              <div className="mt-2 flex items-center gap-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 justify-between text-caption"
                      />
                    }
                  >
                    {sortLabel(sortField)}
                    <ChevronDown className="size-3 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-auto">
                    <DropdownMenuRadioGroup
                      value={sortField}
                      onValueChange={(v) => setSortField(v as ProjectSortField)}
                    >
                      {SORT_FIELDS.map((f) => (
                        <DropdownMenuRadioItem key={f} value={f}>
                          {sortLabel(f)}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() =>
                    setSortDirection(sortDirection === "asc" ? "desc" : "asc")
                  }
                  title={
                    sortDirection === "asc"
                      ? t("projects.toolbar.direction_asc")
                      : t("projects.toolbar.direction_desc")
                  }
                >
                  {sortDirection === "asc" ? (
                    <ArrowUp className="size-3.5" />
                  ) : (
                    <ArrowDown className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
            {isCompact ? (
              <div className="px-3 py-2.5">
                <span className="text-caption font-medium text-muted-foreground">
                  {t("projects.toolbar.section_columns")}
                </span>
                <div className="mt-2 space-y-2">
                  {COLUMN_KEYS.map((key) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center justify-between"
                    >
                      <span className="text-body">{columnLabel(key)}</span>
                      <Switch
                        size="sm"
                        checked={!hiddenColumns.includes(key)}
                        onCheckedChange={() => toggleColumn(key)}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <Tooltip>
            <DropdownMenuTrigger
              render={
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 gap-1 px-0 text-muted-foreground md:w-auto md:px-2.5"
                    />
                  }
                />
              }
            >
              {isCompact ? (
                <Rows3 className="size-3.5" />
              ) : (
                <LayoutGrid className="size-3.5" />
              )}
              <span className="hidden md:inline">
                {isCompact
                  ? t("projects.page.view_table")
                  : t("projects.page.view_cards")}
              </span>
            </DropdownMenuTrigger>
            <TooltipContent side="bottom">{t("projects.toolbar.view")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("projects.toolbar.view")}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuRadioGroup
              value={viewMode}
              onValueChange={(v) => setViewMode(v as ProjectViewMode)}
            >
              <DropdownMenuRadioItem value="compact">
                <Rows3 />
                {t("projects.page.view_table")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="comfortable">
                <LayoutGrid />
                {t("projects.page.view_cards")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
