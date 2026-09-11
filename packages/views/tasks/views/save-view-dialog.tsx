"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useCreateTaskView,
  usePatchTaskView,
} from "@uniwork/core/tasks";
import {
  mergeViewStatePersisted,
  viewStoreSlice,
  type TaskViewState,
} from "@uniwork/core/tasks/stores/view-store";
import {
  useViewStoreApi,
  ViewStoreProvider,
} from "@uniwork/core/tasks/stores/view-store-context";
import type { TaskView } from "@uniwork/core/types/task-view";
import { useActiveTaskViewStore } from "@uniwork/core/tasks/views/active-view-store";
import { taskViewContainerKey } from "@uniwork/core/tasks/views/active-view-store";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";

export type SaveViewScope =
  | { kind: "workspace"; actorKind?: "all" | "members" | "agents" }
  | { kind: "my"; variant: "any" | "assigned" | "created" | "involved" }
  | {
      kind: "project";
      projectId: string;
      actorKind?: "all" | "members" | "agents";
    };

function snapshotState(state: TaskViewState): Partial<TaskViewState> {
  return {
    statusFilters: state.statusFilters,
    priorityFilters: state.priorityFilters,
    assigneeFilters: state.assigneeFilters,
    includeNoAssignee: state.includeNoAssignee,
    creatorFilters: state.creatorFilters,
    projectFilters: state.projectFilters,
    includeNoProject: state.includeNoProject,
    labelFilters: state.labelFilters,
    propertyFilters: state.propertyFilters,
    viewMode: state.viewMode,
    grouping: state.grouping,
    sortBy: state.sortBy,
    sortDirection: state.sortDirection,
    cardProperties: state.cardProperties,
    cardPropertyIds: state.cardPropertyIds,
    showSubTasks: state.showSubTasks,
    ganttZoom: state.ganttZoom,
    ganttShowCompleted: state.ganttShowCompleted,
    swimlaneGrouping: state.swimlaneGrouping,
    tableColumns: state.tableColumns,
    tableGrouping: state.tableGrouping,
    tableHierarchy: state.tableHierarchy,
  };
}

export function SaveViewDialog({
  workspaceId,
  open,
  onOpenChange,
  scope,
  editView = null,
  seedFromDefinition = false,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: SaveViewScope;
  editView?: TaskView | null;
  seedFromDefinition?: boolean;
}) {
  const { t } = useTranslation();
  const liveStore = useViewStoreApi();
  const createView = useCreateTaskView(workspaceId);
  const updateView = usePatchTaskView(workspaceId);
  const setActiveInStore = useActiveTaskViewStore((s) => s.setActive);

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [visibility, setVisibility] = useState<"private" | "workspace">(
    "private",
  );
  const [draftStore, setDraftStore] = useState<StoreApi<TaskViewState> | null>(
    null,
  );

  useEffect(() => {
    if (!open) {
      setDraftStore(null);
      return;
    }
    const store = createStore<TaskViewState>()((set) => viewStoreSlice(set));
    if (seedFromDefinition && editView) {
      const defaults = viewStoreSlice(store.setState);
      const query =
        editView.query && typeof editView.query === "object"
          ? (editView.query as Record<string, unknown>)
          : {};
      const display =
        editView.display && typeof editView.display === "object"
          ? (editView.display as Record<string, unknown>)
          : {};
      store.setState(
        mergeViewStatePersisted({ ...query, ...display }, defaults),
        true,
      );
    } else {
      store.setState(snapshotState(liveStore.getState()));
    }
    setDraftStore(store);
    setName(editView?.name ?? "");
    setNameError(false);
    setVisibility(
      editView?.visibility === "workspace" ? "workspace" : "private",
    );
  }, [open, liveStore, editView, seedFromDefinition]);

  const scopeHint = useMemo(() => {
    if (scope.kind === "workspace") return t("tasks.save_view.hint_workspace");
    if (scope.kind === "my") return t("tasks.save_view.hint_my");
    return t("tasks.save_view.hint_project");
  }, [scope.kind, t]);

  const create = () => {
    if (!draftStore) return;
    if (!name.trim()) {
      setNameError(true);
      nameInputRef.current?.focus();
      return;
    }
    const state = draftStore.getState();
    const payload = {
      name: name.trim(),
      visibility: scope.kind === "my" ? "private" : visibility,
      scope_type: scope.kind,
      scope_id: scope.kind === "project" ? scope.projectId : null,
      scope_variant:
        scope.kind === "my"
          ? scope.variant
          : scope.actorKind && scope.actorKind !== "all"
            ? scope.actorKind
            : null,
      definition_version: 1,
      query: {
        statusFilters: state.statusFilters,
        priorityFilters: state.priorityFilters,
        assigneeFilters: state.assigneeFilters,
        includeNoAssignee: state.includeNoAssignee,
        creatorFilters: state.creatorFilters,
        projectFilters: state.projectFilters,
        includeNoProject: state.includeNoProject,
        labelFilters: state.labelFilters,
        propertyFilters: state.propertyFilters,
      },
      display: {
        viewMode: state.viewMode,
        grouping: state.grouping,
        sortBy: state.sortBy,
        sortDirection: state.sortDirection,
        cardProperties: state.cardProperties,
        showSubTasks: state.showSubTasks,
      },
    };

    if (editView) {
      updateView.mutate(
        {
          id: editView.id,
          body: {
            name: payload.name,
            visibility: payload.visibility,
            scope_variant: payload.scope_variant,
            query: payload.query,
            display: payload.display,
            expected_revision: editView.revision,
          },
        },
        {
          onSuccess: () => {
            toast.success(t("tasks.save_view.toast_updated"));
            onOpenChange(false);
          },
          onError: () => toast.error(t("tasks.save_view.toast_failed")),
        },
      );
      return;
    }

    createView.mutate(payload, {
      onSuccess: (view) => {
        if (view) {
          const containerKey = taskViewContainerKey(workspaceId, {
            scope_type: scope.kind,
            scope_id: scope.kind === "project" ? scope.projectId : null,
          });
          setActiveInStore(containerKey, view.id);
        }
        toast.success(t("tasks.save_view.toast_created"));
        onOpenChange(false);
      },
      onError: () => toast.error(t("tasks.save_view.toast_failed")),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editView
              ? t("tasks.save_view.edit_title")
              : t("tasks.save_view.title")}
          </DialogTitle>
          <DialogDescription>{scopeHint}</DialogDescription>
        </DialogHeader>
        {draftStore ? (
          <ViewStoreProvider store={draftStore}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-view-name">{t("tasks.save_view.name")}</Label>
                <Input
                  id="task-view-name"
                  ref={nameInputRef}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameError(false);
                  }}
                  aria-invalid={nameError}
                />
              </div>
              {scope.kind !== "my" ? (
                <div className="flex flex-col gap-1.5">
                  <Label>{t("tasks.save_view.visibility")}</Label>
                  <Select
                    value={visibility}
                    onValueChange={(v) => {
                      if (v === "private" || v === "workspace") setVisibility(v);
                    }}
                    items={[
                      {
                        value: "private",
                        label: t("tasks.save_view.visibility_private"),
                      },
                      {
                        value: "workspace",
                        label: t("tasks.save_view.visibility_workspace"),
                      },
                    ]}
                  />
                </div>
              ) : null}
            </div>
          </ViewStoreProvider>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t("tasks.save_view.cancel")}
          </Button>
          <Button
            type="button"
            onClick={create}
            disabled={createView.isPending || updateView.isPending}
          >
            {t("tasks.save_view.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
