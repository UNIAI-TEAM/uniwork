import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
} from "@dnd-kit/core";
import type { Task, TaskStatus } from "@uniwork/core/types";
import type { ActorKind } from "@uniwork/core/types/audit";
import type { BoardColumnGroup } from "./board-column";

export type DragMoveUpdates = {
  status?: TaskStatus;
  assignee_id?: string | null;
  assignee_kind?: ActorKind;
  position: number;
};

const EMPTY_GROUP_VALUE = "__none__";

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

export function assigneeGroupId(
  kind: ActorKind | string,
  assigneeId: string | null,
): string {
  return `assignee:${kind}:${assigneeId ?? EMPTY_GROUP_VALUE}`;
}

export function projectGroupId(projectId: string | null): string {
  return `project:${projectId ?? EMPTY_GROUP_VALUE}`;
}

export function buildColumns(
  tasks: Task[],
  groups: BoardColumnGroup[],
): Record<string, string[]> {
  const cols: Record<string, string[]> = {};
  for (const group of groups) cols[group.id] = [];
  for (const task of tasks) {
    const group = groups.find((candidate) => taskMatchesGroup(task, candidate));
    if (group) cols[group.id]!.push(task.id);
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
  if (group.kind === "status") return task.status === group.status;
  if (group.kind === "project") {
    return (task.project_id ?? null) === group.projectId;
  }
  const taskKind = (task.assignee_kind || "human") as ActorKind;
  return (
    (task.assignee_id ?? null) === group.assigneeId &&
    (group.assigneeId === null || taskKind === (group.assigneeKind ?? "human"))
  );
}

export function getMoveUpdates(
  group: BoardColumnGroup,
  position: number,
  task?: Pick<
    Task,
    "status" | "assignee_id" | "assignee_kind" | "project_id"
  >,
): DragMoveUpdates {
  if (group.kind === "status") {
    if (task && task.status === group.status) return { position };
    return { status: group.status as TaskStatus, position };
  }
  if (group.kind === "assignee") {
    const taskKind = (task?.assignee_kind || "human") as ActorKind;
    const alreadyMatches =
      task !== undefined &&
      (task.assignee_id ?? null) === group.assigneeId &&
      (group.assigneeId === null ||
        taskKind === (group.assigneeKind ?? "human"));
    if (alreadyMatches) return { position };
    return {
      position,
      assignee_id: group.assigneeId,
      ...(group.assigneeId
        ? { assignee_kind: group.assigneeKind ?? "human" }
        : {}),
    };
  }
  return { position };
}
