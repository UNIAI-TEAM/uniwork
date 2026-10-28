import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
const enc = encodeURIComponent;

export const DisconnectResponseSchema = z.object({
  status: z.string().optional().default("ok"),
});

export const DriveTasksCreatedSummarySchema = z.object({
  count: z.number().int().nonnegative().optional().catch(0).default(0),
  last_created_at: z.string().optional().catch(undefined),
  last_created_by_name: z.string().optional().catch(undefined),
});

export type DriveTasksCreatedSummary = z.infer<typeof DriveTasksCreatedSummarySchema>;

export const DriveLinkedTaskRefSchema = z.object({
  task_id: z.string(),
  identifier: z.string(),
  title: z.string(),
  status: z.string().optional().default("todo"),
});

export type DriveLinkedTaskRef = z.infer<typeof DriveLinkedTaskRefSchema>;

export const DriveTaskCreationGroupSchema = z.object({
  proposal_id: z.string(),
  created_at: z.string(),
  created_by_id: z.string(),
  created_by_name: z.string(),
  tasks: z.array(DriveLinkedTaskRefSchema).optional().catch([]).default([]),
});

export type DriveTaskCreationGroup = z.infer<typeof DriveTaskCreationGroupSchema>;

export const EMPTY_TASKS_CREATED: DriveTasksCreatedSummary = { count: 0 };

const DriveProposalExcerptSchema = z.object({
  section: z.string().optional().catch("").default(""),
  quote: z.string().optional().catch("").default(""),
});

export type DriveProposalExcerpt = z.infer<typeof DriveProposalExcerptSchema>;

const DriveDuplicateTaskSchema = z.object({
  task_id: z.string(),
  identifier: z.string(),
  title: z.string(),
});

export type DriveDuplicateTask = z.infer<typeof DriveDuplicateTaskSchema>;

const DriveTaskProposalItemSchema = z.object({
  index: z.number().int().nonnegative(),
  title: z.string(),
  assignee_member_id: z.string().optional().catch(undefined),
  assignee_basis: z.string().optional().catch(undefined),
  assignee_drive_access: z.string().optional().catch(undefined),
  priority: z.string().optional().catch(undefined),
  priority_basis: z.string().optional().catch(undefined),
  start_date: z.string().optional().catch(undefined),
  start_basis: z.string().optional().catch(undefined),
  due_date: z.string().optional().catch(undefined),
  due_basis: z.string().optional().catch(undefined),
  label_ids: z.array(z.string()).optional().catch([]).default([]),
  label_basis: z.string().optional().catch(undefined),
  goal: z.string().optional().catch("").default(""),
  checklist: z.array(z.string()).optional().catch([]).default([]),
  excerpt: DriveProposalExcerptSchema.optional()
    .catch({ section: "", quote: "" })
    .default({ section: "", quote: "" }),
  blocked_by_indexes: z.array(z.number().int().nonnegative()).optional().catch([]).default([]),
  possible_duplicate: DriveDuplicateTaskSchema.optional().catch(undefined),
});

export type DriveTaskProposalItem = z.infer<typeof DriveTaskProposalItemSchema>;

const DriveTaskProposalSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  drive_file_id: z.string(),
  drive_file_name: z.string(),
  drive_file_mime_type: z.string().optional().catch("").default(""),
  drive_file_icon_kind: z.string().optional().catch("generic").default("generic"),
  sharing_state: z.string().optional().catch("unknown").default("unknown"),
  connection_id: z.string(),
  reader_account_email: z.string().optional().catch("").default(""),
  requested_by: z.string(),
  prompt: z.string().optional().catch(undefined),
  project_id: z.string().optional().catch(undefined),
  parent_task_id: z.string().optional().catch(undefined),
  context_task_id: z.string().optional().catch(undefined),
  truncated: z.boolean().optional().catch(false).default(false),
  status: z.string().optional().catch("ready").default("ready"),
  items: z
    .array(z.unknown())
    .optional()
    .catch([])
    .default([])
    .transform((items) => {
      const valid: DriveTaskProposalItem[] = [];
      for (const item of items) {
        const parsed = DriveTaskProposalItemSchema.safeParse(item);
        if (parsed.success) {
          valid.push(parsed.data);
        }
      }
      return valid;
    }),
  tasks_created: DriveTasksCreatedSummarySchema.optional()
    .catch(EMPTY_TASKS_CREATED)
    .default(EMPTY_TASKS_CREATED),
  prior_creations: z.array(DriveTaskCreationGroupSchema).optional().catch([]).default([]),
  created_at: z.string(),
  expires_at: z.string(),
});

