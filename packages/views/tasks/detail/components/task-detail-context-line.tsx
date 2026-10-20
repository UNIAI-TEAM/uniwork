"use client";

import { CircleCheck, CircleDot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeeting } from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { useChildTaskProgress, useTask } from "@uniwork/core/tasks";
import type { Task } from "@uniwork/core/types";
import { MODULE_ICONS } from "../../../layout/module-icons";
import { useWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";
import { formatInstantDate } from "../../../people/person-facts";

const MeetingIcon = MODULE_ICONS.meetings;

/** "From meeting: {title} · {day}" for a task the meeting summary created (spec §9.4). */
function TaskMeetingOrigin({ meetingId }: { meetingId: string }) {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const meeting = useMeeting(meetingId);

  if (meeting.isPending) return null;
  if (!meeting.data) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <MeetingIcon className="size-3.5 shrink-0" aria-hidden />
        {t("tasks.detail.meeting_gone")}
      </span>
    );
  }
  // Always with the year: a meeting from last year must not read as this year.
  const date = formatInstantDate(meeting.data.starts_at, i18n.language);
  return (
    <AppLink
      href={paths.workspace(workspace.organization_slug, workspace.slug).meeting(meeting.data.id)}
      className="inline-flex min-w-0 items-center gap-1.5 hover:text-foreground"
    >
      <MeetingIcon className="size-3.5 shrink-0" aria-hidden />
      <span className="max-w-96 truncate">
        {t("tasks.detail.from_meeting", { title: meeting.data.title, date })}
      </span>
    </AppLink>
  );
}

export function TaskDetailContextLine({ workspaceId, task }: { workspaceId: string; task: Task }) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const parent = useTask(task.parent_task_id ?? "");
  const progress = useChildTaskProgress(workspaceId);
  const row = (progress.data ?? []).find((item) => item.parent_task_id === task.id);
  const total = row?.total ?? 0;
  const done = row?.done ?? 0;

  const meetingId = task.origin_type === "meeting" ? task.origin_id : null;

  if (!task.parent_task_id && total === 0 && !meetingId) return null;

  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
      {task.parent_task_id ? (
        parent.data ? (
          <AppLink
            href={paths.workspace(workspace.organization_slug, workspace.slug).task(parent.data.id)}
            className="inline-flex min-w-0 items-center gap-1.5 hover:text-foreground"
          >
            <CircleDot className="size-3.5 shrink-0 text-success" aria-hidden />
            <span className="shrink-0">{t("tasks.detail.child_of")}</span>
            <span className="max-w-80 truncate font-medium text-foreground">
              {parent.data.identifier} {parent.data.title}
            </span>
          </AppLink>
        ) : null
      ) : null}
      {meetingId ? <TaskMeetingOrigin meetingId={meetingId} /> : null}
      {total > 0 ? (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <CircleCheck className="size-3.5" aria-hidden />
          {t("tasks.detail.subtasks_progress", { done, total })}
        </span>
      ) : null}
    </div>
  );
}
