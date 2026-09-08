"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import {
  useViewStore,
  useViewStoreApi,
} from "@uniwork/core/tasks/stores/view-store-context";
import { TASK_STATUSES, type Task, type TaskStatus } from "@uniwork/core/types";
import { BoardCardContent } from "./board-card";
import { HiddenColumnsPanel } from "./hidden-columns-panel";
import { sortTasksForTable } from "./table-view-model";
import { applySwimlaneDragEnd, applySwimlaneDragOver } from "./swimlane-drag";
import { DraggableSwimLane } from "./swimlane-lane";
import {
  COLUMN_GAP,
  COLUMN_WIDTH,
  SWIMLANE_LANE_SEED_COUNT,
  cellId,
  laneIdFor,
  makeSwimLaneCollision,
  parseLaneId,
} from "./swimlane-ids";
import { buildLanesForGrouping, type LaneGroup } from "./swimlane-lanes";
import { useTaskSurfaceActionsOptional } from "../surface/actions-context";
import type { TaskGroupBranches } from "../surface/use-task-group-branches";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

function SwimLaneViewImpl({
  tasks,
  categories = TASK_STATUSES,
  groupBranches,
  onOpenTask,
  projectGroupingDisabled = true,
  projectGroupingReasonKey,
  parentGroupingDisabled = true,
  parentGroupingReasonKey,
}: {
  tasks: Task[];
  categories?: readonly string[];
  groupBranches?: TaskGroupBranches;
  onOpenTask?: (id: string) => void;
  projectGroupingDisabled?: boolean;
  projectGroupingReasonKey?: string;
  parentGroupingDisabled?: boolean;
  parentGroupingReasonKey?: string;
}) {
  const { t } = useTranslation();
  const actions = useTaskSurfaceActionsOptional();
  const viewStoreApi = useViewStoreApi();
  const sortBy = useViewStore((s) => s.sortBy);
  const sortDirection = useViewStore((s) => s.sortDirection);
  const swimlaneGrouping = useViewStore((s) => s.swimlaneGrouping);
  const swimlaneOrders = useViewStore((s) => s.swimlaneOrders);
  const swimlaneOrder = swimlaneOrders[swimlaneGrouping];
  const hiddenStatusCategories = useViewStore((s) => s.hiddenStatusCategories);
  const collapsedSwimlanesMap = useViewStore((s) => s.collapsedSwimlanes);
  const { data: publicConfig } = usePublicConfig();
  const projectsCapability = capabilityState(
    publicConfig ?? EMPTY_CONFIG,
    "tasks.projects",
  );

  const effectiveGrouping =
    swimlaneGrouping === "project" && projectGroupingDisabled
      ? "assignee"
      : swimlaneGrouping === "parent" && parentGroupingDisabled
        ? "assignee"
        : swimlaneGrouping;

  useEffect(() => {
    if (effectiveGrouping !== swimlaneGrouping) {
      viewStoreApi.getState().setSwimlaneGrouping(effectiveGrouping);
    }
  }, [effectiveGrouping, swimlaneGrouping, viewStoreApi]);

  const sortedStatuses = useMemo(
    () =>
      TASK_STATUSES.filter(
        (status) =>
          categories.includes(status) &&
          !hiddenStatusCategories.includes(status),
      ),
    [categories, hiddenStatusCategories],
  );

  const hiddenStatuses = useMemo(
    () =>
      categories.filter((category) =>
        hiddenStatusCategories.includes(category as TaskStatus),
      ),
    [categories, hiddenStatusCategories],
  );

  const laneLabels = useMemo(
    () => ({
      noParent: t("tasks.swimlane.no_parent"),
      otherParents: t("tasks.swimlane.other_parents"),
      noProject: t("tasks.swimlane.no_project"),
      noAssignee: t("tasks.swimlane.no_assignee"),
    }),
    [t],
  );

  const getActorName = useCallback(
    (kind: string, id: string) => {
      const match = tasks.find(
        (task) =>
          task.assignee_id === id && (task.assignee_kind || "human") === kind,
      );
      return match?.assignee?.display_name || id.slice(0, 8);
    },
    [tasks],
  );

  const projectTitles = useMemo(() => new Map<string, string>(), []);

  const laneGroups = useMemo(
    () =>
      buildLanesForGrouping(
        effectiveGrouping,
        tasks,
        tasks,
        swimlaneOrder,
        laneLabels,
        getActorName,
        projectTitles,
      ),
    [
      effectiveGrouping,
      tasks,
      swimlaneOrder,
      laneLabels,
      getActorName,
      projectTitles,
    ],
  );

  const cells = useMemo(() => {
    const result: Record<string, Record<string, string[]>> = {};
    for (const lane of laneGroups) {
      result[lane.key] = {};
      for (const status of sortedStatuses) result[lane.key]![status] = [];
    }
    const sorted = sortTasksForTable(tasks, sortBy, sortDirection);
    const orphanLane = laneGroups.find((lane) => lane.isOrphan);
    for (const task of sorted) {
      let placed = false;
      for (const lane of laneGroups) {
        if (lane.isOrphan) continue;
        if (!lane.matches(task)) continue;
        const bucket = result[lane.key]?.[task.status as TaskStatus];
        if (bucket) {
          bucket.push(task.id);
          placed = true;
        }
        break;
      }
      if (!placed && orphanLane && task.parent_task_id) {
        result[orphanLane.key]?.[task.status as TaskStatus]?.push(task.id);
      }
    }
    return result;
  }, [tasks, laneGroups, sortedStatuses, sortBy, sortDirection]);

  const laneByKey = useMemo(() => {
    const map = new Map<string, LaneGroup>();
    for (const lane of laneGroups) map.set(lane.key, lane);
    return map;
  }, [laneGroups]);

  const cellSet = useMemo(() => {
    const ids = new Set<string>();
    for (const lane of laneGroups) {
      for (const status of sortedStatuses) ids.add(cellId(lane.key, status));
    }
    return ids;
  }, [laneGroups, sortedStatuses]);

  const statusTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const task of tasks) {
      totals[task.status] = (totals[task.status] ?? 0) + 1;
    }
    return totals;
  }, [tasks]);

  const collapsedLanes = useMemo(() => {
    const stored = collapsedSwimlanesMap[effectiveGrouping] ?? [];
    return new Set(stored.map((id) => `${effectiveGrouping}:${id}`));
  }, [collapsedSwimlanesMap, effectiveGrouping]);

  const toggleLane = useCallback(
    (laneKey: string) => {
      const prefix = `${effectiveGrouping}:`;
      const storeKey = laneKey.startsWith(prefix)
        ? laneKey.slice(prefix.length)
        : laneKey;
      viewStoreApi.getState().toggleSwimlaneCollapsed(storeKey);
    },
    [viewStoreApi, effectiveGrouping],
  );

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const isSettlingRef = useRef(false);
  const [settleVersion, setSettleVersion] = useState(0);

  const taskMap = useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of tasks) map.set(task.id, task);
    return map;
  }, [tasks]);
  const taskMapRef = useRef(taskMap);
  if (!isDraggingRef.current && !isSettlingRef.current) {
    taskMapRef.current = taskMap;
  }

  const [localCells, setLocalCells] = useState(cells);
  const localCellsRef = useRef(localCells);
  localCellsRef.current = localCells;

  useEffect(() => {
    if (!isDraggingRef.current && !isSettlingRef.current) {
      setLocalCells(cells);
    }
  }, [cells, settleVersion]);

  const recentlyMovedRef = useRef(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      recentlyMovedRef.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [localCells]);

  const collisionDetection = useMemo(
    () => makeSwimLaneCollision(cellSet),
    [cellSet],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    isDraggingRef.current = true;
    const activeId = event.active.id as string;
    if (parseLaneId(activeId) !== null) {
      setActiveTask(null);
      return;
    }
    setActiveTask(taskMapRef.current.get(activeId) ?? null);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      applySwimlaneDragOver({
        event,
        cellSet,
        laneByKey,
        recentlyMovedRef,
        setLocalCells,
      });
    },
    [cellSet, laneByKey],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      isDraggingRef.current = false;
      setActiveTask(null);
      const { active, over } = event;
      if (!over) {
        setLocalCells(cells);
        return;
      }
      const isLane = parseLaneId(active.id as string) !== null;
      applySwimlaneDragEnd({
        event,
        cells,
        cellSet,
        laneByKey,
        laneGroups,
        localCellsRef,
        taskMapRef,
        setLocalCells,
        setSwimlaneOrder: (order) =>
          viewStoreApi.getState().setSwimlaneOrder(order),
        moveTask: (taskId, updates) => {
          isSettlingRef.current = true;
          actions?.moveTask(taskId, updates, {
            onSettled: () => {
              isSettlingRef.current = false;
              setSettleVersion((v) => v + 1);
            },
          });
        },
      });
      if (isLane) return;
    },
    [actions, cells, cellSet, laneByKey, laneGroups, viewStoreApi],
  );

  const nonPinnedLaneIds = useMemo(
    () =>
      laneGroups
        .filter((lane) => !lane.isPinned)
        .map((lane) => laneIdFor(effectiveGrouping, lane.rawId)),
    [laneGroups, effectiveGrouping],
  );

  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${sortedStatuses.length}, ${COLUMN_WIDTH}px)`,
      gap: COLUMN_GAP,
    }),
    [sortedStatuses.length],
  );

  const renderLane = useCallback(
    (_index: number, lane: LaneGroup) => (
      <div className="mb-4 px-3">
        <DraggableSwimLane
          lane={lane}
          grouping={effectiveGrouping}
          isCollapsed={collapsedLanes.has(lane.key)}
          onToggleCollapse={() => toggleLane(lane.key)}
          localCells={localCells}
          sortedStatuses={sortedStatuses}
          taskMap={taskMap}
          gridStyle={gridStyle}
          onCreateTask={(defaults) => actions?.createTask(defaults)}
          onOpenTask={onOpenTask}
          groupPagination={groupBranches?.pagination}
        />
      </div>
    ),
    [
      effectiveGrouping,
      collapsedLanes,
      toggleLane,
      localCells,
      sortedStatuses,
      taskMap,
      gridStyle,
      actions,
      onOpenTask,
      groupBranches?.pagination,
    ],
  );

  const groupingHint =
    (swimlaneGrouping === "project" && projectGroupingDisabled) ||
    (swimlaneGrouping === "parent" && parentGroupingDisabled)
      ? t(
          swimlaneGrouping === "project"
            ? projectGroupingReasonKey ||
                projectsCapability.explanation_key ||
                "capabilities.unknown"
            : parentGroupingReasonKey || "capabilities.unknown",
        )
      : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        isDraggingRef.current = false;
        setActiveTask(null);
        setLocalCells(cells);
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col" data-testid="swimlane-view">
        {groupingHint ? (
          <p className="shrink-0 border-b px-3 py-2 text-caption text-muted-foreground">
            {groupingHint}
          </p>
        ) : null}
        <div ref={setScrollEl} className="min-h-0 flex-1 overflow-auto">
          <div className="sticky top-0 z-10 border-b bg-background px-3 py-2">
            <div className="grid" style={gridStyle}>
              {sortedStatuses.map((status) => (
                <div
                  key={status}
                  className="flex items-center gap-2 text-caption font-medium text-muted-foreground"
                >
                  <span>{t(`tasks.status_${status}`)}</span>
                  <span>{statusTotals[status] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>
          <SortableContext
            items={nonPinnedLaneIds}
            strategy={verticalListSortingStrategy}
          >
            {scrollEl ? (
              <Virtuoso
                customScrollParent={scrollEl}
                data={laneGroups}
                computeItemKey={(_i, lane) => lane.key}
                initialItemCount={Math.min(
                  laneGroups.length,
                  SWIMLANE_LANE_SEED_COUNT,
                )}
                increaseViewportBy={{ top: 600, bottom: 600 }}
                itemContent={renderLane}
              />
            ) : (
              laneGroups.slice(0, SWIMLANE_LANE_SEED_COUNT).map((lane, index) => (
                <div key={lane.key}>{renderLane(index, lane)}</div>
              ))
            )}
          </SortableContext>
          {hiddenStatuses.length > 0 ? (
            <div className="px-3 py-4">
              <HiddenColumnsPanel
                hiddenStatuses={hiddenStatuses}
                taskCounts={statusTotals}
              />
            </div>
          ) : null}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-[280px] rotate-2 scale-105 cursor-grabbing opacity-90 shadow-lg shadow-black/10">
            <BoardCardContent task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export const SwimLaneView = memo(SwimLaneViewImpl);
