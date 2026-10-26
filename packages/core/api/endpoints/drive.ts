import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

/**
 * Single schema for a Google Drive connection row (B1 contract 8252ec181, UNI-2186).
 * Kept in one definition so a field rename is a one-line edit. Status is parsed
 * as z.string() on the wire so a future status degrades to active-but-unknown.
 */
const DriveConnectionSchema = z.object({
  id: z.string(),
  provider: z.string().optional().default("google"),
  google_email: z.string(),
  status: z.string().optional().default("active"),
  needs_reconnect: z.boolean().optional().catch(false).default(false),
  auth_failed_at: z.string().optional().catch(undefined),
  auth_failed_reason: z.string().optional().catch("").default(""),
  linked_file_count: z.number().int().nonnegative().optional().catch(0).default(0),
  connected_at: z.string(),
  updated_at: z.string().optional().default(""),
});

export type DriveConnection = z.infer<typeof DriveConnectionSchema>;

const DriveConnectionListSchema = z.object({
  connections: z.array(DriveConnectionSchema),
});

export type DriveConnectionList = z.infer<typeof DriveConnectionListSchema>;

const DriveConnectStartSchema = z.object({
  authorization_url: z.string().trim().min(1),
});

const DisconnectResponseSchema = z.object({
  status: z.string().optional().default("ok"),
});

const EMPTY_CONNECTIONS: DriveConnectionList = { connections: [] };

/**
 * Whether a Drive connection has lost authorization (`needs_reconnect === true`
 * or `status === "needs_reconnect"`). Any unknown status is treated as
 * active-but-unknown so a new server state does not lock the account out.
 */
export function isDriveConnectionLost(
  connection: Pick<DriveConnection, "status" | "needs_reconnect">,
): boolean {
  return Boolean(connection.needs_reconnect) || connection.status === "needs_reconnect";
}

export async function listDriveConnections(workspaceId: string): Promise<DriveConnectionList> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/drive-connections`);
  return parseWithFallback(raw, DriveConnectionListSchema, EMPTY_CONNECTIONS, {
    endpoint: "GET /api/v1/workspaces/{ws}/drive-connections",
  });
}

export async function startDriveConnect(
  workspaceId: string,
  options?: { reconnect_connection_id?: string },
): Promise<string | null> {
  const body = options?.reconnect_connection_id
    ? { reconnect_connection_id: options.reconnect_connection_id }
    : {};
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/drive-connections/google/start`, {
    method: "POST",
    body,
  });
  const parsed = parseWithFallback<{ authorization_url: string } | null>(
    raw,
    DriveConnectStartSchema,
    null,
    {
      endpoint: "POST /api/v1/workspaces/{ws}/drive-connections/google/start",
    },
  );
  return parsed?.authorization_url ?? null;
}