export type DriveTaskProposal = z.infer<typeof DriveTaskProposalSchema>;

const DriveTaskProposalResponseSchema = z.object({
  proposal: DriveTaskProposalSchema,
});

export interface CreateDriveTaskProposalBody {
  prompt?: string;
  project_id?: string | null;
  parent_task_id?: string | null;
  context_task_id?: string | null;
}

export async function createDriveTaskProposal(
  workspaceId: string,
  driveFileId: string,
  body?: CreateDriveTaskProposalBody,
  signal?: AbortSignal,
): Promise<DriveTaskProposal | null> {
  const payload: Record<string, unknown> = {};
  if (body?.prompt !== undefined && body.prompt.trim() !== "") {
    payload.prompt = body.prompt;
  }
  if (body?.project_id !== undefined) {
    payload.project_id = body.project_id;
  }
  if (body?.parent_task_id !== undefined) {
    payload.parent_task_id = body.parent_task_id;
  }
  if (body?.context_task_id !== undefined) {
    payload.context_task_id = body.context_task_id;
  }
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/drive-files/${enc(driveFileId)}/task-proposals`,
    { method: "POST", body: payload, signal },
  );
  return (
    parseWithFallback<{ proposal: DriveTaskProposal } | null>(
      raw,
      DriveTaskProposalResponseSchema,
      null,
      { endpoint: "POST /api/v1/workspaces/{ws}/drive-files/{driveFileID}/task-proposals" },
    )?.proposal ?? null
  );
}

export async function getDriveTaskProposal(
  workspaceId: string,
  proposalId: string,
  signal?: AbortSignal,
): Promise<DriveTaskProposal | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/drive-task-proposals/${enc(proposalId)}`,
    { signal },
  );
  return (
    parseWithFallback<{ proposal: DriveTaskProposal } | null>(
      raw,
      DriveTaskProposalResponseSchema,
      null,
      { endpoint: "GET /api/v1/workspaces/{ws}/drive-task-proposals/{proposalID}" },
    )?.proposal ?? null
  );
}

export async function deleteDriveTaskProposal(
  workspaceId: string,
  proposalId: string,
  signal?: AbortSignal,
): Promise<void> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/drive-task-proposals/${enc(proposalId)}`,
    { method: "DELETE", signal },
  );
  parseWithFallback(raw, DisconnectResponseSchema, { status: "ok" }, {
    endpoint: "DELETE /api/v1/workspaces/{ws}/drive-task-proposals/{proposalID}",
  });
}

const DriveProposalDuplicateItemSchema = z.object({
  index: z.number().int().nonnegative(),
  possible_duplicate: DriveDuplicateTaskSchema.optional().catch(undefined),
});

export type DriveProposalDuplicateItem = z.infer<typeof DriveProposalDuplicateItemSchema>;

const DriveProposalDuplicatesResponseSchema = z.object({
  duplicates: z
    .array(z.unknown())
    .transform((items) => {
      const valid: DriveProposalDuplicateItem[] = [];
      for (const item of items) {
        const parsed = DriveProposalDuplicateItemSchema.safeParse(item);
        if (parsed.success) {
          valid.push(parsed.data);
        }
      }
      return valid;
    }),
});

export interface CheckDriveTaskProposalDuplicatesBody {
  project_id?: string | null;
  parent_task_id?: string | null;
  titles: string[];
}

const EMPTY_DUPLICATES: { duplicates: DriveProposalDuplicateItem[] } = { duplicates: [] };

export async function checkDriveTaskProposalDuplicates(
  workspaceId: string,
  proposalId: string,
  body: CheckDriveTaskProposalDuplicatesBody,
  signal?: AbortSignal,
): Promise<DriveProposalDuplicateItem[]> {
  const payload: Record<string, unknown> = {
    titles: body.titles,
  };
  if (body.project_id !== undefined) {
    payload.project_id = body.project_id;
  }
  if (body.parent_task_id !== undefined) {
    payload.parent_task_id = body.parent_task_id;
  }
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/drive-task-proposals/${enc(proposalId)}/duplicates`,
    { method: "POST", body: payload, signal },
  );
  return parseWithFallback(raw, DriveProposalDuplicatesResponseSchema, EMPTY_DUPLICATES, {
    endpoint: "POST /api/v1/workspaces/{ws}/drive-task-proposals/{proposalID}/duplicates",
  }).duplicates;
}

