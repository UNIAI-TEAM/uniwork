"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { capabilityState } from "@uniwork/core/capabilities";
import { useAuthStore } from "@uniwork/core/auth";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import type { Task } from "@uniwork/core/types";
import type { TaskView } from "@uniwork/core/types/task-view";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import { useActiveTaskView } from "@uniwork/core/tasks/views/use-active-view";
import type { TaskViewScope } from "@uniwork/core/tasks/views/active-view-store";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { PAGE_GUTTER } from "../../layout/page-header";
import type { TaskSurfaceMode } from "../surface/types";
import { FilterChipsBar } from "./filter-chips-bar";
import { SaveViewDialog, type SaveViewScope } from "./save-view-dialog";
import { TaskDisplayControls } from "./task-display-controls";
import { ViewBar } from "./view-bar";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

const SCOPE_VALUES = ["all", "members", "agents"] as const;
type WorkspaceScopeTab = (typeof SCOPE_VALUES)[number];

export function TasksHeader({
  workspaceId,
  modes,
  scopedTasks,
  isRefreshing = false,
  saveViewScope = { kind: "workspace" },
}: {
  workspaceId: string;
  modes: TaskSurfaceMode[];
  scopedTasks: Task[];
  isRefreshing?: boolean;
  saveViewScope?: SaveViewScope | null;
}) {
  const { t } = useTranslation();
  void scopedTasks;
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    view: TaskView;
    fromDefinition: boolean;
  } | null>(null);
  const [scopeTab, setScopeTab] = useState<WorkspaceScopeTab>("all");

  const viewListScope: TaskViewScope | null = saveViewScope
    ? saveViewScope.kind === "project"
      ? { scope_type: "project", scope_id: saveViewScope.projectId }
      : { scope_type: saveViewScope.kind }
    : null;

  const { activeView, views, viewsReady, setActive, missing } =
    useActiveTaskView(workspaceId, viewListScope);

  useEffect(() => {
    if (missing) {
      setActive(null);
      toast.info(t("tasks.view_selector.unavailable"));
    }
  }, [missing, setActive, t]);

  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const isViewOwner = !!activeView && activeView.owner_id === currentUserId;

  const dialogScope = useMemo<SaveViewScope | null>(() => {
    if (!saveViewScope) return null;
    if (saveViewScope.kind === "my") return saveViewScope;
    if (saveViewScope.kind === "project") {
      return { ...saveViewScope, actorKind: scopeTab };
    }
    return { kind: "workspace", actorKind: scopeTab };
  }, [saveViewScope, scopeTab]);

  const { data: publicConfig } = usePublicConfig();
  const agentCapability = capabilityState(
    publicConfig ?? EMPTY_CONFIG,
    "tasks.agent_runs",
  );
  const agentRunningFilter = useViewStore((s) => s.agentRunningFilter);
  const toggleAgentRunningFilter = useViewStore(
    (s) => s.toggleAgentRunningFilter,
  );
  const agentAvailable = agentCapability.status === "available";

  return (
    <>
      <div
        className={cn(
          "min-h-12 shrink-0 py-2 [-webkit-overflow-scrolling:touch]",
          PAGE_GUTTER,
        )}
      >
        <div className="flex w-full min-w-0 items-start justify-between gap-2">
          <div className="hidden min-w-0 flex-1 md:block">
            {saveViewScope && viewListScope ? (
              <ViewBar
                workspaceId={workspaceId}
                scope={viewListScope}
                builtins={SCOPE_VALUES.map((s) => ({
                  key: s,
                  label: t(`tasks.scope.${s}_label`),
                  description: t(`tasks.scope.${s}_description`),
                  active: !activeView && scopeTab === s,
                  onSelect: () => {
                    if (activeView) setActive(null);
                    setScopeTab(s);
                  },
                }))}
                views={views}
                viewsReady={viewsReady}
                activeView={activeView}
                onSelectView={(view) => setActive(view ? view.id : null)}
                onNewView={() => {
                  setEditTarget(null);
                  setSaveViewOpen(true);
                }}
                onEditView={(view) => {
                  setEditTarget({ view, fromDefinition: true });
                  setSaveViewOpen(true);
                }}
              />
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {agentRunningFilter ? (
              <span className="mr-1 hidden text-caption text-muted-foreground md:inline">
                {t("tasks.agent_activity.filter_active_label")}
              </span>
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant={agentRunningFilter ? "secondary" : "ghost"}
                    size="sm"
                    disabled={!agentAvailable}
                    aria-disabled={!agentAvailable}
                    className={!agentAvailable ? "opacity-60" : undefined}
                    onClick={() => {
                      if (!agentAvailable) return;
                      toggleAgentRunningFilter();
                    }}
                  />
                }
              >
                {t("tasks.surface.agent_chip_stub")}
              </TooltipTrigger>
              {!agentAvailable ? (
                <TooltipContent side="bottom">
                  {t(
                    agentCapability.explanation_key || "capabilities.unknown",
                  )}
                </TooltipContent>
              ) : null}
            </Tooltip>

            <TaskDisplayControls
              modes={modes}
              isRefreshing={isRefreshing}
            />
          </div>
        </div>
      </div>

      <FilterChipsBar
        onSave={
          saveViewScope
            ? () => {
                setEditTarget(
                  activeView && isViewOwner
                    ? { view: activeView, fromDefinition: false }
                    : null,
                );
                setSaveViewOpen(true);
              }
            : undefined
        }
        saveLabel={
          activeView
            ? isViewOwner
              ? t("tasks.filters.chip_edit")
              : t("tasks.filters.chip_save_as")
            : t("tasks.filters.chip_save")
        }
      />

      {dialogScope ? (
        <SaveViewDialog
          workspaceId={workspaceId}
          open={saveViewOpen}
          onOpenChange={setSaveViewOpen}
          scope={dialogScope}
          editView={editTarget?.view ?? null}
          seedFromDefinition={editTarget?.fromDefinition ?? false}
        />
      ) : null}
    </>
  );
}
