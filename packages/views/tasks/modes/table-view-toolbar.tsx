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

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <TableTaskSearch
        value={search}
        onChange={onSearchChange}
        placeholder={t("tasks.table.search_placeholder")}
        clearLabel={t("tasks.table.search_clear")}
        className="max-w-sm"
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
            />
          }
        >
          <Layers className="size-3.5" aria-hidden />
          {t(`tasks.table.grouping.${tableGrouping}`)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={tableGrouping}
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
          <Button type="button" variant="outline" size="sm" className="gap-1.5">
            <Columns3 className="size-3.5" aria-hidden />
            {t("tasks.table.columns.trigger")}
          </Button>
        }
      />
    </div>
  );
}
