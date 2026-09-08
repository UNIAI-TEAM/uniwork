import { z } from "zod";
import {
  TaskPinSchema,
  TaskViewPreferenceSchema,
  TaskViewSchema,
  type TaskPin,
  type TaskView,
  type TaskViewPreference,
} from "../../types/task-view";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const ViewListResponse = z.object({
  views: z.array(TaskViewSchema),
  total: z.number(),
});
const ViewResponse = z.object({ view: TaskViewSchema });
const PinListResponse = z.object({
  pins: z.array(TaskPinSchema),
  total: z.number(),
});
const PinResponse = z.object({ pin: TaskPinSchema });

export type TaskViewList = z.infer<typeof ViewListResponse>;
export type TaskPinList = z.infer<typeof PinListResponse>;

export interface CreateTaskViewBody {
  name: string;
  scope_type: string;
  scope_id?: string | null;
  scope_variant?: string | null;
  visibility: string;
  definition_version?: number;
  query?: unknown;
  display?: unknown;
}

export interface PatchTaskViewBody {
  name?: string;
  visibility?: string;
  scope_variant?: string | null;
  query?: unknown;
  display?: unknown;
  expected_revision: number;
}

export interface PutTaskViewPreferenceBody {
  scope_type: string;
  scope_id?: string | null;
  prefs: unknown;
}

export interface CreatePinBody {
  item_type: string;
  item_id: string;
}

const enc = encodeURIComponent;

function qs(params: Record<string, string | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function listTaskViews(
  workspaceId: string,
  opts: { scope_type?: string; scope_id?: string } = {},
): Promise<TaskViewList> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/task-views${qs(opts)}`,
  );
  return parseWithFallback(raw, ViewListResponse, { views: [], total: 0 }, {
    endpoint: "GET /api/v1/workspaces/{ws}/task-views",
  });
}

export async function createTaskView(
  workspaceId: string,
  body: CreateTaskViewBody,
): Promise<TaskView | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-views`, {
    method: "POST",
    body,
  });
  return parseWithFallback<{ view: TaskView } | null>(raw, ViewResponse, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/task-views",
  })?.view ?? null;
}

export async function getTaskView(workspaceId: string, id: string): Promise<TaskView | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-views/${enc(id)}`);
  return parseWithFallback<{ view: TaskView } | null>(raw, ViewResponse, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/task-views/{id}",
  })?.view ?? null;
}

export async function patchTaskView(
  workspaceId: string,
  id: string,
  body: PatchTaskViewBody,
): Promise<TaskView | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-views/${enc(id)}`, {
    method: "PATCH",
    body,
  });
  return parseWithFallback<{ view: TaskView } | null>(raw, ViewResponse, null, {
    endpoint: "PATCH /api/v1/workspaces/{ws}/task-views/{id}",
  })?.view ?? null;
}

export async function deleteTaskView(workspaceId: string, id: string): Promise<void> {
  await request(`/api/v1/workspaces/${enc(workspaceId)}/task-views/${enc(id)}`, {
    method: "DELETE",
  });
}

export async function getTaskViewPreference(
  workspaceId: string,
  opts: { scope_type: string; scope_id?: string },
): Promise<TaskViewPreference | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/task-view-preferences${qs(opts)}`,
  );
  return parseWithFallback<TaskViewPreference | null>(raw, TaskViewPreferenceSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/task-view-preferences",
  });
}

export async function putTaskViewPreference(
  workspaceId: string,
  body: PutTaskViewPreferenceBody,
): Promise<TaskViewPreference | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/task-view-preferences`, {
    method: "PUT",
    body,
  });
  return parseWithFallback<TaskViewPreference | null>(raw, TaskViewPreferenceSchema, null, {
    endpoint: "PUT /api/v1/workspaces/{ws}/task-view-preferences",
  });
}

export async function listPins(
  workspaceId: string,
  opts: { include?: string } = {},
): Promise<TaskPinList> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/pins${qs(opts)}`);
  return parseWithFallback(raw, PinListResponse, { pins: [], total: 0 }, {
    endpoint: "GET /api/v1/workspaces/{ws}/pins",
  });
}

export async function createPin(
  workspaceId: string,
  body: CreatePinBody,
): Promise<TaskPin | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/pins`, {
    method: "POST",
    body,
  });
  return parseWithFallback<{ pin: TaskPin } | null>(raw, PinResponse, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/pins",
  })?.pin ?? null;
}

export async function reorderPins(
  workspaceId: string,
  items: Array<{ id: string; position: number }>,
): Promise<void> {
  await request(`/api/v1/workspaces/${enc(workspaceId)}/pins/reorder`, {
    method: "PUT",
    body: { items },
  });
}

export async function deletePin(
  workspaceId: string,
  itemType: string,
  itemId: string,
): Promise<void> {
  await request(
    `/api/v1/workspaces/${enc(workspaceId)}/pins/${enc(itemType)}/${enc(itemId)}`,
    { method: "DELETE" },
  );
}
