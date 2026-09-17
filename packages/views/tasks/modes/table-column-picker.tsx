"use client";

import { useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  TABLE_SYSTEM_COLUMNS,
  type TableSystemColumnKey,
} from "@uniwork/core/tasks/stores/view-store";
import type { TaskProperty } from "@uniwork/core/types";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Input } from "@uniwork/ui/components/ui/input";

type ColumnLabelKey = TableSystemColumnKey;

const NO_PROPERTIES: ReadonlyMap<string, TaskProperty> = new Map();

/**
 * Column visibility picker: system columns, then the workspace's active
 * custom properties. While the property capability is off, the property
 * section stays visible-disabled with its reason.
 */
export function TableColumnPicker({
  trigger,
  properties = NO_PROPERTIES,
  propertiesDisabled = true,
  propertiesDisabledReason,
}: {
  trigger: ReactElement;
  /** The property catalog by id; archived properties are not offered. */
  properties?: ReadonlyMap<string, TaskProperty>;
  propertiesDisabled?: boolean;
  propertiesDisabledReason?: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const tableColumns = useViewStore((state) => state.tableColumns);
  const toggleTableColumn = useViewStore((state) => state.toggleTableColumn);
  const selected = useMemo(
    () => new Set<string>(tableColumns.map((column) => column.key)),
    [tableColumns],
  );
  const query = search.trim().toLocaleLowerCase();
  const systemColumns = TABLE_SYSTEM_COLUMNS.filter((key) =>
    t(`tasks.table.columns.${key as ColumnLabelKey}`)
      .toLocaleLowerCase()
      .includes(query),
  );
  const propertyColumns = propertiesDisabled
    ? []
    : [...properties.values()]
        .filter((property) => !property.archived_at)
        .sort((a, b) => a.position - b.position)
        .filter((property) => property.name.toLocaleLowerCase().includes(query));
  const noResults =
    systemColumns.length === 0 && (propertiesDisabled || propertyColumns.length === 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="end" className="w-64 p-0">
        <div className="border-b p-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") event.stopPropagation();
            }}
            placeholder={t("tasks.table.columns.search_placeholder")}
            className="h-7"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {systemColumns.length > 0 ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {t("tasks.table.columns.system_section")}
              </DropdownMenuLabel>
              {systemColumns.map((key) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  disabled={key === "title"}
                  checked={selected.has(key)}
                  onCheckedChange={() => toggleTableColumn(key)}
                >
                  {t(`tasks.table.columns.${key as ColumnLabelKey}`)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          ) : null}
          {propertiesDisabled ? (
            <>
              {systemColumns.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  {t("tasks.table.columns.property_section")}
                </DropdownMenuLabel>
                <div className="px-2 py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto w-full justify-start px-2 py-1.5 text-caption text-muted-foreground"
                    disabled
                    title={propertiesDisabledReason ?? t("capabilities.unknown")}
                  >
                    {t("tasks.table.columns.properties_stub")}
                  </Button>
                </div>
              </DropdownMenuGroup>
            </>
          ) : propertyColumns.length > 0 ? (
            <>
              {systemColumns.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  {t("tasks.table.columns.property_section")}
                </DropdownMenuLabel>
                {propertyColumns.map((property) => {
                  const key = `property:${property.id}` as const;
                  return (
                    <DropdownMenuCheckboxItem
                      key={key}
                      checked={selected.has(key)}
                      onCheckedChange={() => toggleTableColumn(key)}
                    >
                      <span className="truncate">{property.name}</span>
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuGroup>
            </>
          ) : null}
          {noResults ? (
            <p className="px-2 py-6 text-center text-caption text-muted-foreground">
              {t("tasks.table.columns.no_results")}
            </p>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
