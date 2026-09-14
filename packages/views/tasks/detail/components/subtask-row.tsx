"use client";

import { useMemo } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import {
  type TaskPatch,
  useLabelsOnTask,
  usePutTask,
  useTaskLabels,
  useUpdateTask,
} from "@uniwork/core/tasks";
import type { Task } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../../../common/date-field";
import { AppLink } from "../../../navigation";
import { toastApiError } from "../../../toast-api-error";
import { useWorkspaceAssigneeOptions } from "../../pickers/member-options";
import { AssigneePicker, LabelPicker, PriorityPicker, StatusPicker, labelChipClass, useTaskLabelToggle, type AssigneeRef } from "../../pickers";
import { PriorityFlag, StatusIcon } from "../../modes/status-pill";

function isClosed(status: string) {
  return status === "done" || status === "cancelled";
}

function formatDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language, { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

export function SubtaskRow({
  task,
  workspaceId,
  href,
  selected,
  onSelect,
  show,
  childProgress,
  onDelete,
}: {
  task: Task;
  workspaceId: string;
  href: string;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  show: { priority: boolean; labels: boolean; progress: boolean; dueDate: boolean; assignee: boolean };
  childProgress?: { done: number; total: number };
  onDelete?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const update = useUpdateTask(workspaceId);
  const put = usePutTask(workspaceId);
  const labels = useTaskLabels(workspaceId).data?.labels ?? [];
  const attachedQuery = useLabelsOnTask(task.id);
  const attached = useMemo(() => attachedQuery.data?.labels ?? [], [attachedQuery.data?.labels]);
  const labelToggle = useTaskLabelToggle(workspaceId, task.id);
  const { options: assigneeOptions } = useWorkspaceAssigneeOptions(workspaceId);
  const assigneeValue: AssigneeRef | null = task.assignee_id
    ? { id: task.assignee_id, kind: task.assignee_kind === "agent" ? "agent" : "human" }
    : null;
  const closed = isClosed(task.status);
  const overdue = Boolean(task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && !closed);
  const attachedIds = useMemo(() => new Set(attached.map((label) => label.id)), [attached]);
  const patch = (value: TaskPatch) => {
    update.mutate({ taskId: task.id, patch: value }, { onError: (error) => toastApiError(error, t("common.error")) });
  };
  const putDate = (value: string) => {
    put.mutate(
      { taskId: task.id, body: { due_date: value || null, revision: task.revision }, ifMatch: String(task.revision) },
      { onError: (error) => toastApiError(error, t("common.error")) },
    );
  };
  const labelChips = show.labels ? (
    <span className="flex min-w-0 max-w-48 items-center gap-1 overflow-hidden">
      {attached.slice(0, 2).map((label) => <span key={label.id} className={cn("max-w-20 truncate rounded px-1.5 py-0.5 text-micro", labelChipClass(label.color))}>{label.name}</span>)}
      {attached.length > 2 ? <span className="text-micro text-muted-foreground">+{attached.length - 2}</span> : null}
    </span>
  ) : null;

  return (
    <li className={cn("group grid min-w-0 grid-cols-[auto_auto_auto_minmax(0,1fr)_auto_auto_auto] items-center gap-2 px-2 py-1.5 text-caption hover:bg-accent/60", closed && "text-muted-foreground")}>
      <Checkbox checked={selected} onCheckedChange={onSelect} aria-label={t("tasks.detail.subtask_select", { identifier: task.identifier })} />
      {show.priority ? (
        <PriorityPicker value={task.priority} ariaLabel={t("tasks.priority")} valueLabel={t(`tasks.priority_${task.priority}`)} triggerClassName="size-6 p-0" onChange={(value) => patch({ priority: value })} icon={(value) => <PriorityFlag priority={value} />}>
          <PriorityFlag priority={task.priority} />
        </PriorityPicker>
      ) : null}
      <StatusPicker value={task.status} ariaLabel={t("tasks.status")} valueLabel={t(`tasks.status_${task.status}`)} triggerClassName="size-6 p-0" onChange={(value) => patch({ status: value })}>
        <StatusIcon status={task.status} className="size-4" />
      </StatusPicker>
      <AppLink href={href} className="flex min-w-0 items-center gap-2 focus-visible:outline-none">
        <span translate="no" className="shrink-0 font-medium text-muted-foreground">{task.identifier || t("tasks.detail.identifier_missing")}</span>
        <span className={cn("min-w-0 truncate text-foreground", closed && "text-muted-foreground line-through")}>{task.title}</span>
        {Object.entries(task.properties ?? {}).slice(0, 2).map(([key, value]) => <span key={key} className="max-w-24 truncate rounded bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">{key}: {String(value)}</span>)}
        {show.progress && childProgress && childProgress.total > 0 ? <span className="shrink-0 rounded-full bg-muted px-1.5 text-micro text-muted-foreground">{childProgress.done}/{childProgress.total}</span> : null}
      </AppLink>
      {show.labels ? <LabelPicker labels={labels} selectedIds={attachedIds} pendingIds={labelToggle.pendingIds} onToggle={labelToggle.toggle} ariaLabel={t("tasks.detail.prop_labels")} valueLabel={attached.length ? attached.map((label) => label.name).join(", ") : t("tasks.detail.prop_labels")} emptyLabel={t("tasks.labels_empty")} triggerClassName="max-w-40 justify-start overflow-hidden px-1" >{labelChips ?? <span className="text-muted-foreground">+</span>}</LabelPicker> : null}
      {show.dueDate ? (
        <DateField value={task.due_date ?? ""} onChange={putDate} className={cn("h-7 w-auto min-w-24 border-0 bg-transparent px-1 text-caption", overdue && "text-destructive", closed && "text-muted-foreground")} />
      ) : null}
      {show.assignee ? (
        <>
          {task.assignee ? <span aria-label={task.assignee.display_name} className="sr-only" /> : null}
          <AssigneePicker value={assigneeValue} options={assigneeOptions} ariaLabel={t("tasks.assignee")} valueLabel={task.assignee?.display_name ?? t("tasks.unassigned")} unassignedLabel={t("tasks.unassigned")} searchPlaceholder={t("tasks.assignee_search_placeholder")} noResultsLabel={t("tasks.assignee_no_results")} triggerClassName="size-6 rounded-full p-0" onChange={(next) => patch(next ? { assignee_id: next.id, assignee_kind: next.kind } : { assignee_id: null, assignee_kind: "human" })}>
            {task.assignee ? <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-micro text-secondary-foreground">{task.assignee.display_name.slice(0, 1).toUpperCase()}</span> : <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground">+</span>}
          </AssigneePicker>
        </>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={t("tasks.detail.subtask_actions")} />}><MoreHorizontal aria-hidden /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => patch({ status: "done" })}><StatusIcon status="done" className="mr-2 size-4" />{t("tasks.status_done")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => patch({ status: "todo" })}><StatusIcon status="todo" className="mr-2 size-4" />{t("tasks.status_todo")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} variant="destructive"><Trash2 aria-hidden className="mr-2 size-4" />{t("common.delete")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
