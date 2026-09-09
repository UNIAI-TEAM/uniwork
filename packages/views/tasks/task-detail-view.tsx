"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import { paths } from "@uniwork/core/paths";
import { useTaskPermissions } from "@uniwork/core/permissions";
import { useMembers } from "@uniwork/core/workspaces";
import {
  useAddComment,
  useComments,
  useDeleteTask,
  useTask,
  useUpdateTask,
} from "@uniwork/core/tasks";
import type { ActorKind, TaskPriority, TaskStatus } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { AgentBadge } from "../agents/agent-badge";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import { useWorkspace } from "../layout/workspace-context";
import { DateField } from "../common/date-field";
import { TaskActivity } from "./task-activity";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

// The assignee select carries the actor pair as one value so a person and an
// agent with the same id space can never be confused (ADR 0007).
const assigneeValue = (kind: string, id: string) => `${kind}:${id}`;
function parseAssignee(v: string): { assignee_id: string | null; assignee_kind?: ActorKind } {
  const i = v.indexOf(":");
  if (i < 0) return { assignee_id: null };
  return { assignee_id: v.slice(i + 1), assignee_kind: v.slice(0, i) === "agent" ? "agent" : "human" };
}
const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

export function TaskDetailView({
  workspaceId,
  taskId,
  onDeleted,
}: {
  workspaceId: string;
  taskId: string;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { data: task } = useTask(taskId);
  const { data: members } = useMembers(workspaceId);
  const { data: agents } = useWorkspaceAgents(workspaceId);
  const update = useUpdateTask(workspaceId);
  const del = useDeleteTask(workspaceId);
  const { canDelete } = useTaskPermissions(task ?? null, workspaceId);
  const { data: comments } = useComments(taskId);
  const addComment = useAddComment(taskId);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resync when the task or a newer revision arrives
  }, [task?.id, task?.updated_at]);

  const tasksHref = paths.workspace(workspace.organization_slug, workspace.slug).tasks();
  const segments = [{ href: tasksHref, label: t("tasks.title") }];

  if (!task) {
    return (
      <div className="flex h-full flex-col">
        <BreadcrumbHeader segments={segments} leaf={t("common.loading")} />
      </div>
    );
  }

  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) =>
    update.mutate({ taskId, patch: p });

  return (
    <div className="flex h-full flex-col" data-testid="task-detail-mvp">
      <BreadcrumbHeader
        segments={segments}
        leaf={task.title}
        actions={
          <Button
            variant="destructive"
            size="sm"
            aria-disabled={!canDelete.allowed || undefined}
            title={canDelete.allowed ? undefined : canDelete.message}
            onClick={() => del.mutate(taskId, { onSuccess: onDeleted })}
          >
            {t("common.delete")}
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="min-w-0 flex-1 overflow-auto p-6">
          <input
            aria-label={t("tasks.taskTitle")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== task.title && patch({ title })}
            className="w-full rounded-md bg-transparent text-title font-semibold text-foreground"
          />
          <textarea
            aria-label={t("tasks.description")}
            value={description}
            placeholder={t("tasks.description")}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== task.description && patch({ description })}
            rows={8}
            className="mt-4 w-full resize-y rounded-lg border border-border bg-surface p-3 text-body text-foreground placeholder:text-muted-foreground"
          />
          <h2 className="mb-2 mt-6 text-body font-semibold text-foreground">{t("tasks.comments")}</h2>
          <ul className="space-y-3">
            {(comments ?? []).map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="mb-1 flex items-center gap-2 text-caption text-muted-foreground">
                  <span>{c.author?.display_name ?? c.display_name ?? c.author_id}</span>
                  {c.author_kind === "agent" && <AgentBadge />}
                </div>
                <div className="whitespace-pre-wrap text-body text-foreground">{c.body}</div>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (comment.trim()) addComment.mutate(comment, { onSuccess: () => setComment("") });
            }}
          >
            <Input
              placeholder={t("tasks.addComment")}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <Button type="submit" disabled={addComment.isPending}>
              {t("common.save")}
            </Button>
          </form>

          <h2 className="mb-2 mt-6 text-body font-semibold text-foreground">
            {t("settings.audit.activity.title")}
          </h2>
          <TaskActivity workspaceId={workspaceId} taskId={taskId} />
        </div>

        <aside className="shrink-0 space-y-4 border-t border-border p-4 md:w-64 md:border-l md:border-t-0">
          <div className="space-y-1.5">
            <Label>{t("tasks.status")}</Label>
            <Select
              items={STATUSES.map((s) => ({ value: s, label: t(`tasks.status_${s}`) }))}
              value={task.status}
              onValueChange={(v) => v && patch({ status: v as TaskStatus })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("tasks.priority")}</Label>
            <Select
              items={PRIORITIES.map((p) => ({ value: p, label: t(`tasks.priority_${p}`) }))}
              value={task.priority}
              onValueChange={(v) => v && patch({ priority: v as TaskPriority })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2">
              {t("tasks.assignee")}
              {task.assignee?.kind === "agent" && <AgentBadge />}
            </Label>
            <Select
              items={[
                { value: "", label: t("tasks.unassigned") },
                ...(members ?? []).map((m) => ({ value: assigneeValue("human", m.user_id), label: m.display_name })),
                ...(agents ?? []).map((a) => ({
                  value: assigneeValue("agent", a.id),
                  label: `${a.name} · ${t("agents.badge")}`,
                })),
              ]}
              value={task.assignee_id ? assigneeValue(task.assignee_kind, task.assignee_id) : ""}
              onValueChange={(v) => patch(parseAssignee(v ?? ""))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("tasks.dueDate")}</Label>
            <DateField
              value={task.due_date ?? ""}
              onChange={(v) => patch({ due_date: v || null })}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
