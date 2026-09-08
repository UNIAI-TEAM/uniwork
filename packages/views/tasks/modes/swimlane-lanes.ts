import type { SwimlaneGrouping } from "@uniwork/core/tasks/stores/view-store-types";
import type { Task, TaskStatus } from "@uniwork/core/types";
import { NONE_LANE_ID, ORPHAN_LANE_ID } from "./swimlane-ids";

export type SwimLaneMoveTargetUpdates = {
  parent_task_id?: string | null;
  project_id?: string | null;
  assignee_id?: string | null;
  assignee_kind?: string | null;
  status?: string;
  position?: number;
};

export type SwimLaneMoveUpdates = SwimLaneMoveTargetUpdates & {
  before_id: string | null;
  after_id: string | null;
};

export interface LaneGroup {
  key: string;
  rawId: string;
  isPinned: boolean;
  isOrphan: boolean;
  title: string;
  identifier: string;
  parentTask: Pick<Task, "id" | "status" | "title" | "identifier"> | null;
  projectId: string | null;
  actor: { kind: string; id: string } | null;
  matches: (task: Task) => boolean;
  moveUpdates: SwimLaneMoveTargetUpdates;
  total?: number;
  serverCellKeys?: Partial<Record<TaskStatus, string>>;
}

export function buildParentLanes(
  visibleTasks: Task[],
  metadataTasks: Task[],
  storedOrder: string[],
  labels: { noParent: string; otherParents: string },
): LaneGroup[] {
  const metadataMap = new Map<string, Task>();
  for (const task of metadataTasks) metadataMap.set(task.id, task);

  const seen = new Map<string, LaneGroup>();
  let hasOrphan = false;
  for (const task of visibleTasks) {
    if (!task.parent_task_id) continue;
    const parent = metadataMap.get(task.parent_task_id);
    if (!parent) {
      hasOrphan = true;
      continue;
    }
    const key = `parent:${task.parent_task_id}`;
    if (!seen.has(key)) {
      const parentId = task.parent_task_id;
      seen.set(key, {
        key,
        rawId: parentId,
        isPinned: false,
        isOrphan: false,
        title: parent.title,
        identifier: parent.identifier,
        parentTask: parent,
        projectId: null,
        actor: null,
        matches: (row) => row.parent_task_id === parentId,
        moveUpdates: { parent_task_id: parentId },
      });
    }
  }

  const orderIndex = new Map<string, number>();
  storedOrder.forEach((parentId, idx) =>
    orderIndex.set(`parent:${parentId}`, idx),
  );
  const ordered = Array.from(seen.values()).sort((a, b) => {
    const ai = orderIndex.get(a.key);
    const bi = orderIndex.get(b.key);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return 0;
  });

  const lanes: LaneGroup[] = [
    {
      key: `parent:${NONE_LANE_ID}`,
      rawId: NONE_LANE_ID,
      isPinned: true,
      isOrphan: false,
      title: labels.noParent,
      identifier: "",
      parentTask: null,
      projectId: null,
      actor: null,
      matches: (row) => !row.parent_task_id,
      moveUpdates: { parent_task_id: null },
    },
  ];
  if (hasOrphan) {
    lanes.push({
      key: `parent:${ORPHAN_LANE_ID}`,
      rawId: ORPHAN_LANE_ID,
      isPinned: true,
      isOrphan: true,
      title: labels.otherParents,
      identifier: "",
      parentTask: null,
      projectId: null,
      actor: null,
      matches: () => false,
      moveUpdates: {},
    });
  }
  lanes.push(...ordered);
  return lanes;
}

