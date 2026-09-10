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
import { useTranslation } from "react-i18next";
import type { TaskGrouping } from "@uniwork/core/tasks/stores/view-store";
import type { Task, TaskStatus } from "@uniwork/core/types";
import type { ActorKind } from "@uniwork/core/types/audit";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import { BoardCardContent, type BoardCardMeta } from "./board-card";
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
  assigneeGroupId,
  projectGroupId,
  statusGroupId,
  taskMatchesGroup,
} from "./board-drag-utils";
import { HiddenColumnsPanel } from "./hidden-columns-panel";
import { useBoardDragPan } from "./use-board-drag-pan";
import { useDragSettle } from "./use-drag-settle";
import {
  useTaskSurfaceActionsOptional,
  type TaskCreateDefaults,
} from "../surface/actions-context";

const EMPTY_IDS: string[] = [];

/**
 * Suite TaskSurface board mode — kanban columns, cards, drag settle,
 * drag-pan, and Virtuoso. Separate from MVP `../board-view.tsx`.
 *
 * Property grouping stays stubbed until the property catalog is wired; agent
 * chips are gated in the card.
 */
function BoardViewImpl({
  categories,
  tasks,
  cardMeta,
  projects = [],
  onOpenTask,
}: {
  categories: readonly string[];
  tasks: Task[];
  cardMeta?: ReadonlyMap<string, BoardCardMeta>;
  projects?: readonly { id: string; title: string }[];
  onOpenTask?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const actions = useTaskSurfaceActionsOptional();
  const hiddenStatusCategories = useViewStore((s) => s.hiddenStatusCategories);
  const storedGrouping = useViewStore((s) => s.grouping);
  const sortBy = useViewStore((s) => s.sortBy);
  const grouping: Exclude<TaskGrouping, `property:${string}`> =
    storedGrouping === "assignee" || storedGrouping === "project"
      ? storedGrouping
      : "status";

  const visibleCategories = useMemo(
    () =>
      grouping === "status"
        ? categories.filter(
            (category) =>
              !hiddenStatusCategories.includes(category as TaskStatus),
          )
        : [],
    [categories, grouping, hiddenStatusCategories],
  );

  const hiddenStatuses = useMemo(
    () =>
      grouping === "status"
        ? categories.filter((category) =>
            hiddenStatusCategories.includes(category as TaskStatus),
          )
        : [],
    [categories, grouping, hiddenStatusCategories],
  );

  const groups = useMemo<BoardColumnGroup[]>(() => {
    if (grouping === "assignee") {
      const byId = new Map<string, BoardColumnGroup>();
      const unassigned: BoardColumnGroup = {
        id: assigneeGroupId("human", null),
        title: t("tasks.unassigned"),
        kind: "assignee",
        assigneeId: null,
        createData: { assignee_id: null },
      };
      byId.set(unassigned.id, unassigned);
      for (const task of tasks) {
        if (!task.assignee_id) continue;
        const kind = (task.assignee_kind || "human") as ActorKind;
        const id = assigneeGroupId(kind, task.assignee_id);
        if (byId.has(id)) continue;
        byId.set(id, {
          id,
          title: task.assignee?.display_name || task.assignee_id,
          kind: "assignee",
          assigneeId: task.assignee_id,
          assigneeKind: kind,
          createData: {
            assignee_id: task.assignee_id,
            assignee_kind: kind,
          },
        });
      }
      return [...byId.values()];
    }

    if (grouping === "project") {
      const byId = new Map<string, BoardColumnGroup>();
      const noProject: BoardColumnGroup = {
        id: projectGroupId(null),
        title: t("tasks.swimlane.no_project"),
        kind: "project",
        projectId: null,
      };
      byId.set(noProject.id, noProject);
      for (const project of projects) {
        byId.set(projectGroupId(project.id), {
          id: projectGroupId(project.id),
          title: project.title,
          kind: "project",
          projectId: project.id,
        });
      }
      for (const task of tasks) {
        if (!task.project_id) continue;
        const id = projectGroupId(task.project_id);
        if (byId.has(id)) continue;
        byId.set(id, {
          id,
          title: cardMeta?.get(task.id)?.projectName || task.project_id,
          kind: "project",
          projectId: task.project_id,
        });
      }
      return [...byId.values()];
    }

    return visibleCategories.map((status) => ({
      id: statusGroupId(status),
      title: status,
      kind: "status" as const,
      status,
      createData: { status },
    }));
  }, [cardMeta, grouping, projects, t, tasks, visibleCategories]);

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
    (defaults: TaskCreateDefaults) => {
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
  const sortLabel =
    sortBy === "position" ? null : t("tasks.display.sorted_drag_hint");

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
              cardMeta={cardMeta}
              totalCount={group.totalCount}
              onCreateTask={onCreateTask}
              onOpenTask={onOpenTask}
              sortLabel={sortLabel}
              disableDragging={grouping === "project"}
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
              <BoardCardContent
                task={activeTask}
                meta={cardMeta?.get(activeTask.id)}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

export const BoardView = memo(BoardViewImpl);
