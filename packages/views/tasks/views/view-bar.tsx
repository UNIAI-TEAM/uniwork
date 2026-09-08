"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Layers, Plus, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { useCurrentMember } from "@uniwork/core/permissions";
import {
  useDeleteTaskView,
  usePutTaskViewPreference,
  useTaskViewPreference,
} from "@uniwork/core/tasks";
import type { TaskView } from "@uniwork/core/types/task-view";
import {
  applyViewBarPrefs,
  canManageTaskView,
  EMPTY_VIEW_BAR_PREFS,
  type ViewBarPrefs,
} from "@uniwork/core/tasks/views/use-active-view";
import type { TaskViewScope } from "@uniwork/core/tasks/views/active-view-store";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { ManageViewsDialog } from "./manage-views-dialog";
import {
  DeleteViewConfirm,
  ViewListPanel,
  type ViewBarItem,
} from "./view-bar-popover";

export interface ViewBarBuiltin {
  key: string;
  label: string;
  description?: string;
  active: boolean;
  onSelect: () => void;
  disabled?: boolean;
  disabledReason?: string;
  testId?: string;
}

const TAB_MAX_W = "max-w-40";

function SortableBarTab({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "z-10 opacity-80")}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

function parsePrefs(raw: unknown): ViewBarPrefs {
  if (!raw || typeof raw !== "object") return EMPTY_VIEW_BAR_PREFS;
  const prefs = raw as { hidden?: unknown; order?: unknown };
  return {
    hidden: Array.isArray(prefs.hidden)
      ? prefs.hidden.filter((v): v is string => typeof v === "string")
      : [],
    order: Array.isArray(prefs.order)
      ? prefs.order.filter((v): v is string => typeof v === "string")
      : [],
  };
}

export function ViewBar({
  workspaceId,
  scope,
  builtins,
  views,
  viewsReady,
  activeView,
  onSelectView,
  onNewView,
  onEditView,
}: {
  workspaceId: string;
  scope: TaskViewScope;
  builtins: ViewBarBuiltin[];
  views: TaskView[];
  viewsReady: boolean;
  activeView: TaskView | null;
  onSelectView: (view: TaskView | null) => void;
  onNewView: () => void;
  onEditView: (view: TaskView) => void;
}) {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { role: wsRole } = useCurrentMember(workspaceId);
  const prefQuery = useTaskViewPreference(workspaceId, {
    scope_type: scope.scope_type,
    scope_id: scope.scope_id ?? undefined,
  });
  const putPref = usePutTaskViewPreference(workspaceId);
  const deleteView = useDeleteTaskView(workspaceId);

  const prefs = parsePrefs(prefQuery.data?.prefs);
  const [manageOpen, setManageOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleting, setDeleting] = useState<TaskView | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const items: ViewBarItem[] = useMemo(() => {
    const builtinItems: ViewBarItem[] = builtins.map((b) => ({
      barItemId: `builtin:${b.key}`,
      label: b.label,
      kind: "builtin",
    }));
    const viewItems: ViewBarItem[] = views.map((view) => ({
      barItemId: `view:${view.id}`,
      label: view.name,
      kind: "view",
      view,
      canManage: canManageTaskView(view, userId, wsRole),
    }));
    return [...builtinItems, ...viewItems];
  }, [builtins, userId, views, wsRole]);

  const anchorId = items[0]?.barItemId ?? "builtin:all";
  const { visible, hiddenSet, ordered } = applyViewBarPrefs(
    items,
    viewsReady ? prefs : EMPTY_VIEW_BAR_PREFS,
    anchorId,
  );

  const writePrefs = (next: ViewBarPrefs) => {
    putPref.mutate({
      scope_type: scope.scope_type,
      scope_id: scope.scope_id ?? null,
      prefs: next,
    });
  };

  const handleReorder = (orderedIds: string[]) => {
    writePrefs({ ...prefs, order: orderedIds });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = visible.map((item) => item.barItemId);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    handleReorder(arrayMove(ordered.map((i) => i.barItemId), from, to));
  };

  const onToggleHidden = (barItemId: string, hidden: boolean) => {
    const nextHidden = new Set(prefs.hidden);
    if (hidden) nextHidden.add(barItemId);
    else nextHidden.delete(barItemId);
    writePrefs({ ...prefs, hidden: [...nextHidden] });
  };

  return (
    <div className="flex min-w-0 items-center gap-1">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={visible.map((item) => item.barItemId)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {visible.map((item) => {
              const builtin =
                item.kind === "builtin"
                  ? builtins.find((b) => `builtin:${b.key}` === item.barItemId)
                  : null;
              const active =
                item.kind === "view"
                  ? activeView?.id === item.view?.id
                  : !!builtin?.active;
              return (
                <SortableBarTab key={item.barItemId} id={item.barItemId}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant={active ? "secondary" : "ghost"}
                          size="sm"
                          data-testid={builtin?.testId}
                          aria-disabled={builtin?.disabled || undefined}
                          className={cn(
                            TAB_MAX_W,
                            "truncate",
                            builtin?.disabled && "opacity-60",
                          )}
                          onClick={() => {
                            if (builtin?.disabled) return;
                            if (item.kind === "builtin") builtin?.onSelect();
                            else onSelectView(item.view ?? null);
                          }}
                        />
                      }
                    >
                      {item.label}
                    </TooltipTrigger>
                    {builtin?.disabled && builtin.disabledReason ? (
                      <TooltipContent side="bottom">
                        {builtin.disabledReason}
                      </TooltipContent>
                    ) : null}
                  </Tooltip>
                </SortableBarTab>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <Popover open={moreOpen} onOpenChange={setMoreOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("tasks.view_bar.more")}
            />
          }
        >
          <Layers className="size-3.5" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <ViewListPanel
            items={ordered}
            activeViewId={activeView?.id ?? null}
            onSelect={(item) => {
              setMoreOpen(false);
              if (item.kind === "builtin") {
                const b = builtins.find(
                  (x) => `builtin:${x.key}` === item.barItemId,
                );
                if (b?.disabled) return;
                b?.onSelect();
              } else {
                onSelectView(item.view ?? null);
              }
            }}
            onEdit={(view) => {
              setMoreOpen(false);
              onEditView(view);
            }}
            onDelete={(view) => setDeleting(view)}
          />
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("tasks.view_bar.new")}
        onClick={onNewView}
      >
        <Plus className="size-3.5" aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("tasks.view_bar.manage")}
        onClick={() => setManageOpen(true)}
      >
        <Settings2 className="size-3.5" aria-hidden />
      </Button>

      <ManageViewsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        items={ordered}
        hiddenSet={hiddenSet}
        anchorId={anchorId}
        onReorder={handleReorder}
        onToggleHidden={onToggleHidden}
        onEditView={(view) => {
          setManageOpen(false);
          onEditView(view);
        }}
        onDeleteView={async (view) => {
          await deleteView.mutateAsync(view.id);
          if (activeView?.id === view.id) onSelectView(null);
        }}
      />

      <DeleteViewConfirm
        view={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={async (view) => {
          await deleteView.mutateAsync(view.id);
          if (activeView?.id === view.id) onSelectView(null);
        }}
      />
    </div>
  );
}
