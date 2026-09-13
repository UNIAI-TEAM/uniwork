"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Task, TaskPriority, TaskStatus } from "@uniwork/core/types";
import {
  AssigneePicker,
  PriorityPicker,
  StatusPicker,
  type AssigneeOption,
} from "../pickers";

type BatchUpdates = {
  status?: string;
  priority?: string;
  assignee_id?: string | null;
  assignee_kind?: string;
};

export function BatchStatusPicker({
  status,
  disabled,
  onUpdate,
}: {
  status: string | null;
  disabled?: boolean;
  onUpdate: (updates: BatchUpdates) => void;
}) {
  const { t } = useTranslation();
  const label = t("tasks.batch.status");
  return (
    <>
      {/* Trigger shows the fixed action label, not the current value: a
          multi-task selection may carry mixed statuses, so there is no
          single value to display. */}
      <span data-testid="batch-status-value" data-status={status ?? "__none__"} hidden />
      <StatusPicker
        value={status as TaskStatus | null}
        disabled={disabled}
        ariaLabel={label}
        align="center"
        onChange={(value) => onUpdate({ status: value })}
      >
        {label}
      </StatusPicker>
    </>
  );
}

export function BatchPriorityPicker({
  priority,
  disabled,
  onUpdate,
}: {
  priority: string | null;
  disabled?: boolean;
  onUpdate: (updates: BatchUpdates) => void;
}) {
  const { t } = useTranslation();
  const label = t("tasks.batch.priority");
  return (
    <PriorityPicker
      value={priority as TaskPriority | null}
      disabled={disabled}
      ariaLabel={label}
      align="center"
      onChange={(value) => onUpdate({ priority: value })}
    >
      {label}
    </PriorityPicker>
  );
}

export function BatchAssigneePicker({
  assigneeId,
  mixed,
  disabled,
  members,
  onUpdate,
}: {
  assigneeId: string | null;
  mixed?: boolean;
  disabled?: boolean;
  members: Array<{ id: string; name: string }>;
  onUpdate: (updates: BatchUpdates) => void;
}) {
  const { t } = useTranslation();
  const label = useMemo(() => {
    if (mixed) return t("tasks.batch.assignee_mixed");
    if (!assigneeId) return t("tasks.unassigned");
    return members.find((m) => m.id === assigneeId)?.name ?? t("tasks.batch.assignee");
  }, [assigneeId, members, mixed, t]);
  // Batch only ever offers human members (no agent assignment here — see
  // assignee-picker.tsx and the task-2 report for why that stays as-is).
  const options: AssigneeOption[] = members.map((m) => ({
    id: m.id,
    kind: "human",
    name: m.name,
  }));

  return (
    <AssigneePicker
      value={assigneeId ? { id: assigneeId, kind: "human" } : null}
      options={options}
      disabled={disabled}
      ariaLabel={t("tasks.batch.assignee")}
      unassignedLabel={t("tasks.unassigned")}
      searchPlaceholder={t("tasks.assignee_search_placeholder")}
      noResultsLabel={t("tasks.assignee_no_results")}
      align="center"
      onChange={(next) => {
        onUpdate({ assignee_id: next?.id ?? null, assignee_kind: "human" });
      }}
    >
      {label}
    </AssigneePicker>
  );
}

export type { BatchUpdates, Task };
