"use client";

import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TASK_PRIORITIES, type TaskPriority } from "@uniwork/core/types";
import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { PriorityIcon } from "../icons/priority-icon";
import { priorityTone } from "../modes/priority-config";
import { EnumFieldPicker } from "./enum-field-picker";

type PassThrough = Omit<
  ComponentProps<typeof EnumFieldPicker>,
  "options" | "value" | "onChange" | "valueLabel" | "children"
>;

/** Tinted priority chip: the list row every priority picker shows. */
function PriorityChip({ priority, label }: { priority: TaskPriority; label: string }) {
  return (
    <span
      data-slot="priority-chip"
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-caption font-medium",
        tintClass[priorityTone(priority)],
      )}
    >
      <PriorityIcon priority={priority} className="size-3" inheritColor />
      {label}
    </span>
  );
}

/**
 * The one priority picker: detail sidebar, table cell, batch toolbar, chat
 * peek, the create dialogs and email hub. Rows are tinted chips. Without
 * `children` the trigger shows the current priority's icon and label, and the
 * accessible name carries both; a caller that passes `children` owns what is
 * shown and passes `valueLabel` when the trigger shows the value.
 */
export function PriorityPicker({
  value,
  onChange,
  valueLabel,
  children,
  width = "w-44",
  order = TASK_PRIORITIES,
  ...rest
}: PassThrough & {
  value: TaskPriority | null;
  onChange: (value: TaskPriority) => void;
  valueLabel?: string;
  /** Projects list urgent first; tasks list none first. */
  order?: readonly TaskPriority[];
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const labelOf = (priority: TaskPriority) => t(`tasks.priority_${priority}`);
  return (
    <EnumFieldPicker
      {...rest}
      width={width}
      value={value}
      onChange={(next) => onChange(next as TaskPriority)}
      valueLabel={children === undefined && value ? labelOf(value) : valueLabel}
      options={order.map((priority) => ({
        value: priority,
        label: labelOf(priority),
        content: <PriorityChip priority={priority} label={labelOf(priority)} />,
      }))}
    >
      {children === undefined && value ? (
        <>
          <PriorityIcon priority={value} className="shrink-0" />
          <span className="truncate">{labelOf(value)}</span>
        </>
      ) : (
        children
      )}
    </EnumFieldPicker>
  );
}
