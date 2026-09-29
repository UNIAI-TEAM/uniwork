"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Task, TaskPriority } from "@uniwork/core/types";
import { Label } from "@uniwork/ui/components/ui/label";
import { PriorityPicker, StatusPicker } from "../../pickers";

export function PropRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr] items-start gap-x-2 gap-y-1 py-1">
      <div className="pt-1.5 text-caption text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Status + priority rows; the shared pickers draw their own icons. */
export function TaskDetailEnumFields({
  task,
  onStatusChange,
  onPriorityChange,
}: {
  task: Task;
  onStatusChange: (value: string) => void;
  onPriorityChange: (value: TaskPriority) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <PropRow label={<Label>{t("tasks.status")}</Label>}>
        <StatusPicker
          workspaceId={task.workspace_id}
          value={task.status}
          ariaLabel={t("tasks.status")}
          searchPlaceholder={t("tasks.create.status_search_placeholder")}
          noResultsLabel={t("tasks.create.options_no_results")}
          triggerClassName="h-8 w-full justify-start gap-1.5 px-2"
          onChange={(value) => {
            if (value !== task.status) onStatusChange(value);
          }}
        />
      </PropRow>

      <PropRow label={<Label>{t("tasks.priority")}</Label>}>
        <PriorityPicker
          value={task.priority}
          ariaLabel={t("tasks.priority")}
          triggerClassName="h-8 w-full justify-start gap-1.5 px-2"
          onChange={(value) => {
            if (value !== task.priority) onPriorityChange(value);
          }}
        />
      </PropRow>
    </>
  );
}
