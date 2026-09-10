"use client";

import { useState } from "react";
import { ChevronDown, Flag, FolderKanban, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import { useProjects, useUpdateTask } from "@uniwork/core/tasks";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type ActorKind,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../common/date-field";
import { STATUS_CONFIG } from "../tasks/modes/status-config";
import { toastApiError } from "../toast-api-error";

const NONE = "__none__";

const assigneeValue = (kind: string, id: string) => `${kind}:${id}`;

function parseAssignee(v: string): {
  assignee_id: string | null;
  assignee_kind?: ActorKind;
} {
  if (!v || v === NONE) return { assignee_id: null };
  const i = v.indexOf(":");
  if (i < 0) return { assignee_id: null };
  return {
    assignee_id: v.slice(i + 1),
    assignee_kind: v.slice(0, i) === "agent" ? "agent" : "human",
  };
}

const priorityTone: Record<TaskPriority, string> = {
  low: "text-muted-foreground",
  medium: "text-foreground",
  high: "text-warning",
  urgent: "text-destructive",
};

const pillTrigger =
  "h-8 gap-1 rounded-full border border-border/80 bg-muted/40 px-2.5 text-caption font-medium shadow-none hover:bg-muted";

/** ClickUp-style editable property chips (PATCH — always available). */
export function ChatTaskPeekFields({
  workspaceId,
  task,
}: {
  workspaceId: string;
  task: Task;
}) {
  const { t } = useTranslation();
  const { data: members } = useMembers(workspaceId);
  const { data: agents } = useWorkspaceAgents(workspaceId);
  const { data: projectList } = useProjects(workspaceId);
  const projects = projectList?.projects ?? [];
  const update = useUpdateTask(workspaceId);
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  const statusChrome = STATUS_CONFIG[task.status as TaskStatus] ?? STATUS_CONFIG.todo;
  const assigneeLabel = task.assignee_id
    ? (members ?? []).find((m) => m.user_id === task.assignee_id)?.display_name ||
      (agents ?? []).find((a) => a.id === task.assignee_id)?.name ||
      t("tasks.assignee")
    : t("tasks.unassigned");
  const projectLabel = task.project_id
    ? projects.find((p) => p.id === task.project_id)?.title || t("chat.link.project_label")
    : t("chat.link.project_none");

  const patch = (next: Parameters<typeof update.mutate>[0]["patch"]) => {
    update.mutate(
      { taskId: task.id, patch: next },
      { onError: (err) => toastApiError(err, t("common.error")) },
    );
  };

  const assigneeItems = [
    { value: NONE, label: t("tasks.unassigned") },
    ...(members ?? []).map((m) => ({
      value: assigneeValue("human", m.user_id),
      label: m.display_name,
    })),
    ...(agents ?? []).map((a) => ({
      value: assigneeValue("agent", a.id),
      label: a.name,
    })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="chat-task-peek-fields">
      <DropdownMenu modal={false} open={projectOpen} onOpenChange={setProjectOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={pillTrigger}
              aria-label={t("chat.link.project_label")}
            />
          }
        >
          <FolderKanban className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="max-w-40 truncate">{projectLabel}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[60] min-w-52">
          <DropdownMenuRadioGroup
            value={task.project_id || NONE}
            onValueChange={(value) => {
              patch({ project_id: !value || value === NONE ? null : value });
              setProjectOpen(false);
            }}
          >
            <DropdownMenuRadioItem value={NONE}>{t("chat.link.project_none")}</DropdownMenuRadioItem>
            {projects.map((project) => (
              <DropdownMenuRadioItem key={project.id} value={project.id}>
                {project.title}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu modal={false} open={statusOpen} onOpenChange={setStatusOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(pillTrigger, statusChrome.columnBg, statusChrome.iconColor)}
              aria-label={t("tasks.status")}
            />
          }
        >
          <span className="size-1.5 rounded-full bg-current" aria-hidden />
          {t(`tasks.status_${task.status}`)}
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[60] min-w-44">
          <DropdownMenuRadioGroup
            value={task.status}
            onValueChange={(value) => {
              if (value && value !== task.status) {
                patch({ status: value as TaskStatus });
              }
              setStatusOpen(false);
            }}
          >
            {TASK_STATUSES.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>
                {t(`tasks.status_${s}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu modal={false} open={priorityOpen} onOpenChange={setPriorityOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(pillTrigger, priorityTone[task.priority])}
              aria-label={t("tasks.priority")}
            />
          }
        >
          <Flag className="size-3.5" aria-hidden />
          {t(`tasks.priority_${task.priority}`)}
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[60] min-w-44">
          <DropdownMenuRadioGroup
            value={task.priority}
            onValueChange={(value) => {
              if (value && value !== task.priority) {
                patch({ priority: value as TaskPriority });
              }
              setPriorityOpen(false);
            }}
          >
            {TASK_PRIORITIES.map((p) => (
              <DropdownMenuRadioItem key={p} value={p}>
                {t(`tasks.priority_${p}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu modal={false} open={assigneeOpen} onOpenChange={setAssigneeOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={pillTrigger}
              aria-label={t("tasks.assignee")}
            />
          }
        >
          <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="max-w-36 truncate">{assigneeLabel}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[60] min-w-52">
          <DropdownMenuRadioGroup
            value={
              task.assignee_id
                ? assigneeValue(task.assignee_kind, task.assignee_id)
                : NONE
            }
            onValueChange={(value) => {
              patch(parseAssignee(value ?? NONE));
              setAssigneeOpen(false);
            }}
          >
            {assigneeItems.map((item) => (
              <DropdownMenuRadioItem key={item.value} value={item.value}>
                {item.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DateField
        id={`chat-task-due-${task.id}`}
        value={task.due_date ?? ""}
        onChange={(v) => patch({ due_date: v || null })}
        modal={false}
        className={cn(
          pillTrigger,
          "w-auto min-w-0 focus-visible:ring-1",
          !task.due_date && "text-muted-foreground",
        )}
      />
    </div>
  );
}
