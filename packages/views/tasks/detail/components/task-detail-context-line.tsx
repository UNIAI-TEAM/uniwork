"use client";

import { CircleCheck, CircleDot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useMeeting } from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { useChildTaskProgress, useTask } from "@uniwork/core/tasks";
import type { Task } from "@uniwork/core/types";
import { tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { shortDateFormat } from "../../../common/date-pill";
import { MODULE_ICONS } from "../../../layout/module-icons";
import { moduleTone } from "../../../layout/module-tones";
import { useWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";

const MeetingIcon = MODULE_ICONS.meetings;
const MEETING_ICON_CLASS = cn("size-3.5 shrink-0", tintForegroundClass[moduleTone("meetings")]);

/** Why the meeting cannot be shown: deleted, not yours to see, or not read at all (offline, a 5xx). */
function unavailableKey(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return "tasks.detail.meeting_gone";
  if (error instanceof ApiError && error.status === 403) return "tasks.detail.meeting_forbidden";
  return "tasks.detail.meeting_unavailable";
}

/**
 * "From meeting {title} · {day}" for a task the meeting summary created (spec
 * §9.4), in the parent line's shape: a muted label, the name in medium weight
 * (the part that gives way), and the date in the task page's short format.
 */
function TaskMeetingOrigin({ meetingId }: { meetingId: string }) {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const meeting = useMeeting(meetingId);

  // The line keeps its place while the meeting loads, so the header does not jump.
  if (meeting.isPending) return <Skeleton aria-hidden className="h-4 w-56 max-w-full" />;
  if (!meeting.data) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <MeetingIcon className={MEETING_ICON_CLASS} aria-hidden />
        {t(unavailableKey(meeting.error))}
      </span>
    );
  }
  const start = new Date(meeting.data.starts_at);
  const date = Number.isNaN(start.getTime())
    ? ""
    : start.toLocaleDateString(i18n.language, shortDateFormat(String(start.getFullYear())));
  return (
    <AppLink
      href={paths.workspace(workspace.organization_slug, workspace.slug).meeting(meeting.data.id)}
      className="inline-flex min-w-0 items-center gap-1.5 hover:text-foreground"
    >
      <MeetingIcon className={MEETING_ICON_CLASS} aria-hidden />
      <span className="shrink-0">{t("tasks.detail.from_meeting")}</span>
      <span className="min-w-0 max-w-80 truncate font-medium text-foreground">{meeting.data.title}</span>
      {date ? <span className="shrink-0 tabular-nums">{`· ${date}`}</span> : null}
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