const DriveProposalCreatedTaskItemSchema = z.object({
  index: z.number().int().nonnegative(),
  task_id: z.string().trim().min(1),
});

export type DriveProposalCreatedTaskItem = z.infer<typeof DriveProposalCreatedTaskItemSchema>;

const DriveProposalTasksCreatedSchema = z.object({
  task_ids: z.array(z.string().trim().min(1)).optional().catch([]).default([]),
  items: z
    .array(z.unknown())
    .optional()
    .catch([])
    .default([])
    .transform((items) => {
      const valid: DriveProposalCreatedTaskItem[] = [];
      for (const item of items) {
        const parsed = DriveProposalCreatedTaskItemSchema.safeParse(item);
        if (parsed.success) {
          valid.push(parsed.data);
        }
      }
      return valid;
    }),
});

export type DriveProposalTasksCreated = z.infer<typeof DriveProposalTasksCreatedSchema>;

export interface DriveProposalTaskItemInput {
  index: number;
  title: string;
  description: string;
  assignee_id?: string | null;
  priority?: string;
  start_date?: string | null;
  due_date?: string | null;
  label_ids?: string[];
  blocked_by_indexes?: number[];
  allow_duplicate?: boolean;
}

export interface CreateTasksFromDriveProposalBody {
  project_id?: string | null;
  parent_task_id?: string | null;
  status?: string;
  items: DriveProposalTaskItemInput[];
}

export async function createTasksFromDriveProposal(
  workspaceId: string,
  proposalId: string,
  body: CreateTasksFromDriveProposalBody,
  signal?: AbortSignal,
): Promise<DriveProposalTasksCreated | null> {
  const payload: Record<string, unknown> = {
    items: body.items.map((item) => {
      const row: Record<string, unknown> = {
        index: item.index,
        title: item.title,
        description: item.description,
      };
      if (item.assignee_id !== undefined) row.assignee_id = item.assignee_id;
      if (item.priority !== undefined) row.priority = item.priority;
      if (item.start_date !== undefined) row.start_date = item.start_date;
      if (item.due_date !== undefined) row.due_date = item.due_date;
      if (item.label_ids !== undefined) row.label_ids = item.label_ids;
      if (item.blocked_by_indexes !== undefined) row.blocked_by_indexes = item.blocked_by_indexes;
      if (item.allow_duplicate !== undefined) row.allow_duplicate = item.allow_duplicate;
      return row;
    }),
  };
  if (body.project_id !== undefined) {
    payload.project_id = body.project_id;
  }
  if (body.parent_task_id !== undefined) {
    payload.parent_task_id = body.parent_task_id;
  }
  if (body.status !== undefined && body.status !== "") {
    payload.status = body.status;
  }
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/drive-task-proposals/${enc(proposalId)}/tasks`,
    { method: "POST", body: payload, signal },
  );
  const parsed = parseWithFallback<DriveProposalTasksCreated | null>(
    raw,
    DriveProposalTasksCreatedSchema,
    null,
    { endpoint: "POST /api/v1/workspaces/{ws}/drive-task-proposals/{proposalID}/tasks" },
  );
  if (!parsed || (parsed.task_ids.length === 0 && parsed.items.length === 0)) {
    return null;
  }
  return parsed;
}
