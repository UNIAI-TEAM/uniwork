"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetTaskParent, useTasks } from "@uniwork/core/tasks";
import type { Task } from "@uniwork/core/types";
import { toastApiError } from "../../../toast-api-error";
import {
  PickerEmpty,
  PickerItem,
  PropertyPicker,
  type PickerAnchor,
} from "../../pickers/property-picker";

/** Searchable parent picker the actions menu opens against its own button. */
export function TaskParentPicker({
  workspaceId,
  task,
  anchor,
  onClose,
}: {
  workspaceId: string;
  task: Task;
  anchor: PickerAnchor;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const tasksQuery = useTasks(workspaceId);
  const setParent = useSetTaskParent(workspaceId);
  const [query, setQuery] = useState("");
  const parentId = task.parent_task_id ?? null;

  const candidates = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return (tasksQuery.data ?? []).filter((candidate) => {
      if (candidate.id === task.id) return false;
      if (!q) return true;
      return `${candidate.identifier ?? ""} ${candidate.title}`.toLocaleLowerCase().includes(q);
    });
  }, [tasksQuery.data, query, task.id]);

  const select = (next: string | null) => {
    onClose();
    if (next === parentId) return;
    setParent.mutate(
      { taskId: task.id, body: { parent_task_id: next } },
      { onError: (err) => toastApiError(err, t("common.error")) },
    );
  };

  return (
    <PropertyPicker
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      anchor={anchor}
      trigger={null}
      width="w-72"
      align="end"
      searchable
      searchPlaceholder={t("tasks.create.parent_search_placeholder")}
      onSearchChange={setQuery}
    >
      {parentId ? (
        <PickerItem emptyValue selected={false} onClick={() => select(null)}>
          <span className="text-muted-foreground">{t("tasks.detail.parent_none")}</span>
        </PickerItem>
      ) : null}
      {candidates.map((candidate) => (
        <PickerItem
          key={candidate.id}
          selected={candidate.id === parentId}
          onClick={() => select(candidate.id)}
        >
          <span className="shrink-0 text-muted-foreground">
            {candidate.identifier || candidate.id}
          </span>
          <span className="truncate">{candidate.title}</span>
        </PickerItem>
      ))}
      {candidates.length === 0 ? (
        <PickerEmpty>{t("tasks.create.options_no_results")}</PickerEmpty>
      ) : null}
    </PropertyPicker>
  );
}
