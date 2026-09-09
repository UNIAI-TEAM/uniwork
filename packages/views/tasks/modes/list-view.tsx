"use client";

import { useTranslation } from "react-i18next";
import type { Task } from "@uniwork/core/types";
import { AgentBadge } from "../../agents/agent-badge";
import {
  AgentTriggerStub,
  SquadAssignStub,
} from "../surface/agent-squad-gates";

/**
 * Suite TaskSurface list mode. Separate from MVP `../list-view.tsx`, which
 * still fetches via `useTasks` for the flag-off path.
 */
export function ListView({
  tasks,
  onOpenTask,
}: {
  tasks: Task[];
  onOpenTask?: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="overflow-auto p-4">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="border-b border-border text-left text-caption text-muted-foreground">
            <th className="py-2 pr-4 font-medium">{t("tasks.taskTitle")}</th>
            <th className="py-2 pr-4 font-medium">{t("tasks.status")}</th>
            <th className="py-2 pr-4 font-medium">{t("tasks.priority")}</th>
            <th className="py-2 pr-4 font-medium">{t("tasks.assignee")}</th>
            <th className="py-2 pr-4 font-medium">{t("tasks.dueDate")}</th>
            <th className="py-2 font-medium">{t("tasks.surface.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr
              key={task.id}
              onClick={onOpenTask ? () => onOpenTask(task.id) : undefined}
              className={
                onOpenTask
                  ? "cursor-pointer border-b border-border hover:bg-muted"
                  : "border-b border-border"
              }
            >
              <td className="py-2 pr-4 text-foreground">{task.title}</td>
              <td className="py-2 pr-4 text-muted-foreground">
                {t(`tasks.status_${task.status}`)}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {t(`tasks.priority_${task.priority}`)}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {task.assignee?.display_name ?? t("tasks.unassigned")}
                {task.assignee?.kind === "agent" ? (
                  <AgentBadge className="ml-2" />
                ) : null}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {task.due_date ?? ""}
              </td>
              <td
                className="py-2"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="flex flex-wrap gap-1">
                  <AgentTriggerStub testId="list-agent-trigger" />
                  <SquadAssignStub testId="list-squad-assign" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