export function buildProjectLanes(
  visibleTasks: Task[],
  projectTitles: Map<string, string>,
  storedOrder: string[],
  labels: { noProject: string },
): LaneGroup[] {
  const seen = new Map<string, LaneGroup>();
  for (const task of visibleTasks) {
    if (!task.project_id) continue;
    const key = `project:${task.project_id}`;
    if (seen.has(key)) continue;
    const projectId = task.project_id;
    seen.set(key, {
      key,
      rawId: projectId,
      isPinned: false,
      isOrphan: false,
      title: projectTitles.get(projectId) ?? projectId,
      identifier: "",
      parentTask: null,
      projectId,
      actor: null,
      matches: (row) => row.project_id === projectId,
      moveUpdates: { project_id: projectId },
    });
  }

  const orderIndex = new Map<string, number>();
  storedOrder.forEach((id, idx) => orderIndex.set(`project:${id}`, idx));
  const ordered = Array.from(seen.values()).sort((a, b) => {
    const ai = orderIndex.get(a.key);
    const bi = orderIndex.get(b.key);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return a.title.localeCompare(b.title);
  });

  return [
    {
      key: `project:${NONE_LANE_ID}`,
      rawId: NONE_LANE_ID,
      isPinned: true,
      isOrphan: false,
      title: labels.noProject,
      identifier: "",
      parentTask: null,
      projectId: null,
      actor: null,
      matches: (row) => !row.project_id,
      moveUpdates: { project_id: null },
    },
    ...ordered,
  ];
}

export function buildAssigneeLanes(
  visibleTasks: Task[],
  getActorName: (kind: string, id: string) => string,
  storedOrder: string[],
  labels: { noAssignee: string },
): LaneGroup[] {
  const seen = new Map<string, LaneGroup>();
  for (const task of visibleTasks) {
    if (!task.assignee_id) continue;
    const kind = task.assignee_kind || "human";
    const assigneeId = task.assignee_id;
    const rawId = `${kind}:${assigneeId}`;
    const key = `assignee:${rawId}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      key,
      rawId,
      isPinned: false,
      isOrphan: false,
      title: getActorName(kind, assigneeId),
      identifier: "",
      parentTask: null,
      projectId: null,
      actor: { kind, id: assigneeId },
      matches: (row) =>
        (row.assignee_kind || "human") === kind &&
        row.assignee_id === assigneeId,
      moveUpdates: {
        assignee_kind: kind,
        assignee_id: assigneeId,
      },
    });
  }

  const typeOrder: Record<string, number> = {
    human: 0,
    member: 0,
    agent: 1,
  };
  const orderIndex = new Map<string, number>();
  storedOrder.forEach((id, idx) => orderIndex.set(`assignee:${id}`, idx));
  const ordered = Array.from(seen.values()).sort((a, b) => {
    const ai = orderIndex.get(a.key);
    const bi = orderIndex.get(b.key);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    const ta = typeOrder[a.actor?.kind ?? ""] ?? 9;
    const tb = typeOrder[b.actor?.kind ?? ""] ?? 9;
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title);
  });

  return [
    {
      key: `assignee:${NONE_LANE_ID}`,
      rawId: NONE_LANE_ID,
      isPinned: true,
      isOrphan: false,
      title: labels.noAssignee,
      identifier: "",
      parentTask: null,
      projectId: null,
      actor: null,
      matches: (row) => !row.assignee_id,
      moveUpdates: { assignee_id: null, assignee_kind: null },
    },
    ...ordered,
  ];
}

export function buildLanesForGrouping(
  grouping: SwimlaneGrouping,
  tasks: Task[],
  metadataTasks: Task[],
  storedOrder: string[],
  labels: {
    noParent: string;
    otherParents: string;
    noProject: string;
    noAssignee: string;
  },
  getActorName: (kind: string, id: string) => string,
  projectTitles: Map<string, string>,
): LaneGroup[] {
  if (grouping === "project") {
    return buildProjectLanes(tasks, projectTitles, storedOrder, labels);
  }
  if (grouping === "assignee") {
    return buildAssigneeLanes(tasks, getActorName, storedOrder, labels);
  }
  return buildParentLanes(tasks, metadataTasks, storedOrder, labels);
}
