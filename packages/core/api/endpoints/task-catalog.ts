import { z } from "zod";
import {
  TaskCatalogStatusSchema,
  TaskLabelSchema,
  TaskPropertySchema,
  type TaskCatalogStatus,
  type TaskLabel,
  type TaskProperty,
} from "../../types/task-catalog";
import { TaskSchema, type Task } from "../../types/task";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const StatusListResponse = z.object({
  statuses: z.array(TaskCatalogStatusSchema),
  categories: z.array(z.string()),
  total: z.number(),
});
const StatusResponse = z.object({ status: TaskCatalogStatusSchema });
const LabelListResponse = z.object({
  labels: z.array(TaskLabelSchema),
  total: z.number(),
});
const LabelResponse = z.object({ label: TaskLabelSchema });
const PropertyListResponse = z.object({
  properties: z.array(TaskPropertySchema),
  total: z.number(),
});
const PropertyResponse = z.object({ property: TaskPropertySchema });
const TaskResponse = z.object({ task: TaskSchema });

export type TaskStatusList = z.infer<typeof StatusListResponse>;
export type TaskLabelList = z.infer<typeof LabelListResponse>;
export type TaskPropertyList = z.infer<typeof PropertyListResponse>;

export interface CreateTaskStatusBody {
  key?: string;
  name: string;
  description?: string;
  category: string;
  color?: string;
}

export interface PatchTaskStatusBody {
  name?: string;
  description?: string;
  color?: string;
  position?: number;
}

export interface CreateTaskLabelBody {
  name: string;
  description?: string;
  color?: string;
}

export interface PutTaskLabelBody {
  name?: string;
  description?: string;
  color?: string;
}

export interface CreateTaskPropertyBody {
  name: string;
  type: string;
  description?: string;
  config?: unknown;
}

export interface PatchTaskPropertyBody {
  name?: string;
  description?: string;
  config?: unknown;
  archived?: boolean;
}

const enc = encodeURIComponent;

export async function listTaskStatuses(workspaceId: string): Promise<TaskStatusList> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-statuses`);
  return parseWithFallback(raw, StatusListResponse, { statuses: [], categories: [], total: 0 }, {
    endpoint: "GET /api/v1/workspaces/{ws}/task-statuses",
  });
}

export async function createTaskStatus(
  workspaceId: string,
  body: CreateTaskStatusBody,
): Promise<TaskCatalogStatus | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-statuses`, {
    method: "POST",
    body,
  });
  return parseWithFallback<{ status: TaskCatalogStatus } | null>(raw, StatusResponse, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/task-statuses",
  })?.status ?? null;
}

export async function patchTaskStatus(
  workspaceId: string,
  id: string,
  body: PatchTaskStatusBody,
): Promise<TaskCatalogStatus | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-statuses/${enc(id)}`, {
    method: "PATCH",
    body,
  });
  return parseWithFallback<{ status: TaskCatalogStatus } | null>(raw, StatusResponse, null, {
    endpoint: "PATCH /api/v1/workspaces/{ws}/task-statuses/{id}",
  })?.status ?? null;
}

export async function reorderTaskStatuses(
  workspaceId: string,
  body: { category: string; ids: string[] },
): Promise<TaskStatusList> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-statuses/reorder`, {
    method: "PATCH",
    body,
  });
  return parseWithFallback(raw, StatusListResponse, { statuses: [], categories: [], total: 0 }, {
    endpoint: "PATCH /api/v1/workspaces/{ws}/task-statuses/reorder",
  });
}

export async function deleteTaskStatus(workspaceId: string, id: string): Promise<void> {
  await request(`/api/v1/workspaces/${enc(workspaceId)}/task-statuses/${enc(id)}`, {
    method: "DELETE",
  });
}

