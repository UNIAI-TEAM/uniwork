import type { Task, TaskPriority } from "@uniwork/core/types";
import type { ActorFilterValue } from "@uniwork/core/tasks/stores/view-store-types";

export interface TaskFilters {
  statusFilters: string[];
  priorityFilters: TaskPriority[];
  assigneeFilters: ActorFilterValue[];
  includeNoAssignee: boolean;
  /** Keeps an explicitly active assignee predicate distinct from the normal
   *  empty-array = no-filter state. When true with no selected assignees and
   *  includeNoAssignee=false, the predicate intentionally matches nothing. */
  assigneeFilterActive?: boolean;
  creatorFilters: ActorFilterValue[];
  projectFilters: string[];
  includeNoProject: boolean;
  labelFilters: string[];
  /** Custom-property filters: definition id → selected option ids (OR within
   *  a definition, AND across definitions; checkbox uses "true"/"false"). */
  propertyFilters?: Record<string, string[]>;
  agentRunningFilter?: boolean;
  runningTaskIds?: ReadonlySet<string>;
  /** When explicitly `false`, hide tasks that have a parent. */
  showSubTasks?: boolean;
}

export interface TaskFilterState {
  statusFilters: string[];
  priorityFilters: TaskPriority[];
  assigneeFilters: ActorFilterValue[];
  includeNoAssignee: boolean;
  assigneeFilterActive?: boolean;
  creatorFilters: ActorFilterValue[];
  projectFilters: string[];
  includeNoProject: boolean;
  labelFilters: string[];
  propertyFilters?: Record<string, string[]>;
  workingOnly: boolean;
  showSubTasks?: boolean;
}

export interface TaskFilterContext {
  runningTaskIds?: ReadonlySet<string>;
  labelsByTaskId?: ReadonlyMap<string, readonly { id: string }[]>;
}

export const NO_PROPERTY_VALUE = "__none__";

function actorKindMatches(
  filterType: ActorFilterValue["type"],
  taskKind: string | undefined,
): boolean {
  if (filterType === "member") return taskKind === "human" || taskKind === "member";
  if (filterType === "agent") return taskKind === "agent";
  return false;
}

function actorMatchesFilter(
  filter: ActorFilterValue,
  actorId: string | undefined,
  actorKind: string | undefined,
): boolean {
  if (!actorId) return false;
  return actorKindMatches(filter.type, actorKind) && filter.id === actorId;
}

export function taskMatchesPropertyFilters(
  task: Task,
  propertyFilters: Record<string, string[]> | undefined,
): boolean {
  if (!propertyFilters) return true;
  for (const [propertyId, selected] of Object.entries(propertyFilters)) {
    if (selected.length === 0) continue;
    const value = task.properties?.[propertyId];
    if (value === undefined) {
      if (selected.includes(NO_PROPERTY_VALUE)) continue;
      return false;
    }
    if (typeof value === "string") {
      if (!selected.includes(value)) return false;
    } else if (Array.isArray(value)) {
      if (!value.some((id) => selected.includes(String(id)))) return false;
    } else if (typeof value === "boolean") {
      if (!selected.includes(String(value))) return false;
    } else {
      return false;
    }
  }
  return true;
}

function taskIsWorking(taskId: string, context: TaskFilterContext): boolean {
  return context.runningTaskIds?.has(taskId) === true;
}

export function applyTaskFilters(
  tasks: Task[],
  filters: TaskFilterState,
  context: TaskFilterContext = {},
): Task[] {
  const {
    statusFilters,
    priorityFilters,
    assigneeFilters,
    includeNoAssignee,
    creatorFilters,
    projectFilters,
    includeNoProject,
    labelFilters,
    workingOnly,
  } = filters;
  const hasAssigneeFilter =
    filters.assigneeFilterActive === true ||
    assigneeFilters.length > 0 ||
    includeNoAssignee;
  const hasProjectFilter = projectFilters.length > 0 || includeNoProject;
  const applyWorkingOnly = workingOnly === true;
  const hideSubTasks = filters.showSubTasks === false;

  return tasks.filter((task) => {
    if (applyWorkingOnly && !taskIsWorking(task.id, context)) return false;

    if (hideSubTasks && task.parent_task_id) return false;

    if (statusFilters.length > 0 && !statusFilters.includes(task.status))
      return false;

    if (priorityFilters.length > 0 && !priorityFilters.includes(task.priority))
      return false;

    if (hasAssigneeFilter) {
      if (!task.assignee_id) {
        if (!includeNoAssignee) return false;
      } else if (assigneeFilters.length > 0) {
        if (
          !assigneeFilters.some((f) =>
            actorMatchesFilter(f, task.assignee_id, task.assignee_kind),
          )
        ) {
          return false;
        }
      } else {
        return false;
      }
    }

    if (
      creatorFilters.length > 0 &&
      !creatorFilters.some((f) =>
        actorMatchesFilter(f, task.created_by, task.created_by_kind),
      )
    ) {
      return false;
    }

    if (hasProjectFilter) {
      if (!task.project_id) {
        if (!includeNoProject) return false;
      } else if (projectFilters.length > 0) {
        if (!projectFilters.includes(task.project_id)) return false;
      } else {
        return false;
      }
    }

    if (labelFilters.length > 0) {
      const labelsByTaskId = context.labelsByTaskId;
      if (!labelsByTaskId) return false;
      const taskLabels = labelsByTaskId.get(task.id);
      if (!taskLabels || taskLabels.length === 0) return false;
      if (!taskLabels.some((l) => labelFilters.includes(l.id))) return false;
    }

    if (!taskMatchesPropertyFilters(task, filters.propertyFilters)) return false;

    return true;
  });
}

export function filterTasks(tasks: Task[], filters: TaskFilters): Task[] {
  return applyTaskFilters(
    tasks,
    {
      statusFilters: filters.statusFilters,
      priorityFilters: filters.priorityFilters,
      assigneeFilters: filters.assigneeFilters,
      includeNoAssignee: filters.includeNoAssignee,
      assigneeFilterActive: filters.assigneeFilterActive,
      creatorFilters: filters.creatorFilters,
      projectFilters: filters.projectFilters,
      includeNoProject: filters.includeNoProject,
      labelFilters: filters.labelFilters,
      propertyFilters: filters.propertyFilters,
      workingOnly: filters.agentRunningFilter === true,
      showSubTasks: filters.showSubTasks,
    },
    { runningTaskIds: filters.runningTaskIds },
  );
}
