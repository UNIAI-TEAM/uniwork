"use client";

import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { BatchUpdateBody } from "@uniwork/core/api/endpoints/tasks-suite";
import type { Task, TaskPriority, TaskStatus } from "@uniwork/core/types";
import { DateField } from "../../common/date-field";
import { PriorityIcon } from "../icons/priority-icon";
import { StatusIcon } from "../icons/status-icon";
import {
  AssigneePicker,
  PriorityPicker,
  StatusPicker,
  type AssigneeOption,
} from "../pickers";

// The endpoint body is the one definition: a field added there reaches every
// picker's `onUpdate` without a second copy to keep in step.
type BatchUpdates = BatchUpdateBody["updates"];

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
        icon={(value) => <StatusIcon status={value} className="size-3.5" />}
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
      icon={(value) => <PriorityIcon priority={value} />}
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
  const field = t("tasks.batch.assignee");
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
      ariaLabel={field}
      valueLabel={label === field ? undefined : label}
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

export function BatchDueDatePicker({
  disabled,
  onUpdate,
}: {
  disabled?: boolean;
  onUpdate: (updates: BatchUpdates) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    // Same rule as the three pickers above: the action is named by a fixed
    // label, never by a value, because a multi-task selection can hold
    // different due dates. DateField renders no custom trigger text, so the
    // name comes from a real <label> bound through the `id` it already
    // forwards to its trigger, and `value` stays empty so the trigger never
    // shows one task's day.
    //
    // No row-navigation guard here on purpose: the batch toolbar is not inside
    // a table row, so there is nothing to stop from bubbling.
    <div className="flex items-center gap-1 pl-1">
      <label htmlFor={id} className="text-body text-muted-foreground">
        {t("tasks.batch.due_date")}
      </label>
      <DateField
        id={id}
        value=""
        disabled={disabled}
        onChange={(next) => onUpdate({ due_date: next || null })}
        className="h-8 w-auto border-0 bg-transparent px-2.5 shadow-none hover:bg-accent dark:bg-transparent"
      />
    </div>
  );
}

export type { BatchUpdates, Task };