export async function listTaskLabels(workspaceId: string): Promise<TaskLabelList> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-labels`);
  return parseWithFallback(raw, LabelListResponse, { labels: [], total: 0 }, {
    endpoint: "GET /api/v1/workspaces/{ws}/task-labels",
  });
}

export async function createTaskLabel(
  workspaceId: string,
  body: CreateTaskLabelBody,
): Promise<TaskLabel | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-labels`, {
    method: "POST",
    body,
  });
  return parseWithFallback<{ label: TaskLabel } | null>(raw, LabelResponse, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/task-labels",
  })?.label ?? null;
}

export async function getTaskLabel(workspaceId: string, id: string): Promise<TaskLabel | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-labels/${enc(id)}`);
  return parseWithFallback<{ label: TaskLabel } | null>(raw, LabelResponse, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/task-labels/{id}",
  })?.label ?? null;
}

export async function putTaskLabel(
  workspaceId: string,
  id: string,
  body: PutTaskLabelBody,
): Promise<TaskLabel | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-labels/${enc(id)}`, {
    method: "PUT",
    body,
  });
  return parseWithFallback<{ label: TaskLabel } | null>(raw, LabelResponse, null, {
    endpoint: "PUT /api/v1/workspaces/{ws}/task-labels/{id}",
  })?.label ?? null;
}

export async function deleteTaskLabel(workspaceId: string, id: string): Promise<void> {
  await request(`/api/v1/workspaces/${enc(workspaceId)}/task-labels/${enc(id)}`, {
    method: "DELETE",
  });
}

export async function listTaskProperties(workspaceId: string): Promise<TaskPropertyList> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-properties`);
  return parseWithFallback(raw, PropertyListResponse, { properties: [], total: 0 }, {
    endpoint: "GET /api/v1/workspaces/{ws}/task-properties",
  });
}

export async function createTaskProperty(
  workspaceId: string,
  body: CreateTaskPropertyBody,
): Promise<TaskProperty | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-properties`, {
    method: "POST",
    body,
  });
  return parseWithFallback<{ property: TaskProperty } | null>(raw, PropertyResponse, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/task-properties",
  })?.property ?? null;
}

export async function patchTaskProperty(
  workspaceId: string,
  id: string,
  body: PatchTaskPropertyBody,
): Promise<TaskProperty | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-properties/${enc(id)}`, {
    method: "PATCH",
    body,
  });
  return parseWithFallback<{ property: TaskProperty } | null>(raw, PropertyResponse, null, {
    endpoint: "PATCH /api/v1/workspaces/{ws}/task-properties/{id}",
  })?.property ?? null;
}

export async function listLabelsOnTask(taskId: string): Promise<TaskLabelList> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/labels`);
  return parseWithFallback(raw, LabelListResponse, { labels: [], total: 0 }, {
    endpoint: "GET /api/v1/tasks/{id}/labels",
  });
}

export async function attachTaskLabel(taskId: string, labelId: string): Promise<void> {
  await request(`/api/v1/tasks/${enc(taskId)}/labels`, {
    method: "POST",
    body: { label_id: labelId },
  });
}

export async function detachTaskLabel(taskId: string, labelId: string): Promise<void> {
  await request(`/api/v1/tasks/${enc(taskId)}/labels/${enc(labelId)}`, { method: "DELETE" });
}

export async function putTaskPropertyValue(
  taskId: string,
  propertyId: string,
  value: unknown,
): Promise<Task | null> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/properties/${enc(propertyId)}`, {
    method: "PUT",
    body: { value },
  });
  return parseWithFallback<{ task: Task } | null>(raw, TaskResponse, null, {
    endpoint: "PUT /api/v1/tasks/{id}/properties/{propertyID}",
  })?.task ?? null;
}

export async function deleteTaskPropertyValue(
  taskId: string,
  propertyId: string,
): Promise<Task | null> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/properties/${enc(propertyId)}`, {
    method: "DELETE",
  });
  return parseWithFallback<{ task: Task } | null>(raw, TaskResponse, null, {
    endpoint: "DELETE /api/v1/tasks/{id}/properties/{propertyID}",
  })?.task ?? null;
}
