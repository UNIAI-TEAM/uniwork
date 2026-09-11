"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@uniwork/ui/components/ui/collapsible";
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
import { SaveViewFilterMenu } from "./save-view-filter-menu";
import {
  TaskDisplaySettings,
  TaskDisplaySummary,
} from "./task-display-settings";

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
    tableCalculation: state.tableCalculation,
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
  const [actorKind, setActorKind] = useState<"all" | "members" | "agents">(
    "all",
  );
  const [displayOpen, setDisplayOpen] = useState(false);
  const [draftStore, setDraftStore] = useState<StoreApi<TaskViewState> | null>(
    null,
  );
  const initialActorKind =
    scope.kind !== "my" && scope.actorKind ? scope.actorKind : "all";

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
    setActorKind(initialActorKind);
    setDisplayOpen(false);
  }, [open, liveStore, editView, seedFromDefinition, initialActorKind]);

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
          : actorKind !== "all"
            ? actorKind
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
        cardPropertyIds: state.cardPropertyIds,
        showSubTasks: state.showSubTasks,
        ganttZoom: state.ganttZoom,
        ganttShowCompleted: state.ganttShowCompleted,
        swimlaneGrouping: state.swimlaneGrouping,
        tableColumns: state.tableColumns,
        tableGrouping: state.tableGrouping,
        tableHierarchy: state.tableHierarchy,
        tableCalculation: state.tableCalculation,
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
      <DialogContent className="flex max-h-[min(720px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 px-5 pt-5">
          <DialogTitle className="text-pretty">
            {editView
              ? t("tasks.save_view.edit_title")
              : t("tasks.save_view.title")}
          </DialogTitle>
          <DialogDescription>{scopeHint}</DialogDescription>
        </DialogHeader>
        {draftStore ? (
          <ViewStoreProvider store={draftStore}>
            <form
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              onSubmit={(event) => {
                event.preventDefault();
                create();
              }}
            >
              <div
                className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4"
                data-testid="save-view-dialog-scroll"
              >
                <div className="grid grid-cols-[6.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3">
                  <Label htmlFor="task-view-name">
                    {t("tasks.save_view.name")}
                  </Label>
                  <div className="min-w-0">
                    <Input
                      id="task-view-name"
                      name="task-view-name"
                      autoComplete="off"
                      placeholder={t("tasks.save_view.name_placeholder")}
                      ref={nameInputRef}
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        setNameError(false);
                      }}
                      aria-invalid={nameError}
                      aria-describedby={nameError ? "task-view-name-error" : undefined}
                    />
                    {nameError ? (
                      <p
                        id="task-view-name-error"
                        role="alert"
                        className="mt-1 text-caption text-destructive"
                      >
                        {t("tasks.save_view.name_required")}
                      </p>
                    ) : null}
                  </div>

                  {scope.kind !== "my" ? (
                    <>
                      <Label htmlFor="task-view-visibility">
                        {t("tasks.save_view.visibility")}
                      </Label>
                      <Select
                        id="task-view-visibility"
                        value={visibility}
                        onValueChange={(value) => {
                          if (value === "private" || value === "workspace") {
                            setVisibility(value);
                          }
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
                      <Label htmlFor="task-view-actor-kind">
                        {t("tasks.save_view.actor_kind")}
                      </Label>
                      <Select
                        id="task-view-actor-kind"
                        value={actorKind}
                        onValueChange={(value) => {
                          if (
                            value === "all" ||
                            value === "members" ||
                            value === "agents"
                          ) {
                            setActorKind(value);
                          }
                        }}
                        items={[
                          {
                            value: "all",
                            label: t("tasks.save_view.actor_all"),
                          },
                          {
                            value: "members",
                            label: t("tasks.save_view.actor_members"),
                          },
                          {
                            value: "agents",
                            label: t("tasks.save_view.actor_agents"),
                          },
                        ]}
                      />
                    </>
                  ) : null}

                  <span className="text-body font-medium">
                    {t("tasks.save_view.filters")}
                  </span>
                  <SaveViewFilterMenu
                    workspaceId={workspaceId}
                    lockProjectFilter={scope.kind === "project"}
                    compact
                  />
                </div>

                <Collapsible open={displayOpen} onOpenChange={setDisplayOpen}>
                  <CollapsibleTrigger className="group flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 text-left hover:text-foreground">
                    <ChevronDown
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180"
                      aria-hidden
                    />
                    <span className="shrink-0 text-body font-medium">
                      {t("tasks.save_view.default_display")}
                    </span>
                    <TaskDisplaySummary />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-6 pt-2">
                    <TaskDisplaySettings
                      showMode
                      showProjectGrouping={scope.kind !== "project"}
                      projectGroupingDisabled={scope.kind === "project"}
                      compact
                    />
                    <p className="mt-3 text-caption text-muted-foreground">
                      {t("tasks.save_view.default_display_hint")}
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              <DialogFooter className="shrink-0 border-t border-border px-5 py-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                >
                  {t("tasks.save_view.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={createView.isPending || updateView.isPending}
                >
                  {createView.isPending || updateView.isPending
                    ? t("tasks.save_view.saving")
                    : editView
                      ? t("tasks.save_view.update")
                      : t("tasks.save_view.create")}
                </Button>
              </DialogFooter>
            </form>
          </ViewStoreProvider>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
