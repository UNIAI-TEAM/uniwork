import { z } from "zod";
import {
  TaskCommentSchema,
  TaskSchema,
  type Task,
  type TaskComment,
  type TaskPriority,
  type TaskStatus,
} from "../../types/task";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const TasksResponse = z.object({ tasks: z.array(TaskSchema) });
const TaskResponse = z.object({ task: TaskSchema });
const CommentsResponse = z.object({ comments: z.array(TaskCommentSchema) });
const CommentResponse = z.object({ comment: TaskCommentSchema });

export interface TaskPatch {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  position?: number;
  assignee_id?: string | null;
  due_date?: string | null;
}

export interface CreateTaskBody {
  title: string;
  description?: string;
  priority?: TaskPriority;
}

const enc = encodeURIComponent;

export async function listTasks(workspaceId: string): Promise<Task[]> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/tasks`);
  return parseWithFallback<{ tasks: Task[] }>(raw, TasksResponse, { tasks: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/tasks",
  }).tasks;
}

export async function getTask(taskId: string): Promise<Task | null> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}`);
  return parseWithFallback<{ task: Task } | null>(raw, TaskResponse, null, {
    endpoint: "GET /api/v1/tasks/{id}",
  })?.task ?? null;
}

export async function createTask(workspaceId: string, body: CreateTaskBody): Promise<Task | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/tasks`, { method: "POST", body });
  return parseWithFallback<{ task: Task } | null>(raw, TaskResponse, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/tasks",
  })?.task ?? null;
}

export async function updateTask(taskId: string, patch: TaskPatch): Promise<Task | null> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}`, { method: "PATCH", body: patch });
  return parseWithFallback<{ task: Task } | null>(raw, TaskResponse, null, {
    endpoint: "PATCH /api/v1/tasks/{id}",
  })?.task ?? null;
}

export async function deleteTask(taskId: string): Promise<void> {
  await request(`/api/v1/tasks/${enc(taskId)}`, { method: "DELETE" });
}

export async function listComments(taskId: string): Promise<TaskComment[]> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/comments`);
  return parseWithFallback<{ comments: TaskComment[] }>(raw, CommentsResponse, { comments: [] }, {
    endpoint: "GET /api/v1/tasks/{id}/comments",
  }).comments;
}

export async function addComment(taskId: string, body: string): Promise<TaskComment | null> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/comments`, { method: "POST", body: { body } });
  return parseWithFallback<{ comment: TaskComment } | null>(raw, CommentResponse, null, {
    endpoint: "POST /api/v1/tasks/{id}/comments",
  })?.comment ?? null;
}

export async function seedWelcomeTask(workspaceId: string): Promise<Task | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/welcome-task`, { method: "POST" });
  return parseWithFallback<{ task: Task } | null>(raw, TaskResponse, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/welcome-task",
  })?.task ?? null;
}
