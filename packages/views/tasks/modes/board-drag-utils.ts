import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
} from "@dnd-kit/core";
import type { Task, TaskStatus } from "@uniwork/core/types";
import type { BoardColumnGroup } from "./board-column";

export type DragMoveUpdates = {
  status?: TaskStatus;
  position: number;
};

export function makeKanbanCollision(groupIds: Set<string>): CollisionDetection {
  return (args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) {
      const items = pointer.filter((c) => !groupIds.has(c.id as string));
      if (items.length > 0) return items;
      return pointer;
    }
    return closestCenter(args);
  };
}

export function statusGroupId(status: string): string {
  return `status:${status}`;
}

export function buildColumns(
  tasks: Task[],
  groups: BoardColumnGroup[],
): Record<string, string[]> {
  const cols: Record<string, string[]> = {};
  for (const group of groups) cols[group.id] = [];
  for (const task of tasks) {
    const gid = statusGroupId(task.status);
    if (cols[gid]) cols[gid].push(task.id);
  }
  return cols;
}

export function computePosition(
  ids: string[],
  activeId: string,
  taskMap: Map<string, Task>,
): number {
  const idx = ids.indexOf(activeId);
  if (idx === -1) return 0;
  const getPos = (id: string) => taskMap.get(id)?.position ?? 0;
  if (ids.length === 1) return taskMap.get(activeId)?.position ?? 0;
  if (idx === 0) return getPos(ids[1]!) - 1;
  if (idx === ids.length - 1) return getPos(ids[idx - 1]!) + 1;
  return (getPos(ids[idx - 1]!) + getPos(ids[idx + 1]!)) / 2;
}

export function insertIdByPosition(
  ids: string[],
  id: string,
  position: number,
  taskMap: Map<string, Task>,
): string[] {
  const idx = ids.findIndex((existing) => {
    const p = taskMap.get(existing)?.position;
    return p !== undefined && p > position;
  });
  if (idx === -1) return [...ids, id];
  return [...ids.slice(0, idx), id, ...ids.slice(idx)];
}

export function findColumn(
  columns: Record<string, string[]>,
  id: string,
  columnIds: Set<string>,
): string | null {
  if (columnIds.has(id)) return id;
  for (const [columnId, ids] of Object.entries(columns)) {
    if (ids.includes(id)) return columnId;
  }
  return null;
}

export function taskMatchesGroup(task: Task, group: BoardColumnGroup): boolean {
  if (group.status) return task.status === group.status;
  return false;
}

export function getMoveUpdates(
  group: BoardColumnGroup,
  position: number,
  task?: Pick<Task, "status">,
): DragMoveUpdates {
  if (group.status) {
    if (task && task.status === group.status) return { position };
    return { status: group.status as TaskStatus, position };
  }
  return { position };
}
