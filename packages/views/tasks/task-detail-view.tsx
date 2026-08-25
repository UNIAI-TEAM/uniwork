"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTaskPermissions } from "@uniwork/core/permissions";
import { useMembers } from "@uniwork/core/workspaces";
import {
  useAddComment,
  useComments,
  useDeleteTask,
  useTask,
  useUpdateTask,
} from "@uniwork/core/tasks";
import type { TaskPriority, TaskStatus } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];
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
  const { data: task } = useTask(taskId);
  const { data: members } = useMembers(workspaceId);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- đồng bộ khi đổi task/bản mới
  }, [task?.id, task?.updated_at]);

  if (!task) return <p className="p-6 text-text-secondary">{t("common.loading")}</p>;

  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) =>
    update.mutate({ taskId, patch: p });

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-auto p-6">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && patch({ title })}
          className="w-full bg-transparent text-lg font-semibold text-primary outline-none"
        />
        <textarea
          value={description}
          placeholder={t("tasks.description")}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== task.description && patch({ description })}
          rows={8}
          className="mt-4 w-full resize-y rounded-[var(--uw-radius)] border border-line bg-surface p-3 text-sm text-primary placeholder:text-tertiary"
        />
        <h2 className="mb-2 mt-6 text-sm font-semibold text-primary">{t("tasks.comments")}</h2>
        <ul className="space-y-3">
          {(comments ?? []).map((c) => (
            <li key={c.id} className="rounded-[var(--uw-radius)] border border-line bg-surface p-3">
              <div className="mb-1 text-[12px] text-tertiary">{c.display_name ?? c.author_id}</div>
              <div className="whitespace-pre-wrap text-sm text-primary">{c.body}</div>
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
      </div>

      <aside className="w-64 shrink-0 space-y-4 border-l border-line p-4">
        <div>
          <Label>{t("tasks.status")}</Label>
          <Select
            items={STATUSES.map((s) => ({ value: s, label: t(`tasks.status_${s}`) }))}
            value={task.status}
            onValueChange={(v) => v && patch({ status: v as TaskStatus })}
          />
        </div>
        <div>
          <Label>{t("tasks.priority")}</Label>
          <Select
            items={PRIORITIES.map((p) => ({ value: p, label: t(`tasks.priority_${p}`) }))}
            value={task.priority}
            onValueChange={(v) => v && patch({ priority: v as TaskPriority })}
          />
        </div>
        <div>
          <Label>{t("tasks.assignee")}</Label>
          <Select
            items={[
              { value: "", label: t("tasks.unassigned") },
              ...(members ?? []).map((m) => ({ value: m.user_id, label: m.display_name })),
            ]}
            value={task.assignee_id ?? ""}
            onValueChange={(v) => patch({ assignee_id: v ? v : null })}
          />
        </div>
        <div>
          <Label>{t("tasks.dueDate")}</Label>
          <Input
            type="date"
            value={task.due_date ?? ""}
            onChange={(e) => patch({ due_date: e.target.value || null })}
          />
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          aria-disabled={!canDelete.allowed || undefined}
          title={canDelete.allowed ? undefined : canDelete.message}
          onClick={() => del.mutate(taskId, { onSuccess: onDeleted })}
        >
          {t("common.delete")}
        </Button>
      </aside>
    </div>
  );
}
