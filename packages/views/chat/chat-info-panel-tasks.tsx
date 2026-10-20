"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatRoomLinkedTasks } from "@uniwork/core/chat";
import { cn } from "@uniwork/ui/lib/utils";
import { ChatInfoLink, ChatInfoSection } from "./chat-info-panel-parts";
import { formatTaskDue, linkedTaskLine } from "./chat-info-panel-utils";
import { ChatTaskPeekDialog } from "./chat-task-peek-dialog";

/** Tasks shown before "Xem N". */
const TASK_PREVIEW = 3;

const DOT = { done: "bg-success-solid", overdue: "bg-destructive-solid", open: "bg-primary" } as const;

/**
 * "Việc từ cuộc trò chuyện": tasks made from or linked to this room's
 * messages, newest link first, each opening in the task peek.
 */
export function ChatInfoTasks({ workspaceId, roomId }: { workspaceId: string; roomId: string }) {
  const { t, i18n } = useTranslation();
  const { data } = useChatRoomLinkedTasks(workspaceId, roomId);
  const [all, setAll] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const tasks = data?.tasks ?? [];
  const total = Math.max(data?.total ?? 0, tasks.length);
  const shown = all ? tasks : tasks.slice(0, TASK_PREVIEW);

  return (
    <ChatInfoSection
      title={t("chat.info_panel.tasks_title")}
      action={
        tasks.length > TASK_PREVIEW ? (
          <ChatInfoLink expanded={all} onClick={() => setAll((value) => !value)}>
            {all ? t("chat.info_panel.show_less") : t("chat.info_panel.view_count", { count: total })}
          </ChatInfoLink>
        ) : null
      }
    >
      {tasks.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("chat.info_panel.tasks_empty")}</p>
      ) : (
        <ul className="-mx-2 -my-1">
          {shown.map((task) => {
            const line = linkedTaskLine(task);
            const who = task.assignee_name?.trim();
            const state =
              line.tone === "done"
                ? t("chat.info_panel.task_done")
                : line.tone === "overdue"
                  ? t("chat.info_panel.task_overdue", { count: line.days })
                  : line.due
                    ? t("chat.info_panel.task_due", { date: formatTaskDue(line.due, i18n.language) })
                    : t(`tasks.status_${task.status}`, { defaultValue: task.status });
            return (
              <li key={task.id}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-surface-hover"
                  onClick={() => setPeekId(task.id)}
                >
                  <span aria-hidden className={cn("size-2.25 shrink-0 rounded-full", DOT[line.tone])} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body text-foreground">{task.title}</span>
                    <span
                      className={cn(
                        "truncate text-caption",
                        line.tone === "overdue" ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {who ? `${who} · ${state}` : state}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {peekId ? (
        <ChatTaskPeekDialog
          open
          onOpenChange={(open) => {
            if (!open) setPeekId(null);
          }}
          workspaceId={workspaceId}
          taskId={peekId}
        />
      ) : null}
    </ChatInfoSection>
  );
}
