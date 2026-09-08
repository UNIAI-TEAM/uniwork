"use client";

import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, GripVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SwimlaneGrouping } from "@uniwork/core/tasks/stores/view-store-types";
import type { Task, TaskStatus } from "@uniwork/core/types";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { cn } from "@uniwork/ui/lib/utils";
import { SwimLaneCell } from "./swimlane-cell";
import { cellId, laneIdFor } from "./swimlane-ids";
import type { LaneGroup } from "./swimlane-lanes";
import type { TaskGroupPageState } from "../surface/use-task-group-branches";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

export const DraggableSwimLane = memo(function DraggableSwimLane({
  lane,
  grouping,
  isCollapsed,
  onToggleCollapse,
  localCells,
  sortedStatuses,
  taskMap,
  gridStyle,
  onCreateTask,
  onOpenTask,
  groupPagination,
}: {
  lane: LaneGroup;
  grouping: SwimlaneGrouping;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  localCells: Record<string, Record<string, string[]>>;
  sortedStatuses: TaskStatus[];
  taskMap: Map<string, Task>;
  gridStyle: React.CSSProperties;
  onCreateTask?: (defaults: Record<string, unknown>) => void;
  onOpenTask?: (id: string) => void;
  groupPagination?: Record<string, TaskGroupPageState>;
}) {
  const { t } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const agentCapability = capabilityState(
    publicConfig ?? EMPTY_CONFIG,
    "tasks.agent_runs",
  );
  const agentAvailable = agentCapability.status === "available";

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: laneIdFor(grouping, lane.rawId),
      disabled: lane.isPinned,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const laneTotal = sortedStatuses.reduce((sum, status) => {
    const serverKey = lane.serverCellKeys?.[status];
    return (
      sum +
      (serverKey
        ? (groupPagination?.[serverKey]?.total ?? 0)
        : (localCells[lane.key]?.[status]?.length ?? 0))
    );
  }, 0);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("flex flex-col", isDragging && "opacity-50")}
      data-testid={`swimlane-lane-${lane.key}`}
    >
      <div
        className="mb-2 flex w-full items-center gap-2 rounded-md px-1 py-1"
        {...attributes}
        {...listeners}
      >
        {!lane.isPinned ? (
          <GripVertical
            className="!size-3 shrink-0 cursor-grab text-muted-foreground"
            aria-hidden
          />
        ) : null}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={t("tasks.swimlane.toggle_collapse")}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition-colors hover:bg-accent/70"
        >
          <ChevronRight
            className={cn(
              "!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform",
              !isCollapsed && "rotate-90",
            )}
            aria-hidden
          />
          {lane.actor ? (
            <span
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-micro",
                lane.actor.kind === "agent" &&
                  !agentAvailable &&
                  "cursor-not-allowed opacity-60",
              )}
              title={
                lane.actor.kind === "agent" && !agentAvailable
                  ? t(
                      agentCapability.explanation_key || "capabilities.unknown",
                    )
                  : undefined
              }
              aria-disabled={
                lane.actor.kind === "agent" ? !agentAvailable : undefined
              }
            >
              {(lane.title || "?").slice(0, 1).toUpperCase()}
            </span>
          ) : null}
          <span className="truncate text-body font-semibold">{lane.title}</span>
          {lane.identifier ? (
            <span className="shrink-0 text-caption text-muted-foreground">
              {lane.identifier}
            </span>
          ) : null}
          <span className="shrink-0 text-caption text-muted-foreground">
            {laneTotal}
          </span>
        </button>
      </div>
      {!isCollapsed ? (
        <div className="grid" style={gridStyle}>
          {sortedStatuses.map((status) => {
            const serverKey = lane.serverCellKeys?.[status];
            const ids = localCells[lane.key]?.[status] ?? [];
            return (
              <SwimLaneCell
                key={status}
                cellId={cellId(lane.key, status)}
                taskIds={ids}
                taskMap={taskMap}
                status={status}
                lane={lane}
                onCreateTask={onCreateTask}
                onOpenTask={onOpenTask}
                readOnly={lane.isOrphan}
                page={serverKey ? groupPagination?.[serverKey] : undefined}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
