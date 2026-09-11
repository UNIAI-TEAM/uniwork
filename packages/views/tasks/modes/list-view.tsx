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
  useDroppable,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronRight, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import type { Task, TaskStatus } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@uniwork/ui/components/ui/collapsible";
import { cn } from "@uniwork/ui/lib/utils";
import type { BoardCardMeta } from "./board-card";
import type { BoardColumnGroup } from "./board-column";
import { StatusPill } from "./status-pill";
import {
  buildColumns,
  computePosition,
  findColumn,
  getMoveUpdates,
  makeKanbanCollision,
  statusGroupId,
  taskMatchesGroup,
} from "./board-drag-utils";
import { STATUS_CONFIG } from "./status-config";
import { DraggableTaskListRow, TaskListRow } from "./list-row";
import { useDragSettle } from "./use-drag-settle";
import { useTaskSurfaceActionsOptional } from "../surface/actions-context";
import { useTaskSurfaceSelectionOptional } from "../surface/selection-context";

const EMPTY_IDS: string[] = [];
const LIST_ROW_HEIGHT = 36;
const VIRTUALIZE_THRESHOLD = 50;

function ListStatusSection({
  status,
  taskIds,
  taskMap,
  cardMeta,
  onOpenTask,
  onCreateTask,
  dragEnabled,
  sortLabel,
  scrollParent,
  isExpanded,
  onExpandedChange,
}: {
  status: string;
  taskIds: string[];
  taskMap: ReadonlyMap<string, Task>;
  cardMeta?: ReadonlyMap<string, BoardCardMeta>;
  onOpenTask?: (id: string) => void;
  onCreateTask?: (status: string) => void;
  dragEnabled: boolean;
  sortLabel: string | null;
  scrollParent: HTMLElement | null;
  isExpanded: boolean;
  onExpandedChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const selection = useTaskSurfaceSelectionOptional();
  const { setNodeRef, isOver } = useDroppable({
    id: statusGroupId(status),
    disabled: !dragEnabled,
  });
  const tasks = useMemo(
    () => taskIds.flatMap((id) => (taskMap.get(id) ? [taskMap.get(id)!] : [])),
    [taskIds, taskMap],
  );
  const selectedCount = selection
    ? taskIds.filter((id) => selection.selectedIds.has(id)).length
    : 0;
  const allSelected = tasks.length > 0 && selectedCount === tasks.length;
  const cfg = STATUS_CONFIG[status as TaskStatus];
  const labelKey = `tasks.status_${status}`;
  const translated = t(labelKey);
  const label = translated === labelKey ? status : translated;

  const renderRow = (_index: number, task: Task) =>
    dragEnabled ? (
      <DraggableTaskListRow
        task={task}
        meta={cardMeta?.get(task.id)}
        onOpenTask={onOpenTask}
        disableSorting={!!sortLabel}
      />
    ) : (
      <TaskListRow
        task={task}
        meta={cardMeta?.get(task.id)}
        onOpenTask={onOpenTask}
      />
    );

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onExpandedChange}
      ref={dragEnabled ? setNodeRef : undefined}
      data-testid={`list-group-${status}`}
      className={cn(
        "rounded-lg",
        isOver && "bg-accent/20 ring-2 ring-brand/25",
      )}
    >
      <div className="group/header sticky top-0 z-10 flex h-10 items-center rounded-lg bg-muted transition-colors hover:bg-accent">
        {selection ? (
          <div className="flex items-center pl-3">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(element) => {
                if (element) {
                  element.indeterminate = selectedCount > 0 && !allSelected;
                }
              }}
              aria-label={t("tasks.list.select_status", { status: label })}
              onChange={() => {
                if (allSelected) selection.deselect(taskIds);
                else selection.select(taskIds);
              }}
              className="cursor-pointer accent-primary"
            />
          </div>
        ) : null}
        <CollapsibleTrigger
          className="group/trigger flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left"
          aria-label={`${label}, ${tasks.length}`}
        >
          <ChevronRight
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-aria-expanded/trigger:rotate-90"
            aria-hidden
          />
          <StatusPill status={status} label={label} />
          <span className="text-caption font-medium tabular-nums text-muted-foreground">
            {tasks.length}
          </span>
        </CollapsibleTrigger>
        {onCreateTask ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="mr-2 rounded-full text-muted-foreground"
            aria-label={t("tasks.list.add_task", { status: label })}
            onClick={() => onCreateTask(status)}
          >
            <Plus className="size-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
      <CollapsibleContent>
        {tasks.length === 0 ? (
          <p className="py-6 text-center text-caption text-muted-foreground">
            {t("tasks.surface.empty_column")}
          </p>
        ) : dragEnabled ? (
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            {tasks.length > VIRTUALIZE_THRESHOLD && scrollParent ? (
              <Virtuoso
                customScrollParent={scrollParent}
                data={tasks}
                computeItemKey={(_index, task) => task.id}
                defaultItemHeight={LIST_ROW_HEIGHT}
                increaseViewportBy={{ top: 360, bottom: 360 }}
                itemContent={renderRow}
              />
            ) : (
              tasks.map((task, index) => (
                <div key={task.id}>{renderRow(index, task)}</div>
              ))
            )}
          </SortableContext>
        ) : (
          tasks.map((task, index) => (
            <div key={task.id}>{renderRow(index, task)}</div>
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ListViewImpl({
  categories,
  tasks,
  cardMeta,
  onOpenTask,
}: {
  categories: readonly string[];
  tasks: Task[];
  cardMeta?: ReadonlyMap<string, BoardCardMeta>;
  onOpenTask?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const actions = useTaskSurfaceActionsOptional();
  const collapsed = useViewStore((state) => state.listCollapsedStatuses);
  const toggleCollapsed = useViewStore((state) => state.toggleListCollapsed);
  const hidden = useViewStore((state) => state.hiddenStatusCategories);
  const sortBy = useViewStore((state) => state.sortBy);
  const visibleStatuses = useMemo(
    () =>
      categories.filter(
        (status) => !hidden.includes(status as TaskStatus),
      ),
    [categories, hidden],
  );
  const groups = useMemo<BoardColumnGroup[]>(
    () =>
      visibleStatuses.map((status) => ({
        id: statusGroupId(status),
        title: status,
        kind: "status",
        status,
        createData: { status },
      })),
    [visibleStatuses],
  );
  const groupIds = useMemo(
    () => new Set(groups.map((group) => group.id)),
    [groups],
  );
  const groupMap = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
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
  const taskMap = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const taskMapRef = useRef(taskMap);
  if (!isDraggingRef.current && !isSettlingRef.current) {
    taskMapRef.current = taskMap;
  }
  useEffect(() => {
    if (!isDraggingRef.current && !isSettlingRef.current) {
      setColumns(buildColumns(tasks, groups));
    }
  }, [groups, isDraggingRef, isSettlingRef, setColumns, settleVersion, tasks]);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const collisionDetection = useMemo(
    () => makeKanbanCollision(groupIds),
    [groupIds],
  );
  const expanded = useMemo(
    () =>
      visibleStatuses.filter(
        (status) => !collapsed.includes(status as TaskStatus),
      ),
    [collapsed, visibleStatuses],
  );
  const dragEnabled = !!actions;
  const sortLabel =
    sortBy === "position" ? null : t("tasks.display.sorted_drag_hint");

  const resetColumns = useCallback(() => {
    setColumns(buildColumns(tasks, groups));
  }, [groups, setColumns, tasks]);
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      isDraggingRef.current = true;
      setActiveTask(taskMapRef.current.get(event.active.id as string) ?? null);
    },
    [isDraggingRef],
  );
  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (sortBy !== "position" || !event.over || recentlyMovedRef.current) return;
      const activeId = event.active.id as string;
      const overId = event.over.id as string;
      setColumns((current) => {
        const from = findColumn(current, activeId, groupIds);
        const to = findColumn(current, overId, groupIds);
        if (!from || !to || from === to) return current;
        recentlyMovedRef.current = true;
        const nextTarget = [...(current[to] ?? [])];
        const overIndex = nextTarget.indexOf(overId);
        nextTarget.splice(overIndex < 0 ? nextTarget.length : overIndex, 0, activeId);
        return {
          ...current,
          [from]: (current[from] ?? []).filter((id) => id !== activeId),
          [to]: nextTarget,
        };
      });
    },
    [groupIds, recentlyMovedRef, setColumns, sortBy],
  );
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      isDraggingRef.current = false;
      setActiveTask(null);
      if (!event.over || !actions) {
        resetColumns();
        return;
      }
      const activeId = event.active.id as string;
      const overId = event.over.id as string;
      const current = columnsRef.current;
      const activeGroup = findColumn(current, activeId, groupIds);
      const overGroup = findColumn(current, overId, groupIds);
      if (!activeGroup || !overGroup) {
        resetColumns();
        return;
      }
      let next = current;
      if (activeGroup === overGroup && sortBy === "position") {
        const ids = current[activeGroup] ?? [];
        const from = ids.indexOf(activeId);
        const to = ids.indexOf(overId);
        if (from >= 0 && to >= 0 && from !== to) {
          next = { ...current, [activeGroup]: arrayMove(ids, from, to) };
          setColumns(next);
        }
      }
      const destinationId =
        sortBy === "position"
          ? findColumn(next, activeId, groupIds)
          : overGroup;
      const destination = destinationId ? groupMap.get(destinationId) : undefined;
      const task = taskMapRef.current.get(activeId);
      if (!destination || !task) {
        resetColumns();
        return;
      }
      const destinationIds = next[destination.id] ?? [];
      const position =
        sortBy === "position"
          ? computePosition(destinationIds, activeId, taskMapRef.current)
          : task.position;
      if (taskMatchesGroup(task, destination) && task.position === position) return;
      actions.moveTask(activeId, getMoveUpdates(destination, position, task), {
        onSettled: beginSettle(),
      });
    },
    [
      actions,
      beginSettle,
      columnsRef,
      groupIds,
      groupMap,
      isDraggingRef,
      resetColumns,
      setColumns,
      sortBy,
    ],
  );
  const handleDragCancel = useCallback(
    (_event: DragCancelEvent) => {
      isDraggingRef.current = false;
      setActiveTask(null);
      resetColumns();
    },
    [isDraggingRef, resetColumns],
  );

  const content = (
    <div className="space-y-1">
      {visibleStatuses.map((status) => (
        <ListStatusSection
          key={status}
          status={status}
          taskIds={columns[statusGroupId(status)] ?? EMPTY_IDS}
          taskMap={taskMapRef.current}
          cardMeta={cardMeta}
          onOpenTask={onOpenTask}
          onCreateTask={
            actions
              ? (value) => actions.createTask({ status: value })
              : undefined
          }
          dragEnabled={dragEnabled}
          sortLabel={sortLabel}
          scrollParent={scrollParent}
          isExpanded={expanded.includes(status)}
          onExpandedChange={() => {
            if (!isDraggingRef.current) {
              toggleCollapsed(status as TaskStatus);
            }
          }}
        />
      ))}
    </div>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        ref={setScrollParent}
        data-tab-scroll-root="list"
        className="min-h-0 flex-1 overflow-y-auto p-2 pt-0"
      >
        {content}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="max-w-2xl rotate-1 rounded-md border border-border bg-card px-4 py-2 opacity-90 shadow-lg shadow-black/10">
            <span className="mr-2 text-caption text-muted-foreground">
              {activeTask.identifier}
            </span>
            <span className="text-body">{activeTask.title}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export const ListView = memo(ListViewImpl);
