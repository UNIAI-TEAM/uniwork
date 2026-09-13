"use client";

import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { TASK_PRIORITIES, type TaskPriority } from "@uniwork/core/types";
import { EnumFieldPicker, type EnumOption } from "./enum-field-picker";

/** Builds the TASK_PRIORITIES options list, translated via existing `tasks.priority_*` keys. */
function usePriorityOptions(
  icon?: (priority: TaskPriority) => ReactNode,
): EnumOption[] {
  const { t } = useTranslation();
  return TASK_PRIORITIES.map((priority) => ({
    value: priority,
    label: t(`tasks.priority_${priority}`),
    icon: icon?.(priority),
  }));
}

export function PriorityPicker({
  value,
  onChange,
  disabled,
  ariaLabel,
  onTriggerPointerDown,
  triggerClassName,
  icon,
  children,
}: {
  value: TaskPriority | null;
  onChange: (value: TaskPriority) => void;
  disabled?: boolean;
  ariaLabel: string;
  onTriggerPointerDown?: (event: SyntheticEvent) => void;
  triggerClassName?: string;
  icon?: (priority: TaskPriority) => ReactNode;
  children: ReactNode;
}) {
  const options = usePriorityOptions(icon);
  return (
    <EnumFieldPicker
      value={value}
      options={options}
      onChange={(next) => onChange(next as TaskPriority)}
      disabled={disabled}
      ariaLabel={ariaLabel}
      onTriggerPointerDown={onTriggerPointerDown}
      triggerClassName={triggerClassName}
    >
      {children}
    </EnumFieldPicker>
  );
}
