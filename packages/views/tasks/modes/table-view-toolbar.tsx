"use client";

import { useTranslation } from "react-i18next";
import { Columns3, Layers } from "lucide-react";
import type { TableGrouping } from "@uniwork/core/tasks/stores/view-store";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { TableColumnPicker } from "./table-column-picker";
import { TableTaskSearch } from "./table-task-search";

const GROUPING_OPTIONS: TableGrouping[] = [
  "none",
  "status",
  "assignee",
  "project",
];

export function TableViewToolbar({
  search,
  onSearchChange,
  projectGroupingDisabled,
  projectGroupingReason,
  propertiesDisabled,
  propertiesDisabledReason,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  projectGroupingDisabled: boolean;
  projectGroupingReason: string;
  propertiesDisabled: boolean;
  propertiesDisabledReason: string;
}) {
  const { t } = useTranslation();
  const tableGrouping = useViewStore((s) => s.tableGrouping);
  const setTableGrouping = useViewStore((s) => s.setTableGrouping);
  const displayedGrouping =
    tableGrouping === "project" && projectGroupingDisabled
      ? "none"
      : tableGrouping;

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
      <TableTaskSearch
        value={search}
        onChange={onSearchChange}
        placeholder={t("tasks.table.search_placeholder")}
        clearLabel={t("tasks.table.search_clear")}
        className="w-56 shrink-0"
      />
      <span className="mr-auto" />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5"
            />
          }
        >
          <Layers className="size-3.5" aria-hidden />
          {t(`tasks.table.grouping.${displayedGrouping}`)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={displayedGrouping}
            onValueChange={(value) => {
              if (value === "project" && projectGroupingDisabled) return;
              setTableGrouping(value as TableGrouping);
            }}
          >
            {GROUPING_OPTIONS.map((option) => {
              const disabled =
                option === "project" && projectGroupingDisabled;
              return (
                <DropdownMenuRadioItem
                  key={option}
                  value={option}
                  disabled={disabled}
                  title={disabled ? t(projectGroupingReason) : undefined}
                >
                  {t(`tasks.table.grouping.${option}`)}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <TableColumnPicker
        propertiesDisabled={propertiesDisabled}
        propertiesDisabledReason={propertiesDisabledReason}
        trigger={
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5">
            <Columns3 className="size-3.5" aria-hidden />
            {t("tasks.table.columns.trigger")}
          </Button>
        }
      />
    </div>
  );
}
