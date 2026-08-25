"use client";
import { useTranslation } from "react-i18next";
import { useTasks } from "@uniwork/core/tasks";
import { useMembers } from "@uniwork/core/workspaces";

export function ListView({
  workspaceId,
  onOpenTask,
}: {
  workspaceId: string;
  onOpenTask: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { data: tasks } = useTasks(workspaceId);
  const { data: members } = useMembers(workspaceId);
  const nameOf = (id?: string) =>
    members?.find((m) => m.user_id === id)?.display_name ?? t("tasks.unassigned");

  return (
    <div className="overflow-auto p-4">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="border-b border-border text-left text-caption text-muted-foreground">
            <th className="py-2 pr-4 font-medium">{t("tasks.taskTitle")}</th>
            <th className="py-2 pr-4 font-medium">{t("tasks.status")}</th>
            <th className="py-2 pr-4 font-medium">{t("tasks.priority")}</th>
            <th className="py-2 pr-4 font-medium">{t("tasks.assignee")}</th>
            <th className="py-2 font-medium">{t("tasks.dueDate")}</th>
          </tr>
        </thead>
        <tbody>
          {(tasks ?? []).map((task) => (
            <tr
              key={task.id}
              onClick={() => onOpenTask(task.id)}
              className="cursor-pointer border-b border-border hover:bg-muted"
            >
              <td className="py-2 pr-4 text-foreground">
                {task.title}
                {task.kind === "welcome" && (
                  <span className="ml-2 rounded-full bg-brand/10 px-1.5 py-0.5 text-micro font-medium text-brand">{t("workspace.guideBadge")}</span>
                )}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">{t(`tasks.status_${task.status}`)}</td>
              <td className="py-2 pr-4 text-muted-foreground">{t(`tasks.priority_${task.priority}`)}</td>
              <td className="py-2 pr-4 text-muted-foreground">{nameOf(task.assignee_id)}</td>
              <td className="py-2 text-muted-foreground">{task.due_date ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
