"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Task, TaskPriority, TaskStatus } from "@uniwork/core/types";
import { Label } from "@uniwork/ui/components/ui/label";
import { PriorityIcon } from "../../icons/priority-icon";
import { StatusIcon } from "../../icons/status-icon";
import { PriorityPicker, StatusPicker } from "../../pickers";

export function PropRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr] items-start gap-x-2 gap-y-1 py-1">
      <div className="pt-1.5 text-caption text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Status + priority rows with parity icons on trigger and menu items. */
export function TaskDetailEnumFields({
  task,
  onStatusChange,
  onPriorityChange,
}: {
  task: Task;
  onStatusChange: (value: TaskStatus) => void;
  onPriorityChange: (value: TaskPriority) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <PropRow label={<Label>{t("tasks.status")}</Label>}>
        <StatusPicker
          value={task.status}
          ariaLabel={t("tasks.status")}
          valueLabel={t(`tasks.status_${task.status}`)}
          triggerClassName="h-8 w-full justify-start gap-1.5 px-2"
          icon={(status) => <StatusIcon status={status} className="size-3.5" />}
          onChange={(value) => {
            if (value !== task.status) onStatusChange(value);
          }}
        >
          <StatusIcon status={task.status} className="size-3.5 shrink-0" />
          <span className="truncate">{t(`tasks.status_${task.status}`)}</span>
        </StatusPicker>
      </PropRow>

      <PropRow label={<Label>{t("tasks.priority")}</Label>}>
        <PriorityPicker
          value={task.priority}
          ariaLabel={t("tasks.priority")}
          valueLabel={t(`tasks.priority_${task.priority}`)}
          triggerClassName="h-8 w-full justify-start gap-1.5 px-2"
          icon={(priority) => <PriorityIcon priority={priority} />}
          onChange={(value) => {
            if (value !== task.priority) onPriorityChange(value);
          }}
        >
          <PriorityIcon priority={task.priority} />
          <span className="truncate">{t(`tasks.priority_${task.priority}`)}</span>
        </PriorityPicker>
      </PropRow>
    </>
  );
}
