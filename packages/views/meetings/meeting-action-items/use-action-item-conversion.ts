"use client";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api/http";
import { useConvertMeetingActionItems, type MeetingActionItem } from "@uniwork/core/meetings/action-items";
import { buildConvertActionItemsBody, summaryItemDraft } from "@uniwork/core/meetings/summary-task-items";
import { paths } from "@uniwork/core/paths";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { useOptionalNavigation } from "../../navigation";
import type { AiSummaryTaskDraft, AiSummaryTaskSeed } from "../../tasks/ai-summary-tasks-dialog";
import { errorItemIds, summaryErrorText } from "../meeting-summary/summary-error-copy";

/** Refusals after which the ticks no longer describe the list on screen. */
const STALE_SELECTION = new Set(["action_item_not_pending", "action_item_not_found"]);

const NONE: ReadonlySet<string> = new Set();

/** Ticks held by a screen that unmounts the list (the Copilot's sections). */
export type ActionItemSelection = [ReadonlySet<string>, Dispatch<SetStateAction<ReadonlySet<string>>>];

/**
 * Selection, review dialog and the convert call over a meeting's pending
 * action items. Ticks are item ids, so a list that changes under the clerk (a
 * regenerated summary, another clerk) keeps the ticks of items still pending
 * and silently drops the rest. It only mounts with a real workspace id:
 * every key the mutation refreshes is workspace-scoped.
 */
export function useActionItemConversion({
  workspaceId,
  meetingId,
  items,
  announce,
  selection,
}: {
  workspaceId: string;
  meetingId: string;
  items: readonly MeetingActionItem[];
  announce: (message: string) => void;
  selection?: ActionItemSelection;
}) {
  const { t, i18n } = useTranslation();
  const convert = useConvertMeetingActionItems(workspaceId, meetingId);
  const workspace = useOptionalWorkspace()?.workspace;
  const nav = useOptionalNavigation();
  const own = useState<ReadonlySet<string>>(NONE);
  const [picked, setPicked] = selection ?? own;
  const [dialogOpen, setDialogOpen] = useState(false);
  // The ids under review, fixed when the review opens: a seed's index is its
  // place here, so an item leaving the list cannot shift the drafts.
  const [review, setReview] = useState<readonly string[]>([]);
  // Items the last attempt refused as duplicates of an open task.
  const [duplicates, setDuplicates] = useState<ReadonlySet<string>>(NONE);

  const pickedPending = useMemo(
    () => items.filter((item) => item.status === "PENDING" && picked.has(item.id)),
    [items, picked],
  );
  const seeds = useMemo<AiSummaryTaskSeed[]>(
    () =>
      review.flatMap((id, index) => {
        const item = items.find((it) => it.id === id && it.status === "PENDING");
        return item
          ? [{ index, title: item.title, owner: item.owner_text, due: item.due_text, draft: summaryItemDraft(item) }]
          : [];
      }),
    [review, items],
  );
  const duplicateNote = t("meetings.summaryErrors.duplicateItemNote");
  const itemNotes = useMemo<Record<number, string> | undefined>(() => {
    if (duplicates.size === 0) return undefined;
    const notes: Record<number, string> = {};
    review.forEach((id, index) => {
      if (duplicates.has(id)) notes[index] = duplicateNote;
    });
    return notes;
  }, [duplicates, review, duplicateNote]);
  const wsPaths = workspace ? paths.workspace(workspace.organization_slug, workspace.slug) : null;

  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function openReview() {
    if (pickedPending.length === 0 || convert.isPending) return;
    setDuplicates(NONE);
    setReview(pickedPending.map((item) => item.id));
    setDialogOpen(true);
  }

  function submit(input: { projectId?: string; drafts: Record<number, AiSummaryTaskDraft> }) {
    const drafts = Object.fromEntries(
      review.flatMap((id, index) => (input.drafts[index] ? [[id, input.drafts[index]]] : [])),
    );
    const body = buildConvertActionItemsBody(items, new Set(review), drafts, input.projectId);
    if (!body || convert.isPending) return;
    announce(t("meetings.actionItemsSection.assigning"));
    setDuplicates(NONE);
    convert.mutate({ ...body, locale: i18n.language.startsWith("en") ? "en" : "vi" }, {
      onSuccess: (result) => {
        setDialogOpen(false);
        setPicked(NONE);
        // The outcome is said once, by the toast (sonner's live region); the
        // section's region only carried "assigning…".
        if (!result) {
          // The tasks may exist; the refetched list shows which. Never
          // report "0 tasks" for an answer that could not be read.
          toast.warning(t("meetings.summaryAi.createdUnknown"));
          return;
        }
        const count = result.links.length;
        const only = count === 1 ? result.links[0]?.task_id : undefined;
        toast.success(t("meetings.actionItemsSection.assignedStatus", { count }), {
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
        toast.error(summaryErrorText(err, t, "tasks", { items }));
        // A duplicate leaves the review open with the clashing items marked,
        // so the clerk chooses what to drop or move.
        if (code === "active_duplicate_task") setDuplicates(new Set(errorItemIds(err)));
        if (STALE_SELECTION.has(code)) {
          setDialogOpen(false);
          setPicked(NONE);
        }
      },
    });
  }

  return {
    picked,
    pickedPending,
    toggle,
    seeds,
    itemNotes,
    dialogOpen,
    setDialogOpen,
    openReview,
    submit,
    pending: convert.isPending,
  };
}
