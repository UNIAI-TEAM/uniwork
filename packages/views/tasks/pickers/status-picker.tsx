"use client";

import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { TASK_STATUSES, type TaskStatus } from "@uniwork/core/types";
import { EnumFieldPicker, type EnumOption } from "./enum-field-picker";

/**
 * Builds the TASK_STATUSES options list, translated via existing `tasks.status_*` keys.
 * The row actions menu reads it too, so the picker and the menu cannot drift.
 */
export function useStatusOptions(
  icon?: (status: TaskStatus) => ReactNode,
): EnumOption[] {
  const { t } = useTranslation();
  return TASK_STATUSES.map((status) => ({
    value: status,
    label: t(`tasks.status_${status}`),
    icon: icon?.(status),
  }));
}

export function StatusPicker({
  value,
  onChange,
  disabled,
  ariaLabel,
  onTriggerNavigationGuard,
  triggerClassName,
  align,
  icon,
  children,
}: {
  value: TaskStatus | null;
  onChange: (value: TaskStatus) => void;
  disabled?: boolean;
  ariaLabel: string;
  onTriggerNavigationGuard?: (event: SyntheticEvent) => void;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  icon?: (status: TaskStatus) => ReactNode;
  children: ReactNode;
}) {
  const options = useStatusOptions(icon);
  return (
    <EnumFieldPicker
      value={value}
      options={options}
      onChange={(next) => onChange(next as TaskStatus)}
      disabled={disabled}
      ariaLabel={ariaLabel}
      onTriggerNavigationGuard={onTriggerNavigationGuard}
      triggerClassName={triggerClassName}
      align={align}
    >
      {children}
    </EnumFieldPicker>
  );
}
