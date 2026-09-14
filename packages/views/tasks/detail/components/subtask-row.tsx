"use client";

import { useMemo } from "react";
import { MoreHorizontal, Tags, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type TaskPatch,
  useLabelsOnTask,
  usePutTask,
  useTaskLabels,
  useUpdateTask,
} from "@uniwork/core/tasks";
import type { Task, TaskProperty } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../../../common/date-field";
import { AppLink } from "../../../navigation";
import { toastApiError } from "../../../toast-api-error";
import {
  AssigneePicker,
  LabelPicker,
  StatusPicker,
  labelChipClass,
  useTaskLabelToggle,
  useWorkspaceAssigneeOptions,
  type AssigneeRef,
} from "../../pickers";
import { PriorityFlag, StatusIcon } from "../../modes/status-pill";

function isClosed(status: string) {
  return status === "done" || status === "cancelled";
}

export function SubtaskRow({
  task,
  workspaceId,
  href,
  selected,
  onSelect,
  show,
  childProgress,
  propertyCatalog,
  onDelete,
}: {
  task: Task;
  workspaceId: string;
  href: string;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  show: {
    priority: boolean;
    labels: boolean;
    progress: boolean;
    dueDate: boolean;
    assignee: boolean;
  };
  childProgress?: { done: number; total: number };
  propertyCatalog: TaskProperty[];
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateTask(workspaceId);
  const put = usePutTask(workspaceId);
  const labels = useTaskLabels(workspaceId).data?.labels ?? [];
  const attachedQuery = useLabelsOnTask(task.id);
  const attached = useMemo(
    () => attachedQuery.data?.labels ?? [],
    [attachedQuery.data?.labels],
  );
  const attachedIds = useMemo(
    () => new Set(attached.map((label) => label.id)),
    [attached],
  );
  const labelToggle = useTaskLabelToggle(workspaceId, task.id);
  const { options: assigneeOptions } = useWorkspaceAssigneeOptions(workspaceId);
  const assigneeValue: AssigneeRef | null = task.assignee_id
    ? {
        id: task.assignee_id,
        kind: task.assignee_kind === "agent" ? "agent" : "human",
      }
    : null;
  const closed = isClosed(task.status);
  const overdue = Boolean(
    task.due_date &&
      task.due_date < new Date().toISOString().slice(0, 10) &&
      !closed,
  );
  const visibleProperties = propertyCatalog
    .filter((property) => task.properties?.[property.id] !== undefined)
    .slice(0, 3);
  const patch = (value: TaskPatch) => {
    update.mutate(
      { taskId: task.id, patch: value },
      { onError: (error) => toastApiError(error, t("common.error")) },
    );
  };

  return (
    <li
      className={cn(
        "group/row flex min-w-0 items-center gap-2.5 px-3 py-2 text-body transition-colors hover:bg-accent/50",
        selected && "bg-accent/30",
      )}
    >
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        {show.priority ? (
          <PriorityFlag
            priority={task.priority}
            className={cn(
              "transition-opacity",
              selected
                ? "opacity-0"
                : "group-hover/row:opacity-0 group-focus-within/row:opacity-0",
            )}
          />
        ) : null}
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
          aria-label={t("tasks.detail.subtask_select", {
            identifier: task.identifier,
          })}
          className={cn(
            "absolute inset-0 cursor-pointer accent-primary transition-opacity",
            selected
              ? "opacity-100"
              : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
          )}
        />
      </div>

      <StatusPicker
        value={task.status}
        ariaLabel={t("tasks.status")}
        valueLabel={t(`tasks.status_${task.status}`)}
        triggerClassName="size-5 p-0"
        align="start"
        onChange={(status) => patch({ status })}
      >
        <StatusIcon status={task.status} className="size-[15px]" />
      </StatusPicker>

      <AppLink href={href} className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          translate="no"
          className="shrink-0 text-micro font-medium tabular-nums text-muted-foreground"
        >
          {task.identifier || t("tasks.detail.identifier_missing")}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              closed ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {task.title}
          </span>
          {show.labels && attached.length > 0 ? (
            <span className="hidden max-w-[200px] shrink-0 items-center gap-1 overflow-hidden md:inline-flex">
              {attached.slice(0, 2).map((label) => (
                <span
                  key={label.id}
                  className={cn(
                    "max-w-20 truncate rounded-full px-1.5 py-0.5 text-micro",
                    labelChipClass(label.color),
                  )}
                >
                  {label.name}
                </span>
              ))}
              {attached.length > 2 ? (
                <span className="text-micro text-muted-foreground">
                  +{attached.length - 2}
                </span>
              ) : null}
            </span>
          ) : null}
          {visibleProperties.length > 0 ? (
            <span className="hidden max-w-[260px] shrink-0 items-center gap-1 overflow-hidden md:inline-flex">
              {visibleProperties.map((property) => (
                <span
                  key={property.id}
                  className="inline-flex max-w-[120px] items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-micro text-muted-foreground"
                >
                  <span className="truncate">
                    {String(task.properties?.[property.id])}
                  </span>
                </span>
              ))}
            </span>
          ) : null}
          {show.progress && childProgress && childProgress.total > 0 ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-muted/60 px-1.5 py-0.5 text-micro font-medium tabular-nums text-muted-foreground">
              {childProgress.done}/{childProgress.total}
            </span>
          ) : null}
        </span>
      </AppLink>

      {show.dueDate && task.due_date ? (
        <DateField
          value={task.due_date}
          onChange={(value) =>
            put.mutate(
              {
                taskId: task.id,
                body: { due_date: value || null, revision: task.revision },
                ifMatch: String(task.revision),
              },
              {
                onError: (error) =>
                  toastApiError(error, t("common.error")),
              },
            )
          }
          formatOptions={{ month: "short", day: "numeric" }}
          showIcon={false}
          className={cn(
            "h-auto w-auto min-w-0 rounded-md border-0 bg-transparent px-1 py-0 text-caption tabular-nums shadow-none dark:bg-transparent",
            overdue ? "text-destructive" : "text-muted-foreground",
          )}
        />
      ) : null}

      {show.assignee ? (
        <AssigneePicker
          value={assigneeValue}
          options={assigneeOptions}
          ariaLabel={t("tasks.assignee")}
          valueLabel={task.assignee?.display_name ?? t("tasks.unassigned")}
          unassignedLabel={t("tasks.unassigned")}
          searchPlaceholder={t("tasks.assignee_search_placeholder")}
          noResultsLabel={t("tasks.assignee_no_results")}
          triggerClassName="size-5 rounded-full p-0 [&>svg:last-child]:hidden"
          align="end"
          onChange={(next) =>
            patch(
              next
                ? { assignee_id: next.id, assignee_kind: next.kind }
                : { assignee_id: null, assignee_kind: "human" },
            )
          }
        >
          {task.assignee ? (
            <span
              title={task.assignee.display_name}
              className="flex size-5 items-center justify-center rounded-full bg-secondary text-micro text-secondary-foreground"
            >
              {task.assignee.display_name.slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <span
              aria-hidden
              className="size-5 rounded-full border border-dashed border-muted-foreground/30"
            />
          )}
        </AssigneePicker>
      ) : null}

      <LabelPicker
        labels={labels}
        selectedIds={attachedIds}
        pendingIds={labelToggle.pendingIds}
        onToggle={labelToggle.toggle}
        ariaLabel={t("tasks.detail.prop_labels")}
        emptyLabel={t("tasks.labels_empty")}
        align="end"
        triggerClassName="size-6 p-0 text-muted-foreground opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100"
      >
        <Tags aria-hidden className="size-3.5" />
      </LabelPicker>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("tasks.detail.subtask_actions")}
              className="text-muted-foreground opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100"
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => patch({ status: "done" })}>
            <StatusIcon status="done" className="mr-2 size-4" />
            {t("tasks.status_done")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => patch({ status: "todo" })}>
            <StatusIcon status="todo" className="mr-2 size-4" />
            {t("tasks.status_todo")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} variant="destructive">
            <Trash2 aria-hidden className="mr-2 size-4" />
            {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
