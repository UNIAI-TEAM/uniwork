"use client";

import type { ComponentProps, ReactNode } from "react";
import { StatusIcon } from "../icons/status-icon";
import { EnumFieldPicker } from "./enum-field-picker";
import { useStatusCatalog, type StatusOption } from "./status-catalog";

type PassThrough = Omit<
  ComponentProps<typeof EnumFieldPicker>,
  "options" | "value" | "onChange" | "valueLabel" | "searchPlaceholder" | "noResultsLabel" | "children"
>;

export function StatusOptionIcon({
  option,
  className = "size-3.5",
}: {
  option: StatusOption;
  className?: string;
}) {
  return (
    <StatusIcon
      status={option.key}
      category={option.category}
      color={option.color}
      className={className}
    />
  );
}

/**
 * The one status picker: detail sidebar, table cell, batch toolbar, chat
 * peek, subtask row and the create dialog. Lists the workspace's catalog
 * (custom statuses included, archived ones left out) with the same icon
 * everywhere. Without `children` the trigger shows the current status's icon
 * and label, and the accessible name carries both; a caller that passes
 * `children` (a fixed action label, an icon-only trigger) owns what is
 * shown and passes `valueLabel` when the trigger shows the value.
 */
export function StatusPicker({
  workspaceId,
  value,
  onChange,
  valueLabel,
  searchPlaceholder,
  noResultsLabel,
  children,
  ...rest
}: PassThrough & {
  workspaceId: string;
  value: string | null;
  onChange: (value: string) => void;
  valueLabel?: string;
  searchPlaceholder?: string;
  noResultsLabel?: string;
  children?: ReactNode;
}) {
  const { options, optionOf } = useStatusCatalog(workspaceId);
  const current = value ? optionOf(value) : null;
  return (
    <EnumFieldPicker
      {...rest}
      value={value}
      onChange={onChange}
      valueLabel={children === undefined ? current?.label : valueLabel}
      searchPlaceholder={searchPlaceholder}
      noResultsLabel={noResultsLabel}
      options={options.map((option) => ({
        value: option.key,
        label: option.label,
        content: (
          <>
            <StatusOptionIcon option={option} />
            <span className="truncate">{option.label}</span>
          </>
        ),
      }))}
    >
      {children === undefined && current ? (
        <>
          <StatusOptionIcon option={current} className="size-3.5 shrink-0" />
          <span className="truncate">{current.label}</span>
        </>
      ) : (
        children
      )}
    </EnumFieldPicker>
  );
}
