"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api/http";
import { useCreateTasksFromSummary } from "@uniwork/core/meetings/summary";
import { buildMeetingSummaryTasksBody, isConvertedItem } from "@uniwork/core/meetings/summary-task-items";
import { paths } from "@uniwork/core/paths";
import type { MeetingSummary } from "@uniwork/core/types/meeting";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { useOptionalNavigation } from "../../navigation";
import type { AiSummaryTaskDraft } from "../../tasks/ai-summary-tasks-dialog";
import { summaryErrorText } from "./summary-error-copy";

/** Refusals after which the ticks no longer describe the summary on screen. */
const STALE_SELECTION = new Set(["summary_superseded", "summary_item_already_converted"]);

/**
 * Selection, review dialog and the create call for ONE summary. The caller
 * mounts it under `key={summary.id}`, so a regenerated summary (this host's
 * or another's, via realtime) starts clean instead of carrying ticks onto
 * items that now mean something else. It only mounts with a real workspace
 * id: every key the mutation refreshes is workspace-scoped.
 */
export function useSummaryTaskCreation({
  workspaceId,
  meetingId,
  summary,
  announce,
}: {
  workspaceId: string;
  meetingId: string;
  summary: MeetingSummary;
  announce: (message: string) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateTasksFromSummary(workspaceId, meetingId);
  const workspace = useOptionalWorkspace()?.workspace;
  const nav = useOptionalNavigation();
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

  const items = summary.action_items ?? [];
  // Only items still open count: one converted since the tick (here or by
  // another host) is no longer selectable, and the request skips it.
  const pickedOpen = items.filter((item) => picked.has(item.index) && !isConvertedItem(item));
  const wsPaths = workspace ? paths.workspace(workspace.organization_slug, workspace.slug) : null;

  function toggle(index: number, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  function openReview() {
    if (pickedOpen.length > 0 && !create.isPending) setDialogOpen(true);
  }

  function submit(input: { projectId?: string; drafts: Record<number, AiSummaryTaskDraft> }) {
    const body = buildMeetingSummaryTasksBody(summary.id, items, picked, input.drafts, input.projectId);
    if (!body || create.isPending) return;
    announce(t("meetings.summaryAi.creatingStatus"));
    create.mutate(body, {
      onSuccess: (result) => {
        setDialogOpen(false);
        setPicked(new Set());
        if (!result) {
          // The tasks may exist; the refetched summary marks which. Never
          // report "0 tasks created" for an answer that could not be read.
          const text = t("meetings.summaryAi.createdUnknown");
          announce(text);
          toast.warning(text);
          return;
        }
        const count = result.items.length || result.task_ids.length;
        const only = result.task_ids.length === 1 ? result.task_ids[0] : undefined;
        const text = t("meetings.tasksCreated", { count });
        announce(t("meetings.summaryAi.createdStatus", { count }));
        toast.success(text, {
          action:
            wsPaths && nav
              ? {
                  label: t("meetings.summaryAi.viewTasks", { count }),
                  onClick: () => nav.push(only ? wsPaths.task(only) : wsPaths.tasks()),
                }
              : undefined,
        });
      },
      onError: (err) => {
        const text = summaryErrorText(err, t, "tasks");
        announce(text);
        toast.error(text);
        if (STALE_SELECTION.has(errorCode(err) ?? "")) {
          setDialogOpen(false);
          setPicked(new Set());
        }
      },
    });
  }

  return {
    items,
    picked,
    pickedOpen,
    toggle,
    dialogOpen,
    setDialogOpen,
    openReview,
    submit,
    pending: create.isPending,
    taskHref: (taskId: string) => (wsPaths ? wsPaths.task(taskId) : null),
  };
}
