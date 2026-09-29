"use client";

import { useTranslation } from "react-i18next";
import type { Task, TaskPriority } from "@uniwork/core/types";
import { PROP_ROW_TRIGGER_CLASS, PropRow } from "../../../common/prop-row";
import { PriorityPicker, StatusPicker } from "../../pickers";

export function TaskStatusRow({
  task,
  onChange,
}: {
  task: Task;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <PropRow label={t("tasks.status")}>
      <StatusPicker
        workspaceId={task.workspace_id}
        value={task.status}
        ariaLabel={t("tasks.status")}
        searchPlaceholder={t("tasks.create.status_search_placeholder")}
        noResultsLabel={t("tasks.create.options_no_results")}
        triggerClassName={PROP_ROW_TRIGGER_CLASS}
        onChange={(value) => {
          if (value !== task.status) onChange(value);
        }}
      />
    </PropRow>
  );
}

export function TaskPriorityRow({
  task,
  open,
  onOpenChange,
  onChange,
}: {
  task: Task;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onChange: (value: TaskPriority) => void;
}) {
  const { t } = useTranslation();
  return (
    <PropRow label={t("tasks.priority")}>
      <PriorityPicker
        value={task.priority}
        ariaLabel={t("tasks.priority")}
        triggerClassName={PROP_ROW_TRIGGER_CLASS}
        open={open}
        onOpenChange={onOpenChange}
        onChange={(value) => {
          if (value !== task.priority) onChange(value);
        }}
      />
    </PropRow>
  );
}
