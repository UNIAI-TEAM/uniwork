"use client";

import { useId, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import {
  useChildTaskProgress,
  useTask,
  useTaskChildren,
  useTaskProperties,
  type CreateTaskBody,
} from "@uniwork/core/tasks";
import { useSubtaskDisplayStore } from "@uniwork/core/tasks/stores/subtask-display-store";
import {
  useSubtasksCollapsed,
  useTaskDetailUiStore,
} from "@uniwork/core/tasks/stores/task-detail-ui-store";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../../../layout/workspace-context";
import { CreateTaskDialog } from "../../create-task-dialog";
import { useWorkspaceAssigneeOptions } from "../../pickers";
import {
  TaskSurfaceSelectionProvider,
  useCreateTaskSurfaceSelection,
  useTaskSurfaceSelectedIds,
} from "../../surface/selection-context";
import { BatchActionToolbar } from "../../views/batch-action-toolbar";
import { SubtaskRow } from "./subtask-row";

export function TaskDetailSubtasksSection({
  workspaceId,
  taskId,
}: {
  workspaceId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { data: children = [], isLoading } = useTaskChildren(taskId);
  const { data: progressRows = [] } = useChildTaskProgress(workspaceId);
  const propertyCatalog = useTaskProperties(workspaceId).data?.properties ?? [];
  const { data: parent } = useTask(taskId);
  const [creating, setCreating] = useState(false);
  // A sub-task lives in its parent's project; the server does not inherit it.
  // Until the parent loads, the form's own project default stands.
  const parentProjectId = parent ? parent.project_id ?? null : undefined;
  const createDefaults = useMemo<Partial<CreateTaskBody>>(
    () =>
      parentProjectId === undefined
        ? { parent_task_id: taskId }
        : { parent_task_id: taskId, project_id: parentProjectId },
    [taskId, parentProjectId],
  );
  const selection = useCreateTaskSurfaceSelection(
    `${taskId}:${children.map((child) => child.id).join(",")}`,
  );
  const selected = useTaskSurfaceSelectedIds(selection.store);
  const { options: assigneeOptions } = useWorkspaceAssigneeOptions(workspaceId);
  const members = useMemo(
    () =>
      assigneeOptions
        .filter((option) => option.kind === "human")
        .map((option) => ({ id: option.id, name: option.name })),
    [assigneeOptions],
  );
  const fields = useSubtaskDisplayStore((state) => state.fields);
  const toggleField = useSubtaskDisplayStore((state) => state.toggle);
  const collapsed = useSubtasksCollapsed(taskId);
  const regionId = useId();
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const progress = progressRows.find((row) => row.parent_task_id === taskId);
  const done =
    progress?.done ?? children.filter((child) => child.status === "done").length;
  const total = progress?.total ?? children.length;
  const hasStage = children.some((child) => child.stage != null);
  const groups = useMemo(() => {
    const map = new Map<number | null, typeof children>();
    for (const child of children) {
      const stage = child.stage ?? null;
      map.set(stage, [...(map.get(stage) ?? []), child]);
    }
    return [...map.entries()].sort(([a], [b]) =>
      a === null ? 1 : b === null ? -1 : a - b,
    );
  }, [children]);
  const allSelected = children.length > 0 && selected.size === children.length;

  const createDialog = creating ? (
    <CreateTaskDialog
      workspaceId={workspaceId}
      defaults={createDefaults}
      open
      onOpenChange={setCreating}
      showTrigger={false}
    />
  ) : null;

  // The dialog keeps the same slot in both returns, so the first sub-task
  // (empty state → list) does not remount it mid "create another".
  if (!isLoading && children.length === 0) {
    return (
      <>
        <section aria-label={t("tasks.detail.section_subtasks")} className="mt-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-0 text-caption text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden className="size-3.5" />
            {t("tasks.detail.add_subtask")}
          </Button>
        </section>
        {createDialog}
      </>
    );
  }

  return (
    <>
    <TaskSurfaceSelectionProvider selection={selection}>
      <section
        aria-label={t("tasks.detail.section_subtasks")}
        className={cn(children.length > 0 ? "mt-10 group/subtasks" : "mt-6")}
      >
      {children.length > 0 ? (
        <div className="mb-2 flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-0 hover:bg-transparent"
            aria-expanded={!collapsed}
            aria-controls={regionId}
            aria-label={t("tasks.detail.subtasks_toggle")}
            onClick={() =>
              useTaskDetailUiStore
                .getState()
                .setSubtasksCollapsed(taskId, !collapsed)
            }
          >
            <Chevron aria-hidden className="size-3.5 text-muted-foreground" />
            <h2 className="text-body font-medium text-foreground">
              {t("tasks.detail.section_subtasks")}
            </h2>
          </Button>
          <span
            data-testid="subtasks-progress"
            className="inline-flex items-center rounded-full bg-muted/60 px-2 py-0.5 text-micro font-medium tabular-nums text-muted-foreground"
          >
            {t("tasks.detail.subtasks_progress", { done, total })}
          </span>
          <input
            type="checkbox"
            checked={allSelected}
            ref={(element) => {
              if (element) {
                element.indeterminate = selected.size > 0 && !allSelected;
              }
            }}
            onChange={(event) =>
              event.target.checked
                ? selection.select(children.map((child) => child.id))
                : selection.clear()
            }
            aria-label={t("tasks.detail.subtask_select_all")}
            className={cn(
              "ml-1 cursor-pointer accent-primary transition-opacity",
              selected.size > 0
                ? "opacity-100"
                : "opacity-0 group-hover/subtasks:opacity-100 focus-visible:opacity-100",
            )}
          />
          <div className="ml-auto flex items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("tasks.detail.subtask_display_settings")}
                  />
                }
              >
                <SlidersHorizontal aria-hidden className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuCheckboxItem
                  checked={fields.priority}
                  onCheckedChange={() => toggleField("priority")}
                >
                  {t("tasks.priority")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={fields.labels}
                  onCheckedChange={() => toggleField("labels")}
                >
                  {t("tasks.detail.prop_labels")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={fields.progress}
                  onCheckedChange={() => toggleField("progress")}
                >
                  {t("tasks.detail.subtasks_progress_label")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={fields.dueDate}
                  onCheckedChange={() => toggleField("dueDate")}
                >
                  {t("tasks.due_date")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={fields.assignee}
                  onCheckedChange={() => toggleField("assignee")}
                >
                  {t("tasks.assignee")}
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("tasks.detail.add_subtask")}
              onClick={() => setCreating(true)}
            >
              <Plus aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}

      <div id={regionId} hidden={collapsed}>
        <BatchActionToolbar
          workspaceId={workspaceId}
          tasks={children}
          placement="inline"
          members={members}
        />
        {isLoading ? (
          <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
        ) : children.length > 0 ? (
          <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card/30">
            {groups.map(([stage, stageChildren]) => (
              <div key={stage ?? "none"}>
                {hasStage ? (
                  <h3 className="bg-muted/40 px-3 py-1 text-micro font-medium uppercase tracking-wider text-muted-foreground">
                    {stage === null
                      ? t("tasks.detail.stage_none")
                      : t("tasks.detail.stage_group", { stage })}
                  </h3>
                ) : null}
                <ul className="divide-y divide-border/60">
                  {stageChildren.map((child) => (
                    <SubtaskRow
                      key={child.id}
                      task={child}
                      workspaceId={workspaceId}
                      href={paths
                        .workspace(workspace.organization_slug, workspace.slug)
                        .task(child.id)}
                      selected={selected.has(child.id)}
                      onSelect={(checked) =>
                        checked
                          ? selection.select([child.id])
                          : selection.deselect([child.id])
                      }
                      show={fields}
                      childProgress={progressRows.find(
                        (row) => row.parent_task_id === child.id,
                      )}
                      propertyCatalog={propertyCatalog}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
        </div>
      </section>
    </TaskSurfaceSelectionProvider>
    {createDialog}
    </>
  );
}