export async function disconnectDriveConnection(workspaceId: string, connectionId: string): Promise<void> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/drive-connections/${enc(connectionId)}`,
    { method: "DELETE" },
  );
  parseWithFallback(raw, DisconnectResponseSchema, { status: "ok" }, {
    endpoint: "DELETE /api/v1/workspaces/{ws}/drive-connections/{driveConnectionID}",
  });
}

const DrivePickerTokenSchema = z.object({
  access_token: z.string().trim().min(1),
  expires_at: z.string(),
  developer_key: z.string(),
  app_id: z.string(),
});

export type DrivePickerToken = z.infer<typeof DrivePickerTokenSchema>;

/**
 * Privacy-safe link receipt returned on `POST /workspaces/{ws}/drive-files`
 * (`sdo.DriveFileLinkReceiptDTO`, contract-2 2ad591108). Optional fields are
 * omitted by `omitempty` on the server; enums are parsed as `z.string()` so
 * unknown future states degrade without failing the response.
 */
const DriveTasksCreatedSummarySchema = z.object({
  count: z.number().int().nonnegative().optional().catch(0).default(0),
  last_created_at: z.string().optional().catch(undefined),
  last_created_by_name: z.string().optional().catch(undefined),
});

export type DriveTasksCreatedSummary = z.infer<typeof DriveTasksCreatedSummarySchema>;

const DriveFileLinkReceiptSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  external_file_id: z.string(),
  drive_id: z.string().optional().catch(undefined),
  name: z.string(),
  mime_type: z.string(),
  icon_kind: z.string().optional().default("generic"),
  sharing_state: z.string().optional().default("unknown"),
  web_view_link: z.string(),
  open_url: z.string(),
  viewer_access: z.string().optional().default("granted"),
  viewer_connection_id: z.string().optional().catch(undefined),
  viewer_account_email: z.string().optional().catch(undefined),
  tasks_created: DriveTasksCreatedSummarySchema.optional().catch(undefined),
});

export type DriveFileLinkReceipt = z.infer<typeof DriveFileLinkReceiptSchema>;

const DriveFileLinkItemSchema = z.object({
  external_file_id: z.string(),
  outcome: z.string(),
  file: DriveFileLinkReceiptSchema.optional().catch(undefined),
  account_email: z.string().optional().catch(undefined),
  error_code: z.string().optional().catch(undefined),
  error_message: z.string().optional().catch(undefined),
});

export type DriveFileLinkItem = z.infer<typeof DriveFileLinkItemSchema>;

/**
 * Parses each item in `results` individually so a single malformed element in a
 * 20-file batch is dropped instead of wiping out the 19 valid link outcomes (R1-7).
 */
const DriveFileLinkResultsSchema = z.object({
  results: z.array(z.unknown()).transform((items) => {
    const valid: DriveFileLinkItem[] = [];
    for (const item of items) {
      const parsed = DriveFileLinkItemSchema.safeParse(item);
      if (parsed.success) {
        valid.push(parsed.data);
      }
    }
    return valid;
  }),
});

export type DriveFileLinkResults = {
  results: DriveFileLinkItem[];
};

export interface LinkDriveFilesBody {
  connection_id: string;
  external_file_ids: string[];
  task_id?: string | null;
  signal?: AbortSignal;
}

const EMPTY_LINK_RESULTS: DriveFileLinkResults = { results: [] };

export async function getDrivePickerToken(
  workspaceId: string,
  connectionId: string,
): Promise<DrivePickerToken | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/drive-connections/${enc(connectionId)}/picker-token`,
    { method: "POST", body: {} },
  );
  return parseWithFallback<DrivePickerToken | null>(raw, DrivePickerTokenSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/drive-connections/{driveConnectionID}/picker-token",
  });
}

