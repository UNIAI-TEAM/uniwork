import { z } from "zod";
import {
  ChildProgressSchema,
  TaskDependencySchema,
  TaskGroupSchema,
  TaskQueryPageSchema,
  TaskSchema,
  type ChildProgress,
  type Task,
  type TaskDependency,
  type TaskGroup,
  type TaskPriority,
  type TaskQueryPage,
  type TaskStatus,
} from "../../types/task";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const TaskResponse = z.object({ task: TaskSchema });
const TasksResponse = z.object({ tasks: z.array(TaskSchema) });
const GroupedResponse = z.object({ groups: z.array(TaskGroupSchema) });
const BatchUpdateResponse = z.object({ updated: z.number() });
const BatchDeleteResponse = z.object({ deleted: z.number() });
const ChildProgressResponse = z.object({ progress: z.array(ChildProgressSchema) });
const DependencyResponse = z.object({ dependency: TaskDependencySchema });

export interface QueryTasksBody {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface PutTaskBody {
  revision?: number;
  title?: string;
  status?: TaskStatus | string;
  priority?: TaskPriority | string;
  position?: number;
  description?: string;
  assignee_id?: string | null;
  assignee_kind?: string;
  due_date?: string | null;
}

export interface BatchUpdateBody {
  task_ids: string[];
  updates: {
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    position?: number;
    assignee_id?: string | null;
    assignee_kind?: string;
    due_date?: string | null;
  };
}

export interface SetTaskParentBody {
  parent_task_id?: string | null;
}

export interface SetTaskDependencyBody {
  depends_on_task_id: string;
  type: string;
}

const enc = encodeURIComponent;

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function queryTasks(workspaceId: string, body: QueryTasksBody = {}): Promise<TaskQueryPage> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/tasks/query`, {
    method: "POST",
    body,
  });
  return parseWithFallback<TaskQueryPage>(
    raw,
    TaskQueryPageSchema,
    { tasks: [], total: 0, limit: 0, offset: 0 },
    { endpoint: "POST /api/v1/workspaces/{ws}/tasks/query" },
  );
}

export async function groupedTasks(
  workspaceId: string,
  opts: { group_by?: string; status?: string; limit?: number; offset?: number } = {},
): Promise<TaskGroup[]> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/tasks/grouped${qs(opts)}`,
  );
  return parseWithFallback<{ groups: TaskGroup[] }>(raw, GroupedResponse, { groups: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/tasks/grouped",
  }).groups;
}

export async function putTask(
  taskId: string,
  body: PutTaskBody,
  opts?: { ifMatch?: string; idempotencyKey?: string },
): Promise<Task | null> {
  const headers: Record<string, string> = {};
  if (opts?.ifMatch) headers["If-Match"] = opts.ifMatch;
  if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const raw = await request(`/api/v1/tasks/${enc(taskId)}`, {
    method: "PUT",
    body,
    headers,
  });
  return parseWithFallback<{ task: Task } | null>(raw, TaskResponse, null, {
    endpoint: "PUT /api/v1/tasks/{id}",
  })?.task ?? null;
}

export async function batchUpdateTasks(
  workspaceId: string,
  body: BatchUpdateBody,
): Promise<number> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/tasks/batch-update`, {
    method: "POST",
    body,
  });
  return parseWithFallback<{ updated: number }>(raw, BatchUpdateResponse, { updated: 0 }, {
    endpoint: "POST /api/v1/workspaces/{ws}/tasks/batch-update",
  }).updated;
}

export async function batchDeleteTasks(workspaceId: string, taskIds: string[]): Promise<number> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/tasks/batch-delete`, {
    method: "POST",
    body: { task_ids: taskIds },
  });
  return parseWithFallback<{ deleted: number }>(raw, BatchDeleteResponse, { deleted: 0 }, {
    endpoint: "POST /api/v1/workspaces/{ws}/tasks/batch-delete",
  }).deleted;
}

export async function listMyTasks(
  workspaceId: string,
  opts: {
    relation?: "all" | "assigned" | "created" | "involved";
    limit?: number;
    offset?: number;
  } = {},
): Promise<TaskQueryPage> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/my-tasks${qs(opts)}`);
  return parseWithFallback<TaskQueryPage>(
    raw,
    TaskQueryPageSchema,
    { tasks: [], total: 0, limit: 0, offset: 0 },
    { endpoint: "GET /api/v1/workspaces/{ws}/my-tasks" },
  );
}

export async function listTaskChildren(taskId: string): Promise<Task[]> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/children`);
  return parseWithFallback<{ tasks: Task[] }>(raw, TasksResponse, { tasks: [] }, {
    endpoint: "GET /api/v1/tasks/{id}/children",
  }).tasks;
}

export async function listChildrenByParents(
  workspaceId: string,
  parentIds: string[],
): Promise<Task[]> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/tasks/children${qs({ parent_ids: parentIds.join(",") })}`,
  );
  return parseWithFallback<{ tasks: Task[] }>(raw, TasksResponse, { tasks: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/tasks/children",
  }).tasks;
}

export async function childTaskProgress(workspaceId: string): Promise<ChildProgress[]> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/tasks/child-progress`);
  return parseWithFallback<{ progress: ChildProgress[] }>(raw, ChildProgressResponse, { progress: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/tasks/child-progress",
  }).progress;
}

export async function setTaskParent(taskId: string, body: SetTaskParentBody): Promise<Task | null> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/parent`, { method: "PUT", body });
  return parseWithFallback<{ task: Task } | null>(raw, TaskResponse, null, {
    endpoint: "PUT /api/v1/tasks/{id}/parent",
  })?.task ?? null;
}

export async function setTaskDependency(
  taskId: string,
  body: SetTaskDependencyBody,
): Promise<TaskDependency | null> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/dependencies`, {
    method: "POST",
    body,
  });
  return parseWithFallback<{ dependency: TaskDependency } | null>(raw, DependencyResponse, null, {
    endpoint: "POST /api/v1/tasks/{id}/dependencies",
  })?.dependency ?? null;
}

export async function removeTaskDependency(
  taskId: string,
  dependsOnTaskId: string,
  type?: string,
): Promise<void> {
  await request(
    `/api/v1/tasks/${enc(taskId)}/dependencies/${enc(dependsOnTaskId)}${qs({ type })}`,
    { method: "DELETE" },
  );
}
