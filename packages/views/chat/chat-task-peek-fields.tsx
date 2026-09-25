"use client";

import { FolderKanban, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskPatch } from "@uniwork/core/api/endpoints/tasks";
import { useProjects } from "@uniwork/core/tasks";
import type { ActorKind, Task, TaskPriority, TaskStatus } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { AgentBadge } from "../agents/agent-badge";
import { DateField, dateOnlyToLocalDate } from "../common/date-field";
import { TaskActorAvatar } from "../tasks/detail/components/task-actor-avatar";
import { PriorityIcon } from "../tasks/icons/priority-icon";
import { StatusIcon } from "../tasks/icons/status-icon";
import {
  AssigneePicker,
  PriorityPicker,
  StatusPicker,
  useWorkspaceAssigneeOptions,
  type AssigneeRef,
} from "../tasks/pickers";
import { EnumFieldPicker } from "../tasks/pickers/enum-field-picker";
import { usePickerTriggerLabel } from "../tasks/pickers/trigger-label";

const NONE = "__none__";

/**
 * The property chip shared by the create-from-message sheet and the task
 * peek. Popups are left at the primitives' own z-50: they portal after the
 * dialog, so they already sit above it (the tasks pickers rely on the same).
 */
const chatTaskPillTrigger =
  "h-8 w-auto min-w-0 gap-1.5 rounded-full border border-border bg-background px-2.5 text-caption font-medium text-foreground shadow-none hover:bg-surface-hover dark:bg-background";

/** Borderless display-size title; the field still shows a border on hover and focus. */
export const chatTaskTitleInput =
  "h-auto rounded-md border-transparent bg-transparent px-1 py-0.5 text-display-sm font-bold leading-snug tracking-tight text-foreground hover:border-border md:text-display-sm dark:bg-transparent";

export function ChatTaskProjectField({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string;
  value: string;
  onChange: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const { data: projectList } = useProjects(workspaceId);
  const projects = projectList?.projects ?? [];
  const label = value
    ? projects.find((p) => p.id === value)?.title || t("chat.link.project_label")
    : t("chat.link.project_none");
  return (
    <EnumFieldPicker
      value={value || NONE}
      options={[
        { value: NONE, label: t("chat.link.project_none") },
        ...projects.map((p) => ({ value: p.id, label: p.title })),
      ]}
      onChange={(next) => onChange(next === NONE ? "" : next)}
      ariaLabel={t("chat.link.project_label")}
      valueLabel={label}
      triggerClassName={chatTaskPillTrigger}
      align="start"
    >
      <FolderKanban className="size-3.5 text-muted-foreground" aria-hidden />
      <span className={cn("max-w-40 truncate", !value && "text-muted-foreground")}>{label}</span>
    </EnumFieldPicker>
  );
}

/** People and agents in one list; an agent carries its avatar mark and badge. */
export function ChatTaskAssigneeField({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string;
  value: AssigneeRef | null;
  onChange: (next: AssigneeRef | null) => void;
}) {
  const { t } = useTranslation();
  const { options } = useWorkspaceAssigneeOptions(workspaceId);
  const selected = value
    ? options.find((o) => o.id === value.id && o.kind === value.kind)
    : undefined;
  const name = selected?.name;
  return (
    <AssigneePicker
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel={t("tasks.assignee")}
      valueLabel={
        name
          ? value?.kind === "agent"
            ? `${name} (${t("agents.badge")})`
            : name
          : t("tasks.unassigned")
      }
      unassignedLabel={t("tasks.unassigned")}
      searchPlaceholder={t("tasks.assignee_search_placeholder")}
      noResultsLabel={t("tasks.assignee_no_results")}
      triggerClassName={chatTaskPillTrigger}
    >
      {name ? (
        <>
          <TaskActorAvatar name={name} avatarUrl={selected?.avatarUrl} kind={value?.kind} />
          <span className="max-w-36 truncate">{name}</span>
          {value?.kind === "agent" ? <AgentBadge className="shrink-0" /> : null}
        </>
      ) : (
        <>
          <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">{t("tasks.unassigned")}</span>
        </>
      )}
    </AssigneePicker>
  );
}

export function ChatTaskDueField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const date = value ? dateOnlyToLocalDate(value) : undefined;
  const shown = date
    ? date.toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" })
    : undefined;
  const ariaLabel = usePickerTriggerLabel(t("chat.link.due_label"), shown);
  return (
    <DateField
      id={id}
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      className={cn(chatTaskPillTrigger, !value && "text-muted-foreground")}
    />
  );
}

/**
 * Editable property chips of a task in the peek. Each change goes to
 * `onPatch`, which saves it and reports the outcome where the peek shows its
 * save state — one place for "saved" and "not saved", chips and text alike.
 */
export function ChatTaskPeekFields({
  workspaceId,
  task,
  onPatch,
}: {
  workspaceId: string;
  task: Task;
  onPatch: (patch: TaskPatch) => void;
}) {
  const { t } = useTranslation();
  const patch = onPatch;

  const assigneeValue: AssigneeRef | null = task.assignee_id
    ? { id: task.assignee_id, kind: task.assignee_kind === "agent" ? "agent" : "human" }
    : null;
  const statusLabel = t(`tasks.status_${task.status}`);
  const priorityLabel = t(`tasks.priority_${task.priority}`);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="chat-task-peek-fields">
      <ChatTaskProjectField
        workspaceId={workspaceId}
        value={task.project_id ?? ""}
        onChange={(projectId) => {
          if (projectId !== (task.project_id ?? "")) patch({ project_id: projectId || null });
        }}
      />

      <StatusPicker
        value={task.status as TaskStatus}
        ariaLabel={t("tasks.status")}
        valueLabel={statusLabel}
        triggerClassName={chatTaskPillTrigger}
        align="start"
        icon={(status) => <StatusIcon status={status} className="size-3.5" />}
        onChange={(value) => {
          if (value !== task.status) patch({ status: value });
        }}
      >
        <StatusIcon status={task.status} className="size-3.5 shrink-0" />
        <span className="truncate">{statusLabel}</span>
      </StatusPicker>

      <PriorityPicker
        value={task.priority}
        ariaLabel={t("tasks.priority")}
        valueLabel={priorityLabel}
        triggerClassName={chatTaskPillTrigger}
        align="start"
        icon={(priority) => <PriorityIcon priority={priority} />}
        onChange={(value: TaskPriority) => {
          if (value !== task.priority) patch({ priority: value });
        }}
      >
        <PriorityIcon priority={task.priority} />
        <span className="truncate">{priorityLabel}</span>
      </PriorityPicker>

      <ChatTaskAssigneeField
        workspaceId={workspaceId}
        value={assigneeValue}
        onChange={(next) =>
          patch(
            next
              ? { assignee_id: next.id, assignee_kind: next.kind as ActorKind }
              : { assignee_id: null, assignee_kind: "human" },
          )
        }
      />

      <ChatTaskDueField
        id={`chat-task-due-${task.id}`}
        value={task.due_date ?? ""}
        onChange={(v) => patch({ due_date: v || null })}
      />
    </div>
  );
}