export async function linkDriveFiles(
  workspaceId: string,
  body: LinkDriveFilesBody,
  signal?: AbortSignal,
): Promise<DriveFileLinkResults> {
  const payload: {
    connection_id: string;
    external_file_ids: string[];
    task_id?: string;
  } = {
    connection_id: body.connection_id,
    external_file_ids: body.external_file_ids,
  };
  if (body.task_id) {
    payload.task_id = body.task_id;
  }
  const resolvedSignal = signal ?? body.signal;
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/drive-files`, {
    method: "POST",
    body: payload,
    ...(resolvedSignal !== undefined ? { signal: resolvedSignal } : {}),
  });
  return parseWithFallback(raw, DriveFileLinkResultsSchema, EMPTY_LINK_RESULTS, {
    endpoint: "POST /api/v1/workspaces/{ws}/drive-files",
  });
}

const DriveLinkedTaskRefSchema = z.object({
  task_id: z.string(),
  identifier: z.string(),
  title: z.string(),
  status: z.string().optional().default("todo"),
});

export type DriveLinkedTaskRef = z.infer<typeof DriveLinkedTaskRefSchema>;

const DriveTaskCreationGroupSchema = z.object({
  proposal_id: z.string(),
  created_at: z.string(),
  created_by_id: z.string(),
  created_by_name: z.string(),
  tasks: z.array(DriveLinkedTaskRefSchema).optional().catch([]).default([]),
});

export type DriveTaskCreationGroup = z.infer<typeof DriveTaskCreationGroupSchema>;

const EMPTY_TASKS_CREATED: DriveTasksCreatedSummary = { count: 0 };

const DriveFileSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  workspace_id: z.string(),
  external_file_id: z.string(),
  drive_id: z.string().optional().catch(undefined),
  name: z.string(),
  mime_type: z.string(),
  icon_kind: z.string().optional().default("generic"),
  web_view_link: z.string(),
  open_url: z.string(),
  owner_display: z.string().optional().default(""),
  drive_modified_at: z.string().optional().catch(undefined),
  drive_modified_by_display: z.string().optional().catch(undefined),
  sharing_state: z.string().optional().default("unknown"),
  shared_user_count: z.number().int().nonnegative().optional().catch(undefined),
  connection_id: z.string(),
  bound_account_email: z.string(),
  bound_connection_lost: z.boolean().optional().catch(false).default(false),
  access_lost_at: z.string().optional().catch(undefined),
  bound_by_id: z.string(),
  bound_by_name: z.string().optional().default(""),
  created_by: z.string(),
  created_by_kind: z.string().optional().default("human"),
  created_by_name: z.string().optional().default(""),
  created_at: z.string(),
  updated_at: z.string().optional().default(""),
  metadata_refreshed_at: z.string().optional().catch(undefined),
  viewer_access: z.string().optional().default("unknown"),
  viewer_connection_id: z.string().optional().catch(undefined),
  viewer_account_email: z.string().optional().catch(undefined),
  can_unlink: z.boolean().optional().catch(false).default(false),
  can_rebind: z.boolean().optional().catch(false).default(false),
  can_propose: z.boolean().optional().catch(false).default(false),
  can_ask: z.boolean().optional().catch(false).default(false),
  used_in_count: z.number().int().nonnegative().optional().catch(0).default(0),
  used_in_tasks: z.array(DriveLinkedTaskRefSchema).optional().catch([]).default([]),
  tasks_created: DriveTasksCreatedSummarySchema.optional()
    .catch(EMPTY_TASKS_CREATED)
    .default(EMPTY_TASKS_CREATED),
  task_creations: z.array(DriveTaskCreationGroupSchema).optional().catch(undefined),
});

export type DriveFile = z.infer<typeof DriveFileSchema>;

const DriveFileResponseSchema = z.object({
  file: DriveFileSchema,
});

const DriveTaskFileCardSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  workspace_id: z.string(),
  external_file_id: z.string(),
  drive_id: z.string().optional().catch(undefined),
  name: z.string(),
  mime_type: z.string(),
  icon_kind: z.string().optional().default("generic"),
  sharing_state: z.string().optional().default("unknown"),
  owner_display: z.string().optional().default(""),
  drive_modified_at: z.string().optional().catch(undefined),
  drive_modified_by_display: z.string().optional().catch(undefined),
  connection_id: z.string(),
  bound_account_email: z.string(),
  bound_connection_lost: z.boolean().optional().catch(false).default(false),
  access_lost_at: z.string().optional().catch(undefined),
  bound_by_id: z.string(),
  bound_by_name: z.string().optional().default(""),
  created_by: z.string(),
  created_by_name: z.string().optional().default(""),
  linked_at: z.string(),
  viewer_access: z.string().optional().default("unknown"),
  viewer_connection_id: z.string().optional().catch(undefined),
  viewer_account_email: z.string().optional().catch(undefined),
  open_url: z.string(),
  can_remove_from_task: z.boolean().optional().catch(false).default(false),
  can_propose: z.boolean().optional().catch(false).default(false),
  can_ask: z.boolean().optional().catch(false).default(false),
  tasks_created: DriveTasksCreatedSummarySchema.optional()
    .catch(EMPTY_TASKS_CREATED)
    .default(EMPTY_TASKS_CREATED),
});

export type DriveTaskFileCard = z.infer<typeof DriveTaskFileCardSchema>;

const DriveTaskFileListSchema = z.object({
  files: z.array(z.unknown()).transform((items) => {
    const valid: DriveTaskFileCard[] = [];
    for (const item of items) {
      const parsed = DriveTaskFileCardSchema.safeParse(item);
      if (parsed.success) {
        valid.push(parsed.data);
      }
    }
    return valid;
  }),
});

const EMPTY_TASK_DRIVE_FILES: { files: DriveTaskFileCard[] } = { files: [] };

export async function listTaskDriveFiles(taskId: string): Promise<DriveTaskFileCard[]> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/drive-files`);
  return parseWithFallback(raw, DriveTaskFileListSchema, EMPTY_TASK_DRIVE_FILES, {
    endpoint: "GET /api/v1/tasks/{taskID}/drive-files",
  }).files;
}

export async function removeTaskDriveFile(taskId: string, driveFileId: string): Promise<void> {
  const raw = await request(
    `/api/v1/tasks/${enc(taskId)}/drive-files/${enc(driveFileId)}`,
    { method: "DELETE" },
  );
  parseWithFallback(raw, DisconnectResponseSchema, { status: "ok" }, {
    endpoint: "DELETE /api/v1/tasks/{taskID}/drive-files/{driveFileID}",
  });
}

export async function grantDriveFileAccess(
  workspaceId: string,
  driveFileId: string,
  connectionId: string,
): Promise<DriveFile | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/drive-files/${enc(driveFileId)}/access`,
    { method: "POST", body: { connection_id: connectionId } },
  );
  return (
    parseWithFallback<{ file: DriveFile } | null>(raw, DriveFileResponseSchema, null, {
      endpoint: "POST /api/v1/workspaces/{ws}/drive-files/{driveFileID}/access",
    })?.file ?? null
  );
}

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

