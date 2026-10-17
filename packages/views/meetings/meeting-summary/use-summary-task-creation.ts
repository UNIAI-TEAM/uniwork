"use client";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
import { errorIndexes, summaryErrorText } from "./summary-error-copy";

/** Refusals after which the ticks no longer describe the summary on screen. */
const STALE_SELECTION = new Set(["summary_superseded", "summary_item_already_converted"]);

const NONE: ReadonlySet<number> = new Set();

/** The ticked items of one summary. Ticks made on another summary read as none. */
export interface SummarySelection {
  summaryId: string;
  picked: ReadonlySet<number>;
}

/** A selection held by a screen that outlives the list (the Copilot's section tabs). */
export type SummarySelectionState = [
  SummarySelection | null,
  Dispatch<SetStateAction<SummarySelection | null>>,
];

/**
 * Selection, review dialog and the create call for ONE summary at a time.
 * Every piece of state is tagged with the summary id it was made on, so a
 * regenerated summary (this host's or another's, via realtime) starts clean
 * instead of carrying ticks onto items that now mean something else, while
 * the list and its call to action stay mounted: the focus the dialog hands
 * back on close still has somewhere to land. A screen that unmounts the list
 * (the Copilot's sections) passes `selection` to keep the ticks. It only
 * mounts with a real workspace id: every key the mutation refreshes is
 * workspace-scoped.
 */
export function useSummaryTaskCreation({
  workspaceId,
  meetingId,
  summary,
  announce,
  selection: lifted,
}: {
  workspaceId: string;
  meetingId: string;
  summary: MeetingSummary;
  announce: (message: string) => void;
  selection?: SummarySelectionState;
}) {
  const { t } = useTranslation();
  const create = useCreateTasksFromSummary(workspaceId, meetingId);
  const workspace = useOptionalWorkspace()?.workspace;
  const nav = useOptionalNavigation();
  const own = useState<SummarySelection | null>(null);
  const [selection, setSelection] = lifted ?? own;
  // The summary the review dialog was opened on: a newer one closes it.
  const [dialogFor, setDialogFor] = useState<string | null>(null);
  // Items the last attempt refused as duplicates of an open task.
  const [duplicates, setDuplicates] = useState<SummarySelection | null>(null);

  const picked = selection?.summaryId === summary.id ? selection.picked : NONE;
  const dialogOpen = dialogFor === summary.id;
  const duplicateIndexes = duplicates?.summaryId === summary.id ? duplicates.picked : NONE;
  const items = summary.action_items ?? [];

  // A summary replaced under the host drops their ticks and closes the review
  // with its edits; say so instead of letting them vanish.
  const shownSummary = useRef(summary.id);
  useEffect(() => {
    const previous = shownSummary.current;
    if (previous === summary.id) return;
    shownSummary.current = summary.id;
    const hadWork = dialogFor === previous || (selection?.summaryId === previous && selection.picked.size > 0);
    if (hadWork) announce(t("meetings.summaryErrors.summary_superseded"));
  }, [summary.id, dialogFor, selection, announce, t]);

  // Only items still open count: one converted since the tick (here or by
  // another host) is no longer selectable, and the request skips it.
  const pickedOpen = items.filter((item) => picked.has(item.index) && !isConvertedItem(item));
  const wsPaths = workspace ? paths.workspace(workspace.organization_slug, workspace.slug) : null;

  function toggle(index: number, on: boolean) {
    setSelection((prev) => {
      const next = new Set(prev?.summaryId === summary.id ? prev.picked : NONE);
      if (on) next.add(index);
      else next.delete(index);
      return { summaryId: summary.id, picked: next };
    });
  }

  function clearPicked() {
    setSelection(null);
  }

  function setDialogOpen(open: boolean) {
    setDialogFor(open ? summary.id : null);
  }

  function openReview() {
    if (pickedOpen.length === 0 || create.isPending) return;
    setDuplicates(null);
    setDialogOpen(true);
  }

  function submit(input: { projectId?: string; drafts: Record<number, AiSummaryTaskDraft> }) {
    const body = buildMeetingSummaryTasksBody(summary.id, items, picked, input.drafts, input.projectId);
    if (!body || create.isPending) return;
    announce(t("meetings.summaryAi.creatingStatus"));
    setDuplicates(null);
    create.mutate(body, {
      onSuccess: (result) => {
        setDialogOpen(false);
        clearPicked();
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
        const code = errorCode(err) ?? "";
        const text = summaryErrorText(err, t, "tasks", { items });
        announce(text);
        toast.error(text);
        if (code === "active_duplicate_task") {
          // Nothing is unticked for the host: the review stays open with the
          // clashing items marked, so they choose what to drop or move.
          setDuplicates({ summaryId: summary.id, picked: new Set(errorIndexes(err)) });
        }
        if (STALE_SELECTION.has(code)) {
          setDialogOpen(false);
          clearPicked();
        }
      },
    });
  }

  return {
    items,
    picked,
    pickedOpen,
    toggle,
    duplicateIndexes,
    dialogOpen,
    setDialogOpen,
    openReview,
    submit,
    pending: create.isPending,
    taskHref: (taskId: string) => (wsPaths ? wsPaths.task(taskId) : null),
  };
}
