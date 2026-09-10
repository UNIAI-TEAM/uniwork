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
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { Task, TaskStatus } from "@uniwork/core/types";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import { BoardCardContent } from "./board-card";
import {
  BoardColumn,
  BOARD_CARD_WIDTH,
  type BoardColumnGroup,
} from "./board-column";
import {
  buildColumns,
  computePosition,
  findColumn,
  getMoveUpdates,
  insertIdByPosition,
  makeKanbanCollision,
  statusGroupId,
  taskMatchesGroup,
} from "./board-drag-utils";
import { HiddenColumnsPanel } from "./hidden-columns-panel";
import { useBoardDragPan } from "./use-board-drag-pan";
import { useDragSettle } from "./use-drag-settle";
import { useTaskSurfaceActionsOptional } from "../surface/actions-context";

const EMPTY_IDS: string[] = [];

/**
 * Suite TaskSurface board mode — kanban columns, cards, drag settle,
 * drag-pan, and Virtuoso. Separate from MVP `../board-view.tsx`.
 *
 * Property / Projects deep grouping stays stubbed until those capabilities
 * ship; agent chips are gated in the card.
 */
function BoardViewImpl({
  categories,
  tasks,
  onOpenTask,
}: {
  categories: readonly string[];
  tasks: Task[];
  onOpenTask?: (id: string) => void;
}) {
  const actions = useTaskSurfaceActionsOptional();
  const hiddenStatusCategories = useViewStore((s) => s.hiddenStatusCategories);

  const visibleCategories = useMemo(
    () =>
      categories.filter(
        (category) =>
          !hiddenStatusCategories.includes(category as TaskStatus),
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

  const groups = useMemo<BoardColumnGroup[]>(
    () =>
      visibleCategories.map((status) => ({
        id: statusGroupId(status),
        title: status,
        status,
        createData: { status },
      })),
    [visibleCategories],
  );

  const groupIds = useMemo(
    () => new Set(groups.map((group) => group.id)),
    [groups],
  );
  const groupMap = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );
  const collisionDetection = useMemo(
    () => makeKanbanCollision(groupIds),
    [groupIds],
  );

  const {
    columns,
    setColumns,
    columnsRef,
    isDraggingRef,
    isSettlingRef,
    recentlyMovedRef,
    settleVersion,
    beginSettle,
  } = useDragSettle(() => buildColumns(tasks, groups));

  useEffect(() => {
    if (!isDraggingRef.current && !isSettlingRef.current) {
      setColumns(buildColumns(tasks, groups));
    }
  }, [tasks, groups, settleVersion, setColumns, isDraggingRef, isSettlingRef]);

  const taskMap = useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of tasks) map.set(task.id, task);
    return map;
  }, [tasks]);

  const taskMapRef = useRef(taskMap);
  if (!isDraggingRef.current && !isSettlingRef.current) {
    taskMapRef.current = taskMap;
  }

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const pan = useBoardDragPan<HTMLDivElement>();

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      isDraggingRef.current = true;
      const task = taskMapRef.current.get(event.active.id as string) ?? null;
      setActiveTask(task);
    },
    [isDraggingRef],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over || recentlyMovedRef.current) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      setColumns((prev) => {
        const activeCol = findColumn(prev, activeId, groupIds);
        const overCol = findColumn(prev, overId, groupIds);
        if (!activeCol || !overCol || activeCol === overCol) return prev;

        recentlyMovedRef.current = true;
        const oldIds = prev[activeCol]!.filter((id) => id !== activeId);
        const newIds = [...prev[overCol]!];
        const overIndex = newIds.indexOf(overId);
        const insertIndex = overIndex >= 0 ? overIndex : newIds.length;
        newIds.splice(insertIndex, 0, activeId);
        return { ...prev, [activeCol]: oldIds, [overCol]: newIds };
      });
    },
    [groupIds, recentlyMovedRef, setColumns],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      isDraggingRef.current = false;
      setActiveTask(null);

      const resetColumns = () => setColumns(buildColumns(tasks, groups));

      if (!over) {
        resetColumns();
        return;
      }

      const activeId = active.id as string;
      const overId = over.id as string;
      const cols = columnsRef.current;
      const activeCol = findColumn(cols, activeId, groupIds);
      const overCol = findColumn(cols, overId, groupIds);
      if (!activeCol || !overCol) {
        resetColumns();
        return;
      }

      let finalColumns = cols;
      if (activeCol === overCol) {
        const ids = cols[activeCol]!;
        const oldIndex = ids.indexOf(activeId);
        const newIndex = ids.indexOf(overId);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const reordered = arrayMove(ids, oldIndex, newIndex);
          finalColumns = { ...cols, [activeCol]: reordered };
          setColumns(finalColumns);
        }
      }

      const finalCol = findColumn(finalColumns, activeId, groupIds);
      if (!finalCol) {
        resetColumns();
        return;
      }
      const finalGroup = groupMap.get(finalCol);
      if (!finalGroup) {
        resetColumns();
        return;
      }

      const map = taskMapRef.current;
      const finalIds = finalColumns[finalCol]!;
      const newPosition = computePosition(finalIds, activeId, map);
      const currentTask = map.get(activeId);

      if (
        currentTask &&
        taskMatchesGroup(currentTask, finalGroup) &&
        currentTask.position === newPosition
      ) {
        return;
      }

      if (
        currentTask &&
        !taskMatchesGroup(currentTask, finalGroup) &&
        activeCol !== overCol
      ) {
        const targetIds = insertIdByPosition(
          (cols[overCol] ?? []).filter((id) => id !== activeId),
          activeId,
          newPosition,
          map,
        );
        setColumns((prev) => {
          const fromIds = (prev[activeCol] ?? []).filter(
            (cid) => cid !== activeId,
          );
          return { ...prev, [activeCol]: fromIds, [overCol]: targetIds };
        });
      }

      actions?.moveTask(
        activeId,
        getMoveUpdates(finalGroup, newPosition, currentTask),
        { onSettled: beginSettle() },
      );
    },
    [
      actions,
      beginSettle,
      columnsRef,
      groupIds,
      groupMap,
      groups,
      isDraggingRef,
      setColumns,
      tasks,
    ],
  );

  const handleDragCancel = useCallback(
    (_event: DragCancelEvent) => {
      isDraggingRef.current = false;
      setActiveTask(null);
      setColumns(buildColumns(tasks, groups));
    },
    [groups, isDraggingRef, setColumns, tasks],
  );

  const onCreateTask = useCallback(
    (defaults: { status?: string }) => {
      actions?.createTask(defaults);
    },
    [actions],
  );

  const hiddenCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const status of hiddenStatuses) {
      counts[status] = tasks.filter((task) => task.status === status).length;
    }
    return counts;
  }, [hiddenStatuses, tasks]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          ref={pan.ref}
          onPointerDown={pan.onPointerDown}
          onPointerMove={pan.onPointerMove}
          onPointerUp={pan.onPointerUp}
          onPointerCancel={pan.onPointerCancel}
          onLostPointerCapture={pan.onLostPointerCapture}
          className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 pb-4 pt-2"
        >
          {groups.map((group) => (
            <BoardColumn
              key={group.id}
              group={group}
              taskIds={columns[group.id] ?? EMPTY_IDS}
              taskMap={taskMapRef.current}
              totalCount={group.totalCount}
              onCreateTask={onCreateTask}
              onOpenTask={onOpenTask}
            />
          ))}
          {hiddenStatuses.length > 0 ? (
            <HiddenColumnsPanel
              hiddenStatuses={hiddenStatuses}
              taskCounts={hiddenCounts}
            />
          ) : null}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div
              style={{ width: BOARD_CARD_WIDTH }}
              className="rotate-1 cursor-grabbing opacity-90 shadow-lg shadow-black/10"
            >
              <BoardCardContent task={activeTask} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

export const BoardView = memo(BoardViewImpl);
