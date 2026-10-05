"use client";

import type { SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Task } from "@uniwork/core/types";
import { useWorkspaceAssigneeOptions } from "./pickers";
import { AssigneePicker, type AssigneeRef } from "./pickers/assignee-picker";
import type { PickerAnchor } from "./pickers/property-picker";

type TaskUpdates = Record<string, unknown>;

const stopRowEvent = (event: SyntheticEvent) => event.stopPropagation();

/** A zero-size anchor at a viewport point, e.g. where a right click landed. */
export function pointAnchor(x: number, y: number): PickerAnchor {
  return {
    getBoundingClientRect: () => ({
      x,
      y,
      left: x,
      top: y,
      right: x,
      bottom: y,
      width: 0,
      height: 0,
    }),
  };
}

function taskAssigneeRef(task: Task): AssigneeRef | null {
  if (!task.assignee_id) return null;
  return { id: task.assignee_id, kind: task.assignee_kind === "agent" ? "agent" : "human" };
}

/**
 * The shared assignee picker, opened from a row action ("Người phụ trách" in
 * the context menu or the "more" dropdown) instead of from a trigger. Mount it
 * only while open, so idle rows do not each subscribe to members and agents.
 */
export function RowAssigneePicker({
  task,
  onUpdate,
  anchor,
  onClose,
}: {
  task: Task;
  onUpdate: (updates: TaskUpdates) => void;
  anchor: PickerAnchor;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { options, isLoading, isError } = useWorkspaceAssigneeOptions(task.workspace_id);
  const listMessage = isLoading
    ? t("tasks.row_actions.assignees_loading")
    : isError
      ? t("tasks.row_actions.assignees_failed")
      : undefined;

  return (
    <AssigneePicker
      value={taskAssigneeRef(task)}
      options={options}
      // ADR 0007: id and kind always travel together, unassign included.
      onChange={(ref) =>
        onUpdate(
          ref
            ? { assignee_id: ref.id, assignee_kind: ref.kind }
            : { assignee_id: null, assignee_kind: "human" },
        )
      }
      ariaLabel={t("tasks.row_actions.change_assignee")}
      unassignedLabel={t("tasks.unassigned")}
      searchPlaceholder={t("tasks.assignee_search_placeholder")}
      noResultsLabel={t("tasks.assignee_no_results")}
      listMessage={listMessage}
      onTriggerNavigationGuard={stopRowEvent}
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      anchor={anchor}
    />
  );
}
