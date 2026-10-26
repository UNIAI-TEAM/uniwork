import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

export const DRIVE_ICON_KINDS = [
  "google_doc",
  "google_sheet",
  "google_slide",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "text",
  "markdown",
  "generic",
] as const;
export type DriveIconKind = (typeof DRIVE_ICON_KINDS)[number];

export const DRIVE_SHARING_STATES = ["private", "shared", "unknown"] as const;
export type DriveSharingState = (typeof DRIVE_SHARING_STATES)[number];

export const DRIVE_VIEWER_ACCESS_STATES = ["granted", "lost", "unknown", "connection_lost"] as const;
export type DriveViewerAccessState = (typeof DRIVE_VIEWER_ACCESS_STATES)[number];

const DriveLinkedTaskRefSchema = z.object({
  task_id: z.string(),
  identifier: z.string(),
  title: z.string(),
  status: z.string(),
});
export type DriveLinkedTaskRef = z.infer<typeof DriveLinkedTaskRefSchema>;

const DriveTasksCreatedSummarySchema = z.object({
  count: z.number(),
  last_created_at: z.string().optional(),
  last_created_by_name: z.string().optional(),
});
export type DriveTasksCreatedSummary = z.infer<typeof DriveTasksCreatedSummarySchema>;

const DriveTaskCreationGroupSchema = z.object({
  proposal_id: z.string(),
  created_at: z.string(),
  created_by_id: z.string(),
  created_by_name: z.string(),
  tasks: z.array(DriveLinkedTaskRefSchema).nullish().transform((v) => v ?? []),
});
export type DriveTaskCreationGroup = z.infer<typeof DriveTaskCreationGroupSchema>;

const DriveFileWireSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  workspace_id: z.string(),
  external_file_id: z.string(),
  drive_id: z.string().optional(),
  name: z.string(),
  mime_type: z.string(),
  icon_kind: z.string(),
  web_view_link: z.string(),
  open_url: z.string(),
  owner_display: z.string(),
  drive_modified_at: z.string().optional(),
  drive_modified_by_display: z.string().optional(),
  sharing_state: z.string(),
  shared_user_count: z.number().optional(),
  connection_id: z.string(),
  bound_account_email: z.string(),
  bound_connection_lost: z.boolean(),
  access_lost_at: z.string().optional(),
  bound_by_id: z.string(),
  bound_by_name: z.string(),
  created_by: z.string(),
  created_by_kind: z.string(),
  created_by_name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  metadata_refreshed_at: z.string().optional(),
  viewer_access: z.string(),
  viewer_connection_id: z.string().optional(),
  viewer_account_email: z.string().optional(),
  can_unlink: z.boolean(),
  can_rebind: z.boolean(),
  can_propose: z.boolean(),
  can_ask: z.boolean(),
  used_in_count: z.number(),
  used_in_tasks: z.array(DriveLinkedTaskRefSchema).nullish().transform((v) => v ?? []),
  tasks_created: DriveTasksCreatedSummarySchema,
  task_creations: z.array(DriveTaskCreationGroupSchema).nullish().transform((v) => v ?? []),
});

export type DriveFile = Omit<
  z.infer<typeof DriveFileWireSchema>,
  "icon_kind" | "sharing_state" | "viewer_access"
> & {
  icon_kind: DriveIconKind;
  sharing_state: DriveSharingState;
  viewer_access: DriveViewerAccessState;
};

const DriveFileListWireSchema = z.object({
  files: z.array(DriveFileWireSchema).nullish().transform((v) => v ?? []),
  total_count: z.number(),
  next_cursor: z.string().nullable(),
});

export interface DriveFileList {
  files: DriveFile[];
  total_count: number;
  next_cursor: string | null;
}

const DriveFileEnvelopeWireSchema = z.object({
  file: DriveFileWireSchema,
});

const StatusWireSchema = z.object({
  status: z.string(),
});

export interface ListDriveFilesQuery {
  connection_id?: string;
  cursor?: string;
  limit?: number;
}

export interface RebindDriveFileBody {
  connection_id: string;
}

const enc = encodeURIComponent;

function narrowDriveFile(raw: z.infer<typeof DriveFileWireSchema>): DriveFile {
  return {
    ...raw,
    icon_kind: raw.icon_kind as DriveIconKind,
    sharing_state: raw.sharing_state as DriveSharingState,
    viewer_access: raw.viewer_access as DriveViewerAccessState,
  };
}

function listQueryString(query?: ListDriveFilesQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  if (query.connection_id) params.set("connection_id", query.connection_id);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** GET /api/v1/workspaces/{workspaceID}/drive-files — the caller's own Google Drive files. */
export async function listDriveFiles(
  wsId: string,
  query?: ListDriveFilesQuery,
  signal?: AbortSignal,
): Promise<DriveFileList> {
  const raw = await request(
    `/api/v1/workspaces/${enc(wsId)}/drive-files${listQueryString(query)}`,
    { signal },
  );
  const parsed = parseWithFallback<z.infer<typeof DriveFileListWireSchema>>(
    raw,
    DriveFileListWireSchema,
    { files: [], total_count: 0, next_cursor: null },
    { endpoint: "GET /api/v1/workspaces/{ws}/drive-files" },
  );
  return {
    files: parsed.files.map(narrowDriveFile),
    total_count: parsed.total_count,
    next_cursor: parsed.next_cursor,
  };
}

/** GET /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID} — detail for 4.2. */
export async function getDriveFile(
  wsId: string,
  driveFileId: string,
  signal?: AbortSignal,
): Promise<DriveFile | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(wsId)}/drive-files/${enc(driveFileId)}`,
    { signal },
  );
  const parsed = parseWithFallback<z.infer<typeof DriveFileEnvelopeWireSchema> | null>(
    raw,
    DriveFileEnvelopeWireSchema,
    null,
    { endpoint: "GET /api/v1/workspaces/{ws}/drive-files/{id}" },
  );
  return parsed ? narrowDriveFile(parsed.file) : null;
}

/** DELETE /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID} — unlink from workspace. */
export async function unlinkDriveFile(
  wsId: string,
  driveFileId: string,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(wsId)}/drive-files/${enc(driveFileId)}`,
    { method: "DELETE" },
  );
  parseWithFallback<z.infer<typeof StatusWireSchema> | null>(
    raw,
    StatusWireSchema,
    null,
    { endpoint: "DELETE /api/v1/workspaces/{ws}/drive-files/{id}" },
  );
  return true;
}

/** POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/rebind — rebind to another connection. */
export async function rebindDriveFile(
  wsId: string,
  driveFileId: string,
  body: RebindDriveFileBody,
): Promise<DriveFile | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(wsId)}/drive-files/${enc(driveFileId)}/rebind`,
    { method: "POST", body },
  );
  const parsed = parseWithFallback<z.infer<typeof DriveFileEnvelopeWireSchema> | null>(
    raw,
    DriveFileEnvelopeWireSchema,
    null,
    { endpoint: "POST /api/v1/workspaces/{ws}/drive-files/{id}/rebind" },
  );
  return parsed ? narrowDriveFile(parsed.file) : null;
}
