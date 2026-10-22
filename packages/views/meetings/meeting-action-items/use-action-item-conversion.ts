"use client";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api/http";
import { useConvertMeetingActionItems, type MeetingActionItem } from "@uniwork/core/meetings/action-items";
import { useMeetingEvidenceOf } from "@uniwork/core/meetings/summary";
import { actionItemTaskDefaults, convertActionItemInput } from "@uniwork/core/meetings/summary-task-items";
import { paths } from "@uniwork/core/paths";
import type { CreateTaskBody } from "@uniwork/core/tasks";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { useOptionalNavigation } from "../../navigation";
import { sameName } from "../../tasks/ai-summary-tasks-dialog";
import type { CreateTaskSubmitter } from "../../tasks/use-create-task-manual";
import { meetingLocale } from "../meeting-datetime";
import { summaryErrorText } from "../meeting-summary/summary-error-copy";
import { actionItemTaskDescription } from "./action-item-task-description";

/** Refusals after which the item is no longer the clerk's to convert: the composer moves past it. */
const STALE_SELECTION = new Set(["action_item_not_pending", "action_item_not_found"]);

const NONE: ReadonlySet<string> = new Set();

/** Ticks held by a screen that unmounts the list (the Copilot's sections). */
export type ActionItemSelection = [ReadonlySet<string>, Dispatch<SetStateAction<ReadonlySet<string>>>];

/**
 * Selection over a meeting's pending action items, and the task screen's
 * composer going through the ticked ones in turn: each opens prefilled, and
 * creating it converts that item alone (its task, link and audit in one
 * transaction) before the next one opens. Ticks are item ids, so a list that
 * changes under the clerk (a regenerated summary, another clerk) keeps the
 * ticks of items still pending, and an item handled elsewhere is skipped. It
 * only mounts with a real workspace id: every key the mutation refreshes is
 * workspace-scoped.
 */
export function useActionItemConversion({
  workspaceId,
  meetingId,
  projectId,
  items,
  announce,
  selection,
  nameOf,
}: {
  workspaceId: string;
  meetingId: string;
  /** The meeting's project, while it still exists: each task starts there. */
  projectId?: string;
  items: readonly MeetingActionItem[];
  announce: (message: string) => void;
  selection?: ActionItemSelection;
  /** A member's display name, to say the spoken owner only when it is someone else. */
  nameOf: (userId: string | null | undefined) => string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const convert = useConvertMeetingActionItems(workspaceId, meetingId);
  const workspace = useOptionalWorkspace()?.workspace;
  const nav = useOptionalNavigation();
  const own = useState<ReadonlySet<string>>(NONE);
  const [picked, setPicked] = selection ?? own;
  const [dialogOpen, setDialogOpen] = useState(false);
  // The ids the composer goes through, fixed when it opens, and those it is past.
  const [review, setReview] = useState<readonly string[]>([]);
  const [past, setPast] = useState<ReadonlySet<string>>(NONE);

  const pickedPending = useMemo(
    () => items.filter((item) => item.status === "PENDING" && picked.has(item.id)),
    [items, picked],
  );
  const queued = useMemo(
    () => review.flatMap((id) => items.find((it) => it.id === id && it.status === "PENDING") ?? []),
    [review, items],
  );
  const current = queued.find((item) => !past.has(item.id));
  // Every queued item's cited lines are read before the composer opens, so
  // each one opens whole and the next never waits.
  const evidence = useMeetingEvidenceOf(meetingId, queued, dialogOpen);
  const ready = evidence.settled;
  // The composer resets whenever its defaults change: they change with the
  // item, never with a refetch of the same one.
  const [shown, setShown] = useState<{ id: string; defaults: Partial<CreateTaskBody> } | null>(null);
  if (current && ready && shown?.id !== current.id) {
    const lines = evidence.lines[queued.indexOf(current)] ?? [];
    const description = actionItemTaskDescription(current, lines, t, meetingLocale(i18n.language));
    setShown({ id: current.id, defaults: actionItemTaskDefaults(current, projectId, description) });
  }
  // Everything is done or was handled elsewhere: the composer has nothing left to show.
  if (dialogOpen && !current) setDialogOpen(false);
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
    setPast(NONE);
    setReview(pickedPending.map((item) => item.id));
    setDialogOpen(true);
  }

  function moveOn(id: string) {
    setPast((prev) => new Set(prev).add(id));
    setPicked((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function submit(body: CreateTaskBody): Promise<void> {
    const item = current;
    if (!item || convert.isPending) return;
    announce(t("meetings.actionItemsSection.assigning"));
    try {
      const result = await convert.mutateAsync({
        items: [convertActionItemInput(item.id, body)],
        locale: i18n.language.startsWith("en") ? "en" : "vi",
      });
      moveOn(item.id);
      // The outcome is said once, by the toast (sonner's live region); the
      // section's region only carried "assigning…".
      if (!result) {
        // The task may exist; the refetched list shows whether it does.
        toast.warning(t("meetings.summaryAi.createdUnknown"));
        return;
      }
      const taskId = result.links[0]?.task_id;
      toast.success(t("meetings.actionItemsSection.assignedStatus", { count: 1 }), {
        action:
          wsPaths && nav && taskId
            ? { label: t("meetings.summaryAi.viewTasks", { count: 1 }), onClick: () => nav.push(wsPaths.task(taskId)) }
            : undefined,
      });
    } catch (err) {
      if (STALE_SELECTION.has(errorCode(err) ?? "")) moveOn(item.id);
      throw err;
    }
  }

  const submitter: CreateTaskSubmitter = {
    submit,
    pending: convert.isPending,
    // A duplicate title gets the task screen's own toast, which opens the open task.
    errorText: (err) =>
      errorCode(err) === "active_duplicate_task" ? undefined : summaryErrorText(err, t, "tasks", { items }),
  };

  const at = current ? review.indexOf(current.id) + 1 : 0;
  const owner = current?.owner_text?.trim();
  const due = current?.due_text?.trim();
  const hint = [
    owner && !sameName(owner, nameOf(current?.suggested_assignee_id))
      ? t("meetings.actionItemsSection.suggestedOwner", { name: owner })
      : null,
    due ? t("meetings.actionItemsSection.spokenDue", { due }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    picked,
    pickedPending,
    toggle,
    dialogOpen: dialogOpen && Boolean(current) && shown?.id === current?.id,
    setDialogOpen,
    openReview,
    submitter,
    defaults: shown?.defaults,
    heading: t("meetings.actionItemsSection.composerStep", { at, total: review.length }),
    hint: hint || undefined,
    // Also while the cited lines are read: the assign button says it is busy.
    pending: convert.isPending || (dialogOpen && !ready),
  };
}
