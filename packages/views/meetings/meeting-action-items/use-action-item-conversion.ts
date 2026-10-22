"use client";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api/http";
import {
  useAddMeetingActionItem,
  useConvertMeetingActionItems,
  type MeetingActionItem,
} from "@uniwork/core/meetings/action-items";
import { useMeetingEvidenceOf } from "@uniwork/core/meetings/summary";
import { actionItemTaskDefaults, convertActionItemInput } from "@uniwork/core/meetings/summary-task-items";
import { paths } from "@uniwork/core/paths";
import type { CreateTaskBody } from "@uniwork/core/tasks";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { useOptionalNavigation } from "../../navigation";
import type { CreateTaskSubmitter } from "../../tasks/use-create-task-manual";
import { meetingLocale } from "../meeting-datetime";
import { summaryErrorText } from "../meeting-summary/summary-error-copy";
import { actionItemTaskDescription } from "./action-item-task-description";

/** Refusals after which the ticks no longer describe the list on screen. */
const STALE_SELECTION = new Set(["action_item_not_pending", "action_item_not_found"]);

const NONE: ReadonlySet<string> = new Set();

/** Ticks held by a screen that unmounts the list (the Copilot's sections). */
export type ActionItemSelection = [ReadonlySet<string>, Dispatch<SetStateAction<ReadonlySet<string>>>];

/**
 * Selection over a meeting's pending action items and the two ways a task
 * comes out of them. "Assign" turns every ticked item into a task at once,
 * on the meeting's own suggestions (who, when, priority, the AI's prose and
 * cited lines, the project) in one transaction; what needs changing is
 * changed on the task. "Add task" opens the task screen's composer; creating
 * there files a hand-added item and converts it. Ticks are item ids, so a
 * list that changes under the clerk keeps the ticks of items still pending.
 * It only mounts with a real workspace id: every key the mutations refresh
 * is workspace-scoped.
 */
export function useActionItemConversion({
  workspaceId,
  meetingId,
  projectId,
  items,
  announce,
  selection,
}: {
  workspaceId: string;
  meetingId: string;
  /** The meeting's project, while it still exists: each task starts there. */
  projectId?: string;
  items: readonly MeetingActionItem[];
  announce: (message: string) => void;
  selection?: ActionItemSelection;
}) {
  const { t, i18n } = useTranslation();
  const convert = useConvertMeetingActionItems(workspaceId, meetingId);
  const add = useAddMeetingActionItem(meetingId);
  const workspace = useOptionalWorkspace()?.workspace;
  const nav = useOptionalNavigation();
  const own = useState<ReadonlySet<string>>(NONE);
  const [picked, setPicked] = selection ?? own;
  const [addOpen, setAddOpen] = useState(false);

  const pickedPending = useMemo(
    () => items.filter((item) => item.status === "PENDING" && picked.has(item.id)),
    [items, picked],
  );
  // The ticked items' cited lines are read as they are ticked, so assigning never waits for them.
  const evidence = useMeetingEvidenceOf(meetingId, pickedPending, pickedPending.length > 0);
  const wsPaths = workspace ? paths.workspace(workspace.organization_slug, workspace.slug) : null;
  const locale = i18n.language.startsWith("en") ? "en" : "vi";

  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function report(count: number, taskId: string | undefined) {
    // The outcome is said once, by the toast (sonner's live region); the
    // section's region only carried "assigning…".
    toast.success(t("meetings.actionItemsSection.assignedStatus", { count }), {
      action:
        wsPaths && nav
          ? {
              label: t("meetings.summaryAi.viewTasks", { count }),
              onClick: () => nav.push(taskId ? wsPaths.task(taskId) : wsPaths.tasks()),
            }
          : undefined,
    });
  }

  function assign() {
    if (pickedPending.length === 0 || convert.isPending || !evidence.settled) return;
    announce(t("meetings.actionItemsSection.assigning"));
    const body = pickedPending.map((item, i) => {
      const description = actionItemTaskDescription(item, evidence.lines[i] ?? [], t, meetingLocale(i18n.language));
      return convertActionItemInput(item.id, { title: item.title, ...actionItemTaskDefaults(item, projectId, description) });
    });
    convert.mutate(
      { items: body, locale },
      {
        onSuccess: (result) => {
          setPicked(NONE);
          if (!result) {
            // The tasks may exist; the refetched list shows which. Never
            // report "0 tasks" for an answer that could not be read.
            toast.warning(t("meetings.summaryAi.createdUnknown"));
            return;
          }
          report(result.links.length, result.links.length === 1 ? result.links[0]?.task_id : undefined);
        },
        onError: (err) => {
          // A duplicate names the clashing items, so the clerk unticks them.
          toast.error(summaryErrorText(err, t, "tasks", { items }));
          if (STALE_SELECTION.has(errorCode(err) ?? "")) setPicked(NONE);
        },
      },
    );
  }

  // The composer's task: a hand-added item, converted with what was typed.
  // A convert refused after the add leaves the item pending, where the list
  // shows it and "Assign" finishes the job.
  const submitter: CreateTaskSubmitter = {
    async submit(body: CreateTaskBody) {
      const item = await add.mutateAsync({ title: body.title });
      if (!item) {
        toast.warning(t("meetings.summaryAi.createdUnknown"));
        setAddOpen(false);
        return;
      }
      const result = await convert.mutateAsync({ items: [convertActionItemInput(item.id, body)], locale });
      setAddOpen(false);
      if (!result) {
        toast.warning(t("meetings.summaryAi.createdUnknown"));
        return;
      }
      report(1, result.links[0]?.task_id);
    },
    pending: add.isPending || convert.isPending,
    // A duplicate title gets the task screen's own toast, which opens the open task.
    errorText: (err) => (errorCode(err) === "active_duplicate_task" ? undefined : summaryErrorText(err, t, "tasks", { items })),
  };

  return {
    picked,
    pickedPending,
    toggle,
    assign,
    addOpen,
    setAddOpen,
    submitter,
    addDefaults: useMemo<Partial<CreateTaskBody>>(() => ({ project_id: projectId || null }), [projectId]),
    // Also while the ticked items' lines are read: the assign button says it is busy.
    pending: convert.isPending || (pickedPending.length > 0 && !evidence.settled),
  };
}
