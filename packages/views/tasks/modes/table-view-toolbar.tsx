"use client";

import { useTranslation } from "react-i18next";
import { Columns3, Layers } from "lucide-react";
import type { TableGrouping } from "@uniwork/core/tasks/stores/view-store";
import type { TaskProperty } from "@uniwork/core/types";
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

const GROUPING_OPTIONS = ["none", "status", "priority", "assignee", "project"] as const;

/** An active select or checkbox property the table can group by. */
export interface TablePropertyGrouping {
  value: `property:${string}`;
  label: string;
}

export function TableViewToolbar({
  search,
  onSearchChange,
  projectGroupingDisabled,
  projectGroupingReason,
  propertiesDisabled,
  propertiesDisabledReason,
  propertyGroupings = [],
  properties,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  projectGroupingDisabled: boolean;
  projectGroupingReason: string;
  propertiesDisabled: boolean;
  propertiesDisabledReason: string;
  propertyGroupings?: TablePropertyGrouping[];
  properties?: ReadonlyMap<string, TaskProperty>;
}) {
  const { t } = useTranslation();
  const tableGrouping = useViewStore((s) => s.tableGrouping);
  const setTableGrouping = useViewStore((s) => s.setTableGrouping);
  const displayedGrouping =
    tableGrouping === "project" && projectGroupingDisabled
      ? "none"
      : tableGrouping;
  const groupingLabel = displayedGrouping.startsWith("property:")
    ? (propertyGroupings.find((option) => option.value === displayedGrouping)
        ?.label ?? t("tasks.table.columns.property_section"))
    : t(`tasks.table.grouping.${displayedGrouping}`);

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
          {groupingLabel}
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
            {propertyGroupings.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <TableColumnPicker
        properties={properties}
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
