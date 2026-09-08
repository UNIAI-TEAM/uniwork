"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuthStore } from "@uniwork/core/auth";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import type { MyTasksScope } from "@uniwork/core/tasks/stores/my-tasks-view-store";
import { useActiveTaskView } from "@uniwork/core/tasks/views/use-active-view";
import type { Task } from "@uniwork/core/types";
import type { TaskView } from "@uniwork/core/types/task-view";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { PAGE_GUTTER } from "../layout/page-header";
import type { TaskSurfaceMode } from "../tasks/surface/types";
import { FilterChipsBar } from "../tasks/views/filter-chips-bar";
import {
  SaveViewDialog,
  type SaveViewScope,
} from "../tasks/views/save-view-dialog";
import { TaskDisplayControls } from "../tasks/views/task-display-controls";
import { ViewBar } from "../tasks/views/view-bar";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

const SAVE_VARIANT: Record<
  MyTasksScope,
  Extract<SaveViewScope, { kind: "my" }>["variant"]
> = {
  all: "any",
  assigned: "assigned",
  created: "created",
  involved: "involved",
};

const SCOPE_ORDER: MyTasksScope[] = [
  "all",
  "assigned",
  "created",
  "involved",
];

export function MyTasksHeader({
  workspaceId,
  modes,
  scopedTasks,
  isRefreshing = false,
  scope,
  onScopeChange,
}: {
  workspaceId: string;
  modes: TaskSurfaceMode[];
  scopedTasks: Task[];
  isRefreshing?: boolean;
  scope: MyTasksScope;
  onScopeChange: (scope: MyTasksScope) => void;
}) {
  const { t } = useTranslation();
  void scopedTasks;
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    view: TaskView;
    fromDefinition: boolean;
  } | null>(null);

  const saveScope: SaveViewScope = {
    kind: "my",
    variant: SAVE_VARIANT[scope],
  };

  const { activeView, views, viewsReady, setActive, missing } =
    useActiveTaskView(workspaceId, { scope_type: "my" });

  useEffect(() => {
    if (missing) {
      setActive(null);
      toast.info(t("tasks.view_selector.unavailable"));
    }
  }, [missing, setActive, t]);

  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const isViewOwner = !!activeView && activeView.owner_id === currentUserId;

  const { data: publicConfig } = usePublicConfig();
  const agentCapability = capabilityState(
    publicConfig ?? EMPTY_CONFIG,
    "tasks.agent_runs",
  );
  const agentAvailable = agentCapability.status === "available";
  const involvedReason = t(
    agentCapability.explanation_key || "capabilities.unknown",
  );

  const scopeMeta = useMemo(
    () =>
      SCOPE_ORDER.map((value) => ({
        value,
        label: t(`myTasks.scope.${value}_label`),
        description: t(`myTasks.scope.${value}_description`),
      })),
    [t],
  );

  const builtins = useMemo(
    () =>
      scopeMeta.map((s) => {
        const involvedDisabled = s.value === "involved" && !agentAvailable;
        return {
          key: s.value,
          label: s.label,
          description: s.description,
          active: !activeView && scope === s.value,
          testId: `my-tasks-scope-${s.value}`,
          disabled: involvedDisabled,
          disabledReason: involvedDisabled ? involvedReason : undefined,
          onSelect: () => {
            if (involvedDisabled) return;
            if (activeView) setActive(null);
            onScopeChange(s.value);
          },
        };
      }),
    [
      activeView,
      agentAvailable,
      involvedReason,
      onScopeChange,
      scope,
      scopeMeta,
      setActive,
    ],
  );

  const scopeLabel =
    scopeMeta.find((s) => s.value === scope)?.label ?? scopeMeta[0]?.label;

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
            <ViewBar
              workspaceId={workspaceId}
              scope={{ scope_type: "my" }}
              builtins={builtins}
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
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1 text-muted-foreground md:hidden"
                />
              }
            >
              <span className="truncate">{scopeLabel}</span>
              <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-auto">
              <DropdownMenuRadioGroup
                value={scope}
                onValueChange={(value) => {
                  if (value === "involved" && !agentAvailable) return;
                  onScopeChange(value as MyTasksScope);
                }}
              >
                {scopeMeta.map((s) => (
                  <DropdownMenuRadioItem
                    key={s.value}
                    value={s.value}
                    disabled={s.value === "involved" && !agentAvailable}
                    data-testid={`my-tasks-scope-mobile-${s.value}`}
                  >
                    {s.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex shrink-0 items-center gap-1">
            <TaskDisplayControls modes={modes} isRefreshing={isRefreshing} />
          </div>
        </div>
      </div>

      <FilterChipsBar
        onSave={() => {
          setEditTarget(
            activeView && isViewOwner
              ? { view: activeView, fromDefinition: false }
              : null,
          );
          setSaveViewOpen(true);
        }}
        saveLabel={
          activeView
            ? isViewOwner
              ? t("tasks.filters.chip_edit")
              : t("tasks.filters.chip_save_as")
            : t("tasks.filters.chip_save")
        }
      />

      <SaveViewDialog
        workspaceId={workspaceId}
        open={saveViewOpen}
        onOpenChange={setSaveViewOpen}
        scope={saveScope}
        editView={editTarget?.view ?? null}
        seedFromDefinition={editTarget?.fromDefinition ?? false}
      />
    </>
  );
}
